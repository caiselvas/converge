"""Language assistance: natural-language scenarios -> validated plan changes,
and grounded narrative explanations.

Separation of concerns:
* The language model only proposes *structured* changes from a closed lever
  registry (JSON-schema constrained output). It never computes results.
* Every proposed change is validated by ``apply_changes`` and then simulated
  by the deterministic engine.
* Narrative explanations are checked: every number in the text must appear in
  the engine's facts, otherwise the deterministic explanation is used.
* Without an API key, a small rule-based parser handles common phrasings and
  is clearly labelled as such.
"""
from __future__ import annotations

import json
import logging
import re
from typing import TypeVar

from pydantic import BaseModel, ConfigDict, Field

from converge import config
from converge.engine import months as M
from converge.engine.changes import ChangeError, apply_changes, describe, format_value, lever_catalogue
from converge.models import Change, Plan

log = logging.getLogger("converge.ai")

PROVIDER_NAMES = {"anthropic": "Claude", "openai": "OpenAI"}


class StructuredOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ProposedChange(StructuredOutput):
    path: str
    number: float | None
    text: str | None
    flag: bool | None


class ProposedBreak(StructuredOutput):
    person_id: str
    start: str = Field(description="YYYY-MM")
    months: int
    income_pct: float
    one_off_cost_chf: float


class Interpretation(StructuredOutput):
    summary: str
    changes: list[ProposedChange]
    career_break: ProposedBreak | None
    clarification: str | None


class Explanation(StructuredOutput):
    text: str


Output = TypeVar("Output", bound=StructuredOutput)


class MissingAPIKey(RuntimeError):
    pass


class IncompleteResponse(RuntimeError):
    pass


def llm_model(provider: config.Provider) -> str:
    return config.ANTHROPIC_MODEL if provider == "anthropic" else config.OPENAI_MODEL


def _api_key(provider: config.Provider) -> str:
    return config.ANTHROPIC_API_KEY if provider == "anthropic" else config.OPENAI_API_KEY


def llm_available() -> bool:
    provider = config.llm_provider()
    return provider is not None and bool(_api_key(provider))


def _client(provider: config.Provider):
    key = _api_key(provider)
    if not key:
        raise MissingAPIKey
    if provider == "anthropic":
        from anthropic import Anthropic

        return Anthropic(api_key=key, timeout=20.0, max_retries=0)
    from openai import OpenAI

    return OpenAI(api_key=key, timeout=20.0, max_retries=0)


def _failure_notice(provider: config.Provider, action: str, error: Exception) -> str:
    reason = type(error).__name__
    name = PROVIDER_NAMES[provider]
    log.warning("%s %s failed (%s)", name, action, reason)
    return f"{name} {action} failed ({reason})."


def _context(plan: Plan, viewer: str) -> str:
    people = [dict(id=p.id, name=p.name, income_monthly=p.income_monthly,
                   career_breaks=[b.model_dump() for b in p.career_breaks]) for p in plan.people]
    pr = plan.shared.property
    return json.dumps(dict(
        today="2026-11", plan_start=plan.assumptions.start, horizon_months=plan.assumptions.horizon_months,
        viewer=viewer, people=people,
        shared=dict(lives_together=plan.shared.household.enabled, move_in=plan.shared.household.move_in,
                    buying_home=pr.enabled, purchase=pr.purchase, price=pr.price, deposit_pct=pr.deposit_pct,
                    mortgage_rate=pr.mortgage_rate, home_target_date=pr.target_date),
        levers=lever_catalogue(plan),
    ), default=str)


SYSTEM = """You translate a couple's financial what-if question into structured changes for the Converge planning engine.
Rules:
- Use ONLY lever paths listed in `levers` (replace placeholders with real ids). Never invent paths.
- Use `number` for CHF amounts and rates (rates as decimals, e.g. 0.025 for 2.5%; deposit_pct as decimal), `text` for months (YYYY-MM) and enum values, `flag` for booleans. Leave the other two null.
- Shares like custom_share_first or ownership_share_first are decimals between 0 and 1 for the FIRST person listed.
- Career breaks go in `career_break` (person_id, start YYYY-MM, months, income_pct 0-100 of usual income, one_off_cost_chf). "Next year" means 2027.
- If the request implies buying a home or moving in, also set the corresponding `enabled` lever to true.
- Do NOT calculate outcomes or judge feasibility; the engine does that.
- If something is ambiguous or not supported by the levers, keep the supported part and put a short question in `clarification`.
- `summary`: one plain sentence restating what will be simulated, without numbers you were not given."""


def interpret(plan: Plan, text: str, viewer: str) -> dict:
    text = text.strip()
    if not text:
        raise ValueError("empty request")
    provider = config.llm_provider()
    if provider is None:
        return _interpret_offline(plan, text, viewer)
    try:
        return _interpret_llm(plan, text, viewer, provider)
    except Exception as error:
        out = _interpret_offline(plan, text, viewer)
        out["notice"] = f"{_failure_notice(provider, 'interpretation', error)} Used the built-in parser."
        return out


def _call_structured(
    provider: config.Provider, model: str, system: str, user: str, output: type[Output], max_tokens: int,
) -> Output:
    schema = output.model_json_schema()
    client = _client(provider)
    if provider == "anthropic":
        output_config = {"format": {"type": "json_schema", "schema": schema}}
        options = {}
        if model == "claude-haiku-5-5":
            output_config["effort"] = "low"
            options["thinking"] = {"type": "disabled"}
        response = client.messages.create(
            model=model, max_tokens=max_tokens, system=system,
            messages=[{"role": "user", "content": user}], output_config=output_config, **options,
        )
        if response.stop_reason != "end_turn":
            raise IncompleteResponse
        text = "".join(block.text for block in response.content if block.type == "text")
    else:
        options = {"reasoning": {"effort": "none"}} if model == "gpt-6-luna" else {}
        response = client.responses.create(
            model=model, max_output_tokens=max_tokens, instructions=system, input=user, store=False,
            text={"format": {"type": "json_schema", "name": output.__name__, "schema": schema, "strict": True}},
            **options,
        )
        if response.status != "completed":
            raise IncompleteResponse
        text = response.output_text
    if not text:
        raise IncompleteResponse
    return output.model_validate_json(text)


def _interpret_llm(plan: Plan, text: str, viewer: str, provider: config.Provider) -> dict:
    model = llm_model(provider)
    data = _call_structured(
        provider, model, SYSTEM, f"Context:\n{_context(plan, viewer)}\n\nRequest:\n{text}", Interpretation, 1000,
    )
    changes = [
        Change(path=c.path, value=next((value for value in (c.number, c.text, c.flag) if value is not None), None))
        for c in data.changes
    ]
    cb = data.career_break
    rejected_break = []
    if cb:
        try:
            changes.append(_career_break_change(plan, cb.person_id, cb.start, cb.months, cb.income_pct, cb.one_off_cost_chf))
        except KeyError:
            rejected_break.append("Career break: person is outside this plan.")
    valid, rejected = _validate_each(plan, changes)
    return dict(
        mode="llm", provider=provider, model=model, summary=data.summary,
        clarification=data.clarification, changes=[c.model_dump() for c in valid],
        described=_describe(plan, valid), rejected=rejected + rejected_break,
    )


def _career_break_change(plan: Plan, pid: str, start: str, months: int, income_pct: float, cost: float) -> Change:
    person = plan.person(pid)
    existing = [b.model_dump() for b in person.career_breaks]
    existing.append(dict(id=f"cb{len(existing) + 1}", start=start, months=int(months), income_pct=float(income_pct),
                         one_off_cost_chf=float(cost), label="Career break"))
    return Change(path=f"people.{pid}.career_breaks", value=existing)


def _validate_each(plan: Plan, changes: list[Change]) -> tuple[list[Change], list[str]]:
    valid, rejected = [], []
    current = plan
    for ch in changes:
        try:
            current = apply_changes(current, [ch])
            valid.append(ch)
        except (ChangeError, KeyError, ValueError) as e:
            rejected.append(f"{ch.path}: {e}")
    return valid, rejected


def _describe(plan: Plan, changes: list[Change]) -> list[dict]:
    out = []
    cur = plan
    for ch in changes:
        d = describe(cur, ch)
        out.append(dict(**d.model_dump(), previous_text=format_value(d.unit, d.previous), value_text=format_value(d.unit, d.value)))
        cur = apply_changes(cur, [ch])
    return out


# --------------------------------------------------------------------------- offline parser

NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
             "ten": 10, "eleven": 11, "twelve": 12, "a": 1, "an": 1, "half a": 6}
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def _num(s: str) -> float:
    s = s.lower().replace("’", "").replace("'", "").replace(",", "").strip()
    mult = 1
    if s.endswith("k"):
        mult, s = 1_000, s[:-1]
    elif s.endswith("m"):
        mult, s = 1_000_000, s[:-1]
    return float(s) * mult


def _when(text: str, default_year: int) -> str | None:
    m = re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d\d)\b", text)
    if m:
        return f"{m.group(2)}-{MONTHS[m.group(1)]:02d}"
    m = re.search(r"\b(20\d\d)-(\d\d)\b", text)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    if "next year" in text:
        return f"{default_year}-01"
    m = re.search(r"\b(?:in|from|by|before)\s+(20\d\d)\b", text)
    if m:
        return f"{m.group(1)}-01"
    return None


def _interpret_offline(plan: Plan, text: str, viewer: str) -> dict:
    t = text.lower()
    changes: list[Change] = []
    notes: list[str] = []
    names = {p.name.lower(): p.id for p in plan.people}
    subject = viewer
    for n, pid in names.items():
        if re.search(rf"\b{n}\b", t):
            subject = pid
            break

    # Career break
    m = re.search(r"(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|an)\s+months?\s+(?:off|break|sabbatical|unpaid|leave)", t) \
        or re.search(r"(?:break|sabbatical|leave|off)\s+(?:of|for)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+months?", t)
    if m or re.search(r"career break|sabbatical|parental leave|time off", t):
        months = 6
        if m:
            g = m.group(1)
            months = int(g) if g.isdigit() else NUM_WORDS.get(g, 6)
        start = _when(t, 2027) or "2027-06"
        pct = 0.0
        pm = re.search(r"(\d+)\s*%\s*(?:of\s+)?(?:income|salary|part)", t)
        if pm:
            pct = float(pm.group(1))
        changes.append(_career_break_change(plan, subject, start, months, pct, 0.0))

    # Home purchase
    if re.search(r"\b(buy|purchase)\w*\b.*\b(house|home|flat|apartment|property)\b", t):
        changes.append(Change(path="shared.property.enabled", value=True))
        changes.append(Change(path="shared.household.enabled", value=True))
        pm = re.search(r"(?:chf\s*)?(\d[\d',.]*\s*[km]?)\s*(?:chf)?\s*(?:house|home|flat|apartment|property)", t) \
            or re.search(r"(?:for|price|budget(?: of)?|costing)\s+(?:chf\s*)?(\d[\d',.]*\s*[km]?)", t)
        if pm:
            try:
                price = _num(pm.group(1))
                if price >= 100_000:
                    changes.append(Change(path="shared.property.price", value=price))
            except ValueError:
                pass
        bm = re.search(r"\b(?:before|by)\s+(20\d\d)\b", t)
        if bm:
            changes.append(Change(path="shared.property.target_date", value=f"{int(bm.group(1)) - 1}-12"))
        im = re.search(r"\b(?:buy|purchase)\w*\b[^.]*?\bin\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+20\d\d|20\d\d)", t)
        if im:
            w = _when("in " + im.group(1), 2027)
            if w:
                changes.append(Change(path="shared.property.purchase", value=w))

    # Mortgage rate
    m = re.search(r"(?:mortgage|interest)\s+(?:rate\s+)?(?:rises?|goes up|increases?|at|of|to)?\s*(?:to\s+)?(\d+(?:\.\d+)?)\s*%", t)
    if m:
        changes.append(Change(path="shared.property.mortgage_rate", value=float(m.group(1)) / 100))

    # Spending changes on a named category
    for p in plan.people:
        if p.id != subject:
            continue
        for c in p.categories:
            if c.label.lower() in t or c.key.replace("_", " ") in t:
                m = re.search(rf"(?:cut|reduce|lower|spend less on)\s+(?:my\s+|our\s+)?{re.escape(c.label.lower())}\s+(?:by\s+)?(\d+)\s*%", t)
                if m:
                    changes.append(Change(path=f"people.{p.id}.categories.{c.key}.budget_monthly",
                                          value=round(c.budget_monthly * (1 - float(m.group(1)) / 100))))
    # Move in together
    if re.search(r"move in together|moving in", t) and not any(c.path == "shared.household.enabled" for c in changes):
        changes.append(Change(path="shared.household.enabled", value=True))
        w = _when(t, 2027)
        if w:
            changes.append(Change(path="shared.household.move_in", value=w))

    valid, rejected = _validate_each(plan, changes)
    if not valid:
        notes.append("I could not map this to a supported change. Try e.g. “Emil takes 12 months off from Jan 2028” or "
                     "“buy a CHF 1.2M home in Oct 2028”.")
    return dict(
        mode="offline", model=None,
        summary="Interpreted with the built-in parser.",
        clarification=notes[0] if notes else None,
        changes=[c.model_dump() for c in valid], described=_describe(plan, valid), rejected=rejected,
    )


# --------------------------------------------------------------------------- decision intake


class IntakeAnswer(StructuredOutput):
    question_id: str
    partner_id: str | None
    number: float | None
    text: str | None
    flag: bool | None


class Intake(StructuredOutput):
    answers: list[IntakeAnswer]
    ambiguities: list[str]
    next_question_id: str | None
    next_question: str | None


INTAKE_SYSTEM = """You help a couple prepare a major financial life decision in the Converge planning app.
You read the question catalogue in the context and, when given, the viewer's message.
Your only jobs:
1. Extract answers the viewer clearly stated, for questions in `questions` (use their exact `id`).
   - `number` for amounts, shares and counts. CHF amounts as plain numbers (1.2 million = 1200000). Shares as decimals (25% = 0.25), except questions whose unit starts with "%", which use 0-100.
   - `text` for months (YYYY-MM), option values (use the option `value`, not its label) and partner ids.
   - `flag` for yes/no questions. Leave the other two fields null.
   - Personal preference questions (`per_partner` true) may only be answered for the viewer: set `partner_id` to the viewer's id. Never state the partner's preferences, even if the viewer describes them.
   - Do not guess. If something is vague, leave it out and add a short question to `ambiguities`.
2. Choose the most useful next question from `open_questions` (or null if none) and phrase it in one or two short, warm sentences addressed to the viewer by name.
   - Keep the meaning of the catalogue prompt. Offer the options in words if there are any.
   - Do not mention numbers that are not in the context.
Never calculate affordability, savings, costs or outcomes, and never say whether a plan is safe: the simulation engine does that."""


def decision_intake(context: dict, text: str | None) -> tuple[Intake | None, dict]:
    """Ask the language model to read an answer and phrase the next question.

    Returns ``(None, meta)`` when no provider is configured or the call fails;
    callers then use the deterministic flow. Output is validated by the caller.
    """
    provider = config.llm_provider()
    if provider is None or not llm_available():
        return None, dict(mode="offline")
    model = llm_model(provider)
    message = f"Context:\n{json.dumps(context, default=str)}\n\n"
    message += f"Viewer's message:\n{text}" if text else "The viewer has not written anything; only choose and phrase the next question."
    try:
        data = _call_structured(provider, model, INTAKE_SYSTEM, message, Intake, 900)
    except Exception as error:
        return None, dict(mode="offline", notice=f"{_failure_notice(provider, 'intake', error)} Using the guided questions.")
    return data, dict(mode="llm", provider=provider, model=model)


# --------------------------------------------------------------------------- explanations

EXPLAIN_SYSTEM = """You explain a financial simulation result to a couple in 2-4 short sentences of plain language.
Use ONLY facts given in the JSON. Every number you write must appear in the facts (you may round CHF amounts to the nearest thousand and write them like CHF 12,000).
Do not give advice beyond the options listed. Do not predict the future; say "under these assumptions" where appropriate. No markdown."""


def _numbers_in(text: str) -> list[float]:
    vals = []
    for m in re.finditer(r"(?<![\w.])(\d{1,3}(?:[,’' ]\d{3})+|\d+(?:\.\d+)?)(\s*[kK]\b)?", text):
        raw = re.sub(r"[,’' ]", "", m.group(1))
        try:
            v = float(raw)
        except ValueError:
            continue
        if m.group(2):
            v *= 1000
        vals.append(v)
    return vals


def _fact_numbers(obj) -> list[float]:
    out: list[float] = []
    if isinstance(obj, dict):
        for v in obj.values():
            out += _fact_numbers(v)
    elif isinstance(obj, list):
        for v in obj:
            out += _fact_numbers(v)
    elif isinstance(obj, bool):
        pass
    elif isinstance(obj, (int, float)):
        out.append(float(obj))
    elif isinstance(obj, str):
        out += _numbers_in(obj)
    return out


def grounded(text: str, facts: dict) -> tuple[bool, list[float]]:
    """True when every number in ``text`` matches a fact (allowing rounding)."""
    known = _fact_numbers(facts)
    unmatched = []
    for v in _numbers_in(text):
        if v < 13 and float(v).is_integer():  # small counts ("2 partners", "6 months") checked loosely
            if any(abs(v - k) < 1e-9 for k in known) or v in (1, 2):
                continue
        ok = any(abs(v - k) <= max(1.0, 0.005 * abs(k), 500 if abs(k) >= 1000 else 0) for k in known)
        ok = ok or any(abs(v - k * 100) < 0.6 for k in known if abs(k) <= 1)  # percentages
        ok = ok or 2020 <= v <= 2040  # years from month labels
        if not ok:
            unmatched.append(v)
    return (not unmatched), unmatched


def deterministic_summary(ev: dict) -> str:
    from converge.engine.evaluate import chf

    parts = []
    if ev["status"] == "on_track":
        parts.append("Under these assumptions the plan keeps both partners above their safety buffers and meets every goal.")
    for i in ev["issues"][:3]:
        parts.append(i["detail"])
    low = min(ev["people"], key=lambda p: p["headroom"])
    parts.append(f"The tightest point is {low['name']}'s cash in {M.label(low['min_cash_month'])}: {chf(low['min_cash'])}.")
    return " ".join(parts)


def explain(ev: dict, recommendations: list[dict] | None = None) -> dict:
    facts = dict(
        status=ev["status"],
        people=[{k: p[k] for k in ("name", "floor", "min_cash", "min_cash_month", "headroom", "end_cash",
                                   "lowest_runway_months")} for p in ev["people"]],
        issues=[{k: i.get(k) for k in ("title", "detail", "drivers")} for i in ev["issues"]],
        property=ev.get("property") and {k: ev["property"][k] for k in ("purchase", "price", "deposit", "mortgage", "contributions")},
        options=[dict(title=r["title"], resolves=r["resolves"], tradeoffs=r["tradeoffs"]) for r in (recommendations or [])],
    )
    fallback = dict(mode="deterministic", text=deterministic_summary(ev), grounded=True)
    provider = config.llm_provider()
    if provider is None:
        return fallback
    model = llm_model(provider)
    try:
        response = _call_structured(provider, model, EXPLAIN_SYSTEM, json.dumps(facts, default=str), Explanation, 500)
        text = response.text.strip()
        if not text:
            raise IncompleteResponse
        if not grounded(text, facts)[0]:
            return dict(**fallback, notice=f"{PROVIDER_NAMES[provider]} explanation failed grounding. Showing the engine summary.")
        return dict(mode="llm", provider=provider, model=model, text=text, grounded=True)
    except Exception as error:
        return dict(**fallback, notice=f"{_failure_notice(provider, 'explanation', error)} Showing the engine summary.")
