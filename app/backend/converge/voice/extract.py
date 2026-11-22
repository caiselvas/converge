"""Extract bounded, evidence-backed memory items after a completed user turn."""
from __future__ import annotations

import asyncio
import json
import re

from pydantic import ValidationError

from converge import ai, config
from converge.voice.memory import Item

INTENT = re.compile(r"\b(want|would like|hope|plan|planning|intend|goal|save for|aim|trying to|thinking (?:of|about)|going back and forth about|consider(?:ing)?)\b", re.I)
NEGATED = re.compile(r"\b(don't|do not|never|no longer|not planning|not want|not taking)\b", re.I)
GOALS = {"home": "Home", "sabbatical": "Sabbatical", "masters": "Master’s degree", "education": "Education", "family": "Family"}
DATE = re.compile(r"\b(20\d\d-(?:0[1-9]|1[0-2]))\b")
AMOUNT = re.compile(
    r"(?<![\w-])(CHF\s*)?(\d{1,3}(?:[’', \u202f]\d{3})+|\d+)(\.\d+)?(?:\s*([km]))?(?:\s*(CHF|francs?))?(?![\w-])", re.I,
)
AMOUNT_PREFIX = re.compile(r"\b(?:around|about|roughly|approximately)\s*$", re.I)
CONFIRM = re.compile(r"\b(yes|exactly|that['’]s right|i confirm|my (?:real |underlying )?(?:goal|objective|aim) is)\b", re.I)
DECLINE = re.compile(r"\b(prefer not to say|rather not say|skip this|skip that|let['’]s skip|don['’]t want to discuss)\b", re.I)
SYSTEM = """Extract facts from the current quoted user turn, with the previous user turns as context for which goal they mean.
For each goal use a slug and keys slug.stated_goal, slug.underlying_objective, slug.alternatives,
slug.constraints, slug.decision_status (exploring/decided), slug.amount (CHF), slug.date (YYYY-MM, year alone if incomplete),
slug.priority, slug.flexibility. Use skip.topic for explicit opt-outs. The five dimensions are goals, priorities, timelines,
feasibility, risk_flexibility. Underlying objectives are inferences until the user explicitly confirms them in their own words
with a verbatim quote containing the objective. When the user confirms, set kind fact and use the exact objective words as value.
For example the value for “Yes, my real objective is more time with my daughter” is “more time with my daughter”.
Reuse the goal slug in the supplied memory context. Use verbatim excerpts for stated goals.
A request to look up a number is a question, not a stated life goal.
An unknown needs a reason and no value or quote. Use a verbatim quote for every fact. Do not infer feasibility or causal effects."""


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
    items: list[Candidate]


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


def offline(text: str, question: dict | None = None) -> list[Item]:
    lower = text.casefold()
    key = (question or {}).get("key", "")
    if DECLINE.search(text):
        return [Item(dimension="risk_flexibility", key="skip.unspecified", value="opted out", kind="fact", confidence=1.0, quote=text, why=None)]
    out = []

    def add(dimension, item_key, value):
        if value is not None:
            out.append(Item(dimension=dimension, key=item_key, value=value, kind="fact",
                            confidence=1.0, quote=text, why=None))

    goal = next((slug for slug, terms in {
        "home": r"\b(buy|purchase|own|save for)\b.{0,30}\b(home|house|flat|apartment)\b",
        "masters": r"\b(?:master[’']?s|(?:start|do|pursue|study for)\s+(?:a\s+)?master)\b",
        "sabbatical": r"\b(sabbatical|career break|time off)\b",
        "education": r"\b(save for|pay for|fund|study)\b.{0,30}\b(education|degree|course|university)\b",
        "family": r"\b(have|plan for|save for)\b.{0,20}\b(child|baby)\b",
    }.items() if re.search(terms, lower)), None)
    if goal and not NEGATED.search(text) and (INTENT.search(text) or key == "discovery"):
        add("goals", f"{goal}.stated_goal", GOALS[goal])
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
    if item.key.startswith("skip."):
        return bool(DECLINE.search(item.quote))
    quoted_value = isinstance(item.value, str) and item.value.casefold() in item.quote.casefold()
    if item.key.endswith(".underlying_objective"):
        return bool(quoted_value and CONFIRM.search(text) and re.search(r"\b(i|my)\b", text, re.I))
    if item.key.endswith(".decision_status"):
        return item.value == "decided" and bool(re.search(r"\bi (?:choose|decided|have decided|will go with)\b", item.quote, re.I))
    if item.key.endswith((".amount", ".date", ".flexibility", ".priority")):
        question = {"key": item.key}
    if any(candidate.key == item.key and candidate.value == item.value for candidate in offline(item.quote, question)):
        return True
    if "." not in item.key and any(candidate.key == f"{item.key}.stated_goal" and candidate.value == item.value
                                   for candidate in offline(item.quote)):
        return True
    # Beyond the rules, save a first-person statement verbatim. Unverifiable paraphrases stay inferences.
    return (isinstance(item.value, str) and item.value.casefold() in item.quote.casefold()
            and bool(re.search(r"\b(I|my|we|our)\b", item.quote, re.I))
            and (item.dimension != "goals" or (INTENT.search(item.quote) and not NEGATED.search(item.quote))))


async def extract(text: str, question: dict | None = None, *, usage=None) -> list[Item]:
    fallback = offline(text, question)
    provider = config.llm_provider()
    if provider is None or not ai.llm_available():
        return fallback
    try:
        output = await asyncio.to_thread(ai._call_structured, provider, ai.llm_model(provider), SYSTEM,
                                         json.dumps({"context": question, "utterance": text}), Candidates, 750,
                                         **({"usage": usage} if usage is not None else {}))
    except Exception:
        return fallback
    accepted = {(item.key, str(item.value), item.kind): item for item in fallback}
    for raw in output.items[:12]:
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
