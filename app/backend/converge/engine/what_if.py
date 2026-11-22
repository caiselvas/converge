"""Isolated choices and paired sensitivity checks over the existing monthly ledger."""
from __future__ import annotations

from math import exp, log1p, sqrt
from random import Random
from statistics import quantiles
from typing import Literal

from pydantic import Field

from converge.engine import months as M
from converge.engine.changes import apply_changes, get_value
from converge.engine.evaluate import chf, evaluate
from converge.engine.simulate import SimResult, simulate
from converge.models import STUDY_SEMESTERS, CareerBreak, Change, Model, Month, Plan, StudyProgram

PROGRAMS = {
    "quant_finance": {
        "label": "Quantitative Finance MSc",
        "school": "UZH / ETH Zürich",
        "semesters": STUDY_SEMESTERS["quant_finance"],
        "semester_fee_chf": 780,
        "source": "https://www.msfinance.uzh.ch/en/admission/applicationinformation.html",
    },
    "fine_arts": {
        "label": "Fine Arts MA",
        "school": "ZHdK",
        "semesters": STUDY_SEMESTERS["fine_arts"],
        "semester_fee_chf": 755,
        "source": "https://www.zhdk.ch/en/degree-programmes/finearts/master-fine-arts",
        "fees_source": "https://www.zhdk.ch/en/degree-programmes/tuition-fees",
    },
}
GRADUATE_SURVEY = "https://dam-api.bfs.admin.ch/hub/api/dam/assets/32172110/master"
TRIALS = 128
SEED = 20261122


class Study(Model):
    person: str
    program: StudyProgram
    start: Month
    income_pct: float = Field(ge=0, le=100)
    semester_fee_chf: float | None = Field(None, ge=0, le=100_000)
    extra_cost_chf: float = Field(0, ge=0, le=100_000)
    monthly_pay_delta: float = Field(0, ge=-50_000, le=50_000)
    replace_overlapping_breaks: bool = False


class Housing(Model):
    arrangement: Literal["current", "separate", "together"] = "current"
    move_in: Month | None = None
    rent: float | None = Field(None, ge=0, le=50_000)
    split: Literal["equal", "income", "custom"] | None = None
    first_share: float | None = Field(None, ge=0, le=1)
    adjust_for_breaks: bool | None = None
    purchase: Literal["keep", "exclude", "include"] = "keep"


class Uncertainty(Model):
    inflation_spread: float = Field(0.015, ge=0, le=0.10)
    investment_volatility: float = Field(0.10, ge=0, le=0.50)


class WhatIf(Model):
    study: Study | None = None
    housing: Housing = Field(default_factory=Housing)
    uncertainty: Uncertainty | None = None


def scenario_changes(plan: Plan, choice: WhatIf) -> tuple[list[Change], dict]:
    housing = choice.housing
    study = choice.study
    changes = []
    inputs = {}
    if housing.arrangement == "separate":
        if housing.purchase == "include":
            raise ValueError("A joint purchase requires shared housing.")
        changes.extend([Change(path="shared.household.enabled", value=False),
                        Change(path="shared.property.enabled", value=False)])
    elif housing.purchase != "keep":
        changes.append(Change(path="shared.property.enabled", value=housing.purchase == "include"))
    if housing.arrangement == "together":
        fields = {
            "household.enabled": True, "household.move_in": housing.move_in,
            "household.rent": housing.rent, "split.mode": housing.split,
            "split.custom_share_first": housing.first_share, "split.adjust_for_breaks": housing.adjust_for_breaks,
        }
        changes.extend(Change(path=f"shared.{key}", value=value) for key, value in fields.items() if value is not None)
    inputs["housing"] = housing.arrangement
    if study is not None:
        person = plan.person(study.person)
        program = PROGRAMS[study.program]
        start = plan.assumptions.start
        end = M.add(start, plan.assumptions.horizon_months)
        if not start <= study.start < end:
            raise ValueError("Study must start inside the projection window.")
        duration = program["semesters"] * 6
        finish = M.add(study.start, duration)
        fee = program["semester_fee_chf"] if study.semester_fee_chf is None else study.semester_fee_chf
        used = {event.id for event in person.career_breaks}
        replaced = [
            event for event in person.career_breaks
            if study.replace_overlapping_breaks
            and event.start < finish and study.start < M.add(event.start, event.months)
        ]
        event_id = next(f"study-{i}" for i in range(1, len(used) + 2) if f"study-{i}" not in used)
        period = CareerBreak(id=event_id, label=program["label"], start=study.start, months=duration,
                             income_pct=study.income_pct, semester_fee_chf=fee, one_off_cost_chf=study.extra_cost_chf,
                             study_program=study.program, post_study_pay_delta_chf=study.monthly_pay_delta)
        changes.append(Change(path=f"people.{person.id}.career_breaks",
                              value=[p.model_dump() for p in [*person.career_breaks, period] if p not in replaced]))
        inputs["study"] = {**study.model_dump(), "name": person.name, "program": program["label"],
                           "duration_months": duration, "first_month_after_study": finish, "semester_fee_chf": fee,
                           "published_semester_fee_chf": program["semester_fee_chf"], "source": program["source"]}
        if replaced:
            inputs["study"]["replaced_breaks"] = [
                {"label": event.label, "start": event.start, "months": event.months} for event in replaced
            ]
    # A caller can rely on stable changes when repeating an identical comparison.
    return [change for change in changes if get_value(plan, change.path) != change.value], inputs


def _lines(result: SimResult) -> list[dict]:
    lines = [
        {"id": s.pid, "name": s.name, "cash": s.cash, "net_worth": s.net_worth, "cash_floor": s.floor}
        for s in result.people
    ]
    lines.append({
        "id": "combined", "name": "Combined", "cash_floor": None,
        **{key: [sum(values) for values in zip(*(item[key] for item in lines))] for key in ("cash", "net_worth")},
    })
    return lines


def _summary(line: dict, months: list[str], include_series: bool) -> dict:
    cash, worth, floor = line["cash"], line["net_worth"], line["cash_floor"]
    minimum = min(cash)
    summary = {
        "id": line["id"], "name": line["name"], "cash_floor": floor, "minimum_cash": round(minimum, 2),
        "minimum_cash_month": months[cash.index(minimum)], "end_cash": round(cash[-1], 2),
        "end_net_worth": round(worth[-1], 2),
        "buffer_gap": None if floor is None else round(minimum - floor, 2),
    }
    if include_series:
        summary.update(cash=[round(x, 2) for x in cash], net_worth=[round(x, 2) for x in worth])
    return summary


def _risk(plans: tuple[Plan, Plan], uncertainty: Uncertainty) -> dict:
    rng = Random(SEED)
    horizon = plans[0].assumptions.horizon_months
    vol = uncertainty.investment_volatility
    counts = [[0, 0, 0], [0, 0, 0]]
    combined_worth = [[], []]
    for _ in range(TRIALS):
        inflation_shock = rng.uniform(-uncertainty.inflation_spread, uncertainty.inflation_spread)
        market_shocks = [rng.gauss(0, 1) for _ in range(horizon)]
        for index, plan in enumerate(plans):
            a = plan.assumptions
            inflation = max(-0.05, min(0.20, a.expense_inflation + inflation_shock))
            stressed = plan.model_copy(update={"assumptions": a.model_copy(update={"expense_inflation": inflation})})
            drift = (log1p(a.investment_return) - vol ** 2 / 2) / 12
            factors = [exp(drift + vol * z / sqrt(12)) for z in market_shocks]
            result = simulate(stressed, investment_factors=factors)
            combined_worth[index].append(sum(s.net_worth[-1] for s in result.people))
            breaches = [min(s.cash) < s.floor - 0.005 for s in result.people]
            for i, breach in enumerate([*breaches, any(breaches)]):
                counts[index][i] += breach
    def interval(values: list[float]) -> list[float]:
        deciles = quantiles(values, n=10, method="inclusive")
        return [round(deciles[i], 2) for i in (0, 4, 8)]

    return {"trials": TRIALS, "seed": SEED, "inflation_spread": uncertainty.inflation_spread,
            "investment_volatility": vol, "baseline_breaches": counts[0], "scenario_breaches": counts[1],
            "baseline_worth": interval(combined_worth[0]), "scenario_worth": interval(combined_worth[1]),
            "paired_worth_delta": interval([after - before for before, after in zip(*combined_worth)])}


def compare(plan: Plan, choice: WhatIf, *, include_series: bool = True) -> dict:
    changes, inputs = scenario_changes(plan, choice)
    scenario = apply_changes(plan, changes) if changes else plan
    result = compare_applied(plan, scenario, inputs=inputs, uncertainty=choice.uncertainty, include_series=include_series)
    return {**result, "draft_changes": [change.model_dump() for change in changes]}


def compare_applied(
    plan: Plan, scenario: Plan, *, inputs: dict | None = None, uncertainty: Uncertainty | None = None,
    include_series: bool = False,
) -> dict:
    base_run, scenario_run = simulate(plan), simulate(scenario)
    inputs = {"housing": "current", **(inputs or {})}
    inputs["scenario_housing"] = scenario.shared.household.model_dump()
    inputs["scenario_split"] = scenario.shared.split.model_dump()
    inputs["scenario_home_purchase_enabled"] = scenario.shared.property.enabled
    if scenario.shared.property.enabled:
        inputs["scenario_home_purchase"] = {"price": scenario.shared.property.price,
                                            "month": scenario.shared.property.purchase}
    base_lines, scenario_lines = _lines(base_run), _lines(scenario_run)
    baseline, alternative = [
        [_summary(line, run.months, include_series) for line in _lines(run)]
        for run in (base_run, scenario_run)
    ]
    for before, after, base_line, scenario_line in zip(baseline, alternative, base_lines, scenario_lines):
        gap = [round(a - b, 2) for a, b in zip(scenario_line["net_worth"], base_line["net_worth"])]
        last_behind = next((i for i in range(len(gap) - 1, -1, -1) if gap[i] < 0), None)
        after.update(
            change_in_minimum_cash=round(after["minimum_cash"] - before["minimum_cash"], 2),
            change_in_end_net_worth=gap[-1],
            net_worth_went_below_baseline=last_behind is not None,
            net_worth_break_even_month=base_run.months[last_behind + 1]
            if last_behind is not None and last_behind + 1 < len(gap) else None,
        )
    issues = [{k: issue[k] for k in ("title", "person", "severity")}
              for issue in evaluate(scenario, scenario_run)["issues"]]
    cash_comparison = " ".join(
        f"{after['name']}'s lowest month-end cash goes from {chf(before['minimum_cash'])} to {chf(after['minimum_cash'])}."
        for before, after in zip(baseline[:2], alternative[:2])
    )
    return {
        "start": base_run.months[0], "end": base_run.months[-1],
        **({"months": base_run.months} if include_series else {}),
        "baseline": baseline, "scenario": alternative, "issues": issues, "inputs": inputs,
        "speakable": cash_comparison,
        "checks_passed": base_run.checks["ok"] and scenario_run.checks["ok"],
        "risk": _risk((plan, scenario), uncertainty) if uncertainty is not None else None,
    }


def compact_comparison(result: dict) -> dict:
    """Keep the verified endpoints and assumptions without the display series."""
    if "months" not in result:
        return result
    compact = {key: value for key, value in result.items() if key != "months"}
    for key in ("baseline", "scenario"):
        compact[key] = [{k: v for k, v in line.items() if k not in {"cash", "net_worth"}} for line in result[key]]
    return compact
