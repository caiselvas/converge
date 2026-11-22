"""Prepare an editable study comparison from a short spoken exchange."""
from __future__ import annotations

import re
from calendar import month_name
from datetime import date as calendar_date

from pydantic import Field

from converge.ai import StructuredOutput
from converge.engine import months as M
from converge.engine.evaluate import chf
from converge.engine.what_if import Study, WhatIf, compare
from converge.models import Month, Plan, StudyProgram
from converge.voice.extract import date as extract_date

PROGRAMMES = {
    "quant_finance": re.compile(r"\b(?:quant(?:itative)? finance)\b", re.I),
    "fine_arts": re.compile(r"\bfine arts\b", re.I),
}
MONTH = re.compile(r"\b(" + "|".join(month_name[1:]) + r")\b", re.I)
PAY = re.compile(r"(?<![\w.-])(\d{1,3}(?:\.\d+)?)\s*(?:%|percent\b)", re.I)
SPOKEN_PAY = {
    "zero": 0, "ten": 10, "twenty": 20, "twenty five": 25, "thirty": 30,
    "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "seventy five": 75,
    "eighty": 80, "ninety": 90, "one hundred": 100,
}
REQUEST = re.compile(r"\b(?:run it|run (?:the |a )?(?:simulation|comparison|numbers)|simulate|compare|try it|go ahead)\b", re.I)
OTHER_CHANGE = re.compile(r"\b(?:partner|together|mortgage|house|home|rent|CHF|francs|scholarship)\b", re.I)
DECLINE = re.compile(r"\b(?:not interested|won['’]t|don['’]t want|do not want|never mind|rather not|skip|stop|cancel)\b", re.I)


class StudyPreviewArgs(StructuredOutput):
    programme: StudyProgram | None = None
    start: Month | None = None
    income_pct: float | None = Field(None, ge=0, le=100)
    extra_cost_chf: float | None = Field(None, ge=0, le=100_000)
    monthly_pay_delta: float | None = Field(None, ge=-50_000, le=50_000)


def _month(text: str, today: calendar_date, default_start: str) -> tuple[str | None, bool]:
    explicit = extract_date(text)
    if explicit and len(explicit) == 7:
        return explicit, False
    name = MONTH.search(text)
    year = int(explicit) if explicit else None
    if re.search(r"\bnext year\b", text, re.I):
        year = today.year + 1
    elif re.search(r"\bthis year\b", text, re.I):
        year = today.year
    if name:
        if name[0].casefold() == "may" and year is None and not re.search(r"\b(?:in|from) may\b", text, re.I):
            return None, True
        month = list(month_name).index(name[0].capitalize())
        if year is None:
            year = int(default_start[:4]) + (month < int(default_start[5:]))
        return f"{year:04d}-{month:02d}", not (explicit or re.search(r"\b(?:next|this) year\b", text, re.I))
    return (f"{year:04d}-09", True) if year else (None, True)


def _pay(text: str) -> float | None:
    values = PAY.findall(text)
    if len(values) == 1 and 0 <= float(values[0]) <= 100:
        return float(values[0])
    if not values:
        spoken = [value for word, value in SPOKEN_PAY.items()
                  if re.search(rf"\b{word} percent\b", text.replace("-", " "), re.I)]
        if len(spoken) == 1:
            return spoken[0]
    if re.search(r"\b(?:half(?: of)? (?:my|the|usual|normal)|half pay)\b", text, re.I):
        return 50
    return None


def study_preview(plan: Plan, person: str, turns: list[str], args: StudyPreviewArgs, *,
                  automatic: bool = False, include_series: bool = False, today: calendar_date | None = None) -> dict | None:
    latest = turns[-1] if turns else ""
    topic = " ".join(turns[-3:])
    matches = [key for key, pattern in PROGRAMMES.items() if pattern.search(latest)]
    today = today or calendar_date.today()
    first = max(plan.assumptions.start, f"{today.year:04d}-{today.month:02d}")
    next_september = f"{int(first[:4]) + (first[5:] > '09'):04d}-09"
    scenario_start = args.start
    income_pct = args.income_pct
    assumed_start = scenario_start is None
    programme = args.programme

    if automatic:
        if DECLINE.search(latest) or OTHER_CHANGE.search(topic) or len(matches) > 1:
            return None
        if not (matches or REQUEST.search(latest) or _pay(latest) is not None or _month(latest, today, first)[0]):
            return None

    for turn in reversed(turns):
        mentioned = [key for key, pattern in PROGRAMMES.items() if pattern.search(turn)]
        if programme is None and len(mentioned) > 1:
            break
        if programme is None and len(mentioned) == 1 and not DECLINE.search(turn):
            programme = mentioned[0]
        if scenario_start is None:
            scenario_start, assumed_start = _month(turn, today, first)
        if income_pct is None:
            income_pct = _pay(turn)
    if programme is None:
        return None

    start = scenario_start or next_september
    if not scenario_start and start >= M.add(plan.assumptions.start, plan.assumptions.horizon_months):
        start = first
    choice = WhatIf(study=Study(
        person=person, program=programme, start=start, income_pct=30 if income_pct is None else income_pct,
        extra_cost_chf=args.extra_cost_chf or 0, monthly_pay_delta=args.monthly_pay_delta or 0,
        replace_overlapping_breaks=True,
    ))
    result = compare(plan, choice, include_series=include_series)
    result.pop("draft_changes", None)
    result["assumed_inputs"] = [
        label for label, assumed in (
            ("start month", assumed_start), ("take-home pay during study", income_pct is None),
            ("extra study costs", args.extra_cost_chf is None), ("pay after study", args.monthly_pay_delta is None),
        ) if assumed
    ]
    after = next(line for line in result["scenario"] if line["id"] == person)
    before = next(line for line in result["baseline"] if line["id"] == person)
    gap = after["buffer_gap"]
    replaced = result["inputs"]["study"].get("replaced_breaks", [])
    if replaced:
        result["assumed_inputs"].append("the study scenario replaces overlapping planned leave")
    pay = choice.study.income_pct
    result["speakable"] = (
        f"The {result['inputs']['study']['program']} first pass starts in {M.label(start)} and uses "
        f"{pay:g}% of normal pay while studying. Your lowest cash moves from "
        f"{chf(before['minimum_cash'])} to {chf(after['minimum_cash'])}, "
        f"{chf(abs(gap))} {'above' if gap >= 0 else 'below'} your buffer."
    )
    return result
