"""Extract bounded, evidence-backed memory items after a completed user turn."""
from __future__ import annotations

import asyncio
import json
import re

from pydantic import Field, ValidationError

from converge import ai, config
from converge.voice.memory import Item

GOALS = {"home": "Home", "sabbatical": "Sabbatical", "education": "Education", "family": "Family"}
DATE = re.compile(r"\b(20\d\d-(?:0[1-9]|1[0-2]))\b")
AMOUNT = re.compile(r"(?<!\w)(?:CHF\s*)?(\d[\d’',]*(?:\.\d+)?)\s*([km])?(?:\s*CHF)?(?!\w)", re.I)
SYSTEM = """Extract financial discovery memory from the current user turn only.
Use short keys (goal slug or slug.field). Fields: amount (CHF number), date (YYYY-MM, or YYYY for an unspecified month),
priority (high/medium/low), flexibility (delay/lower/both/neither), risk (the user's own words).
Dimensions: goals, priorities, timelines, feasibility, risk_flexibility.
A fact requires an exact verbatim quote from the current user turn. Inferences must be tentative.
For an unknown, return null value/quote and a short why it matters. Never ask about the UBS income, balances, spending or debts.
Previous question only supplies the topic; do not treat it as evidence. Do not calculate financial outcomes."""


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
        raw, suffix = match.groups()
        if not suffix and "chf" not in match[0].lower() and not (bare and match[0].strip() == text.strip()):
            continue
        if match.end() < len(text) and text[match.end()] == "-":
            continue
        value = ai._num(raw + (suffix or ""))
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

    goal = next((slug for slug, terms in {
        "home": r"\b(buy|purchase|own|save for)\b.{0,30}\b(home|house|flat|apartment)\b",
        "sabbatical": r"\b(sabbatical|career break|time off)\b",
        "education": r"\b(save for|pay for|fund|study)\b.{0,30}\b(education|degree|course|university)\b",
        "family": r"\b(have|plan for|save for)\b.{0,20}\b(child|baby)\b",
    }.items() if re.search(terms, lower)), None)
    if goal and not re.search(r"\b(don't|do not|never|no longer|not planning|not want|not taking)\b", lower):
        add("goals", goal, GOALS[goal])
    elif goal:
        goal = None

    if not goal and "." in key:
        goal = key.split(".")[0]
    if goal:
        asked = key.split(".")[-1] if key.startswith(goal + ".") else ""
        add("feasibility", f"{goal}.amount", amount(text, bare=asked == "amount"))
        add("timelines", f"{goal}.date", date(text) if asked != "amount" or not re.fullmatch(r"\d+", text.strip()) else None)
        if asked == "priority":
            level = re.search(r"\b(high|medium|low)\b", lower)
            add("priorities", key, level[0] if level else None)
        if asked == "flexibility":
            choice = {"delay": "delay", "lower": "lower", "both": "both", "neither": "neither"}
            add("risk_flexibility", key, choice.get(lower.strip(".! ")))
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
    return item.dimension != "goals" and isinstance(item.value, str) and item.value.casefold() in item.quote.casefold() and bool(
        re.search(r"\b(I|my|we|our)\b", item.quote, re.I)
    )


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
