"""Extract bounded, evidence-backed memory items after a completed user turn."""
from __future__ import annotations

import asyncio
import json
import re

from pydantic import Field, ValidationError

from converge import ai, config
from converge.voice.memory import Item

INTENT = re.compile(r"\b(want|would like|hope|plan|planning|intend|goal|save for|aim)\b", re.I)
NEGATED = re.compile(r"\b(don't|do not|never|no longer|not planning|not want|not taking)\b", re.I)
GOALS = {"home": "Home", "sabbatical": "Sabbatical", "education": "Education", "family": "Family"}
DATE = re.compile(r"\b(20\d\d-(?:0[1-9]|1[0-2]))\b")
AMOUNT = re.compile(
    r"(?<![\w-])(CHF\s*)?(\d{1,3}(?:[’', \u202f]\d{3})+|\d+)(\.\d+)?(?:\s*([km]))?(?:\s*(CHF|francs?))?(?![\w-])", re.I,
)
AMOUNT_PREFIX = re.compile(r"\b(?:around|about|roughly|approximately)\s*$", re.I)
UNCERTAIN = re.compile(r"^(?:i(?:\s+am|['’]m)?\s+)?(?:not sure|unsure|don['’]t know|do not know|no idea|maybe|hmm)[.! ]*$", re.I)
SYSTEM = """Extract financial discovery memory from the current user turn only.
Use short keys (goal slug or slug.field). Fields: amount (CHF number), date (YYYY-MM, or YYYY for an unspecified month),
priority (high/medium/low), flexibility (delay/lower/both/neither), risk, why, and partner_agreement.
For life_priorities and goal_tradeoff, use those exact keys. Keep open-ended answers in the user's own words.
Dimensions: goals, priorities, timelines, feasibility, risk_flexibility.
A fact requires an exact verbatim quote from the current user turn. Inferences must be tentative.
For an unknown, return null value/quote and a short why it matters. Never ask about the UBS income, balances, spending or debts.
Previous question only supplies the topic; do not treat it as evidence. Leave feasibility to the simulation engine."""


# Give the provider a closed schema but validate individual returned entries so one bad item does not erase the rest.
class Candidate(ai.StructuredOutput):
    dimension: str
    key: str
    value: str | float | None
    kind: str
    confidence: float
    quote: str | None
    why: str | None


class Candidates(ai.StructuredOutput):
    items: list[Candidate] = Field(max_length=12)


def amount(text: str, bare: bool = False) -> float | None:
    for match in AMOUNT.finditer(text):
        prefix, raw, decimal, suffix, currency = match.groups()
        explicit = prefix or currency or suffix
        approximate = AMOUNT_PREFIX.search(text[:match.start()])
        bare_reply = bare and match[0].strip(" .,!") == text.strip(" .,!")
        if not (explicit or approximate or bare_reply):
            continue
        if text[match.end():].lstrip().startswith("%") or (not explicit and re.fullmatch(r"20\d{2}", raw)):
            continue
        value = ai._num(re.sub(r"\s+", "", raw) + (decimal or "") + (suffix or ""))
        if 0 < value <= 1e9:
            return value
    return None


def date(text: str) -> str | None:
    match = DATE.search(text)
    if match:
        return match[0]
    year = re.search(r"\b20\d{2}\b", text)
    if year:
        lower = text.casefold()
        has_month = any(re.search(rf"\b{name}[a-z]*\.?\s+{year[0]}\b", lower) for name in ai.MONTHS)
        return ai._when(lower, int(year[0])) if has_month else year[0]
    return None


def flexibility(text: str) -> str | None:
    if re.search(r"\bneither\b", text):
        return "neither"
    if re.search(r"\b(both|either)\b", text):
        return "both"
    # In a comparison, only the preference before "rather than" or "instead of" counts.
    preference = re.split(r"\b(?:rather than|instead of|before)\b", text, maxsplit=1)[0]
    delay = re.search(r"\b(delay|postpone|push (?:it|the date) back)\b", preference)
    lower = re.search(r"\b(lower|reduce|cut)\b", preference)
    if re.search(r"\b(?:not|never|wouldn['’]t|don['’]t)\b", preference):
        return None
    return "both" if delay and lower else "delay" if delay else "lower" if lower else None


def tradeoff_answer(text: str, options: dict[str, str]) -> str | None:
    if re.fullmatch(r"(?:the )?first[.! ]*", text):
        return next(iter(options), None)
    if re.fullmatch(r"(?:the )?second[.! ]*", text):
        return list(options)[1] if len(options) == 2 else None
    preference = re.split(r"\b(?:over|before|rather than|instead of)\b", text, maxsplit=1)[0]
    matches = [key for key, title in options.items() if re.search(rf"\b{re.escape(title.casefold())}\b", preference)]
    return matches[0] if len(matches) == 1 else None


def offline(text: str, question: dict | None = None) -> list[Item]:
    lower = text.casefold()
    key = (question or {}).get("key", "")
    if re.search(r"\b(prefer not to say|skip|rather not)\b", lower):
        return []
    out = []

    def add(dimension, item_key, value):
        if value is not None:
            out.append(Item(dimension=dimension, key=item_key, value=value, kind="fact",
                            confidence=1.0, quote=text, why=None))

    if key == "life_priorities" and not UNCERTAIN.fullmatch(lower.strip()):
        add("priorities", key, text)
    if key == "goal_tradeoff":
        options = (question or {}).get("options", {})
        winner = tradeoff_answer(lower, options)
        if winner:
            add("priorities", key, winner)
            for slug in options:
                add("priorities", f"{slug}.priority", "high" if slug == winner else "low")

    goal = next((slug for slug, terms in {
        "home": r"\b(buy|purchase|own|save for)\b.{0,30}\b(home|house|flat|apartment)\b",
        "sabbatical": r"\b(sabbatical|career break|time off)\b",
        "education": r"\b(save for|pay for|fund|study)\b.{0,30}\b(education|degree|course|university)\b",
        "family": r"\b(have|plan for|save for)\b.{0,20}\b(child|baby)\b",
    }.items() if re.search(terms, lower)), None)
    if goal and not NEGATED.search(text) and (INTENT.search(text) or key in {"discovery", "life_priorities"}):
        add("goals", goal, GOALS[goal])
    elif goal:
        goal = None

    if not goal and "." in key:
        goal = key.split(".")[0]
    if goal:
        asked = key.split(".")[-1] if key.startswith(goal + ".") else ""
        budget = amount(text, bare=asked == "amount")
        add("goals", f"{goal}.amount", budget)
        target = date(text)
        if asked != "amount" or budget is None or (target and DATE.fullmatch(target)):
            add("timelines", f"{goal}.date", target)
        if asked in {"why", "partner_agreement"} and not UNCERTAIN.fullmatch(lower.strip()):
            add("goals" if asked == "why" else "priorities", key, text)
        if asked == "priority":
            level = re.search(r"\b(high|medium|low)\b", lower)
            add("priorities", key, level[0] if level else None)
        if asked == "flexibility":
            add("risk_flexibility", key, flexibility(lower))
        if asked == "risk":
            add("risk_flexibility", key, text)
        if asked == "permission" and lower.strip(".! ") in {"yes", "no", "sure", "okay"}:
            add("risk_flexibility", key, "no" if lower.strip(".! ") == "no" else "yes")
    return out


def supported_fact(item: Item, text: str, question: dict | None = None) -> bool:
    if not item.quote or item.quote not in text:
        return False
    if any(candidate.key == item.key and candidate.value == item.value for candidate in offline(item.quote, question)):
        return True
    # Beyond the rules, save a first-person statement verbatim. Unverifiable paraphrases stay inferences.
    return (isinstance(item.value, str) and item.value.casefold() in item.quote.casefold()
            and bool(re.search(r"\b(I|my|we|our)\b", item.quote, re.I))
            and (item.dimension != "goals" or (INTENT.search(item.quote) and not NEGATED.search(item.quote))))


async def extract(text: str, question: dict | None = None) -> list[Item]:
    fallback = offline(text, question)
    provider = config.llm_provider()
    if provider is None or not ai.llm_available() or re.search(r"\b(prefer not to say|rather not)\b", text, re.I):
        return fallback
    try:
        output = await asyncio.to_thread(ai._call_structured, provider, ai.llm_model(provider), SYSTEM,
                                         json.dumps({"question": question, "utterance": text}), Candidates, 600)
    except Exception:
        return fallback
    accepted = {(item.key, str(item.value), item.kind): item for item in fallback}
    for raw in output.items:
        try:
            item = Item.model_validate(raw.model_dump())
        except ValidationError:
            continue
        if item.quote and item.quote not in text:
            continue
        if item.kind == "fact" and not supported_fact(item, text, question):
            continue
        accepted.setdefault((item.key, str(item.value), item.kind), item)
    return list(accepted.values())
