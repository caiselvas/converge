"""Read-only profile and scenario comparison tools."""
from __future__ import annotations

from itertools import permutations
from typing import Literal

from pydantic import Field, model_validator

from converge.ai import StructuredOutput
from converge.engine import months as M
from converge.engine.changes import apply_changes
from converge.engine.evaluate import chf, evaluate
from converge.models import Change, Plan

HISTORICAL = "historical UBS data"
ASSUMPTION = "plan assumption"
SIMULATED = "simulated"
COMPARISON_MONTHS = 120
EXTRAPOLATION = ("Years beyond the default horizon are less certain. They extrapolate using constant assumptions "
                 "for income growth, inflation and returns.")
Topic = Literal["income", "spending", "balances", "debts", "goals", "savings_rate", "events"]


class ProfileArgs(StructuredOutput):
    person: str | None = None
    topic: Topic


class Path(StructuredOutput):
    name: str = Field(min_length=1, max_length=80)
    changes: list[Change] = Field(max_length=50)
    assumption_source: Literal["user_expectation", "illustrative", "existing_plan"] = "illustrative"


class CompareArgs(StructuredOutput):
    paths: list[Path] = Field(min_length=2, max_length=3)
    focus_goal: str | None = None

    @model_validator(mode="after")
    def distinct_paths(self):
        if len({p.name.strip().casefold() for p in self.paths}) != len(self.paths) or any(not p.name.strip() for p in self.paths):
            raise ValueError("Use distinct, nonempty path names.")
        if any(change.path == "assumptions.horizon_months" for path in self.paths for change in path.changes):
            raise ValueError("Path comparisons use the saved plan horizon and a common 120-month horizon.")
        return self


def figure(value, provenance, **detail):
    return {"value": value, "provenance": provenance, **detail}


def profile(plan: Plan, person: str, topic: Topic) -> dict:
    p = next((p for p in plan.people if person.casefold() in {p.id.casefold(), p.name.casefold()}), None)
    if p is None:
        raise ValueError("Unknown demo partner.")
    if topic == "income":
        data = {
            "observed_net_chf_monthly": figure(p.income_observed_monthly, HISTORICAL, period="trailing 12 months"),
            "planned_net_chf_monthly": figure(p.income_monthly, ASSUMPTION),
            "future_steps": figure([step.model_dump() for step in p.income_steps], ASSUMPTION),
            "tax_budget_outside_payroll_chf_monthly": figure(p.income_tax_monthly, ASSUMPTION),
        }
    elif topic == "spending":
        data = {"categories": [{"key": c.key, "label": c.label,
                                "observed_chf_monthly": figure(c.observed_monthly, HISTORICAL),
                                "budget_chf_monthly": figure(c.budget_monthly, ASSUMPTION)} for c in p.categories],
                "observed_total_chf_monthly": figure(round(sum(c.observed_monthly for c in p.categories), 2), HISTORICAL),
                "budget_total_chf_monthly": figure(round(sum(c.budget_monthly for c in p.categories), 2), ASSUMPTION)}
    elif topic == "balances":
        data = {"opening_cash": figure(p.opening_cash, HISTORICAL, as_of=p.opening_cash_date),
                "investments": figure(p.investments, HISTORICAL, as_of=p.investments_as_of),
                "vested_pension_at_start_chf": figure(p.pension_opening_chf, ASSUMPTION),
                "pension_credit_at_usual_pay_chf_monthly": figure(p.pension_credit_monthly, ASSUMPTION)}
    elif topic == "debts":
        data = {"opening_liabilities": figure(
            [{"kind": loan.kind, "principal_chf": loan.principal_chf} for loan in p.liabilities], HISTORICAL),
            "repayment_terms": figure([{"kind": loan.kind, "annual_rate": loan.annual_rate,
                                         "monthly_payment_chf": loan.monthly_payment_chf} for loan in p.liabilities], ASSUMPTION)}
    else:
        ev = evaluate(plan)
        if topic == "goals":
            simulated = next(result["goals"] for result in ev["people"] if result["id"] == p.id)
            data = {"plan_targets": figure([g.model_dump() for g in p.goals], ASSUMPTION),
                    "outcomes": figure([{k: v for k, v in g.items() if k not in {"target_chf", "target_date"}}
                                        for g in simulated], SIMULATED)}
        elif topic == "events":
            data = {"plan_events": figure([event for event in ev["events"] if event["person"] in {p.id, None} and event["month"] >= plan.assumptions.start], ASSUMPTION)}
        else:
            series = ev["series"][p.id]
            income = series["income"][0]
            cash_flow = series["net_flow"][0]
            data = {"first_month": figure(ev["months"][0], ASSUMPTION),
                    "net_cash_flow_chf": figure(cash_flow, SIMULATED), "income_chf": figure(income, SIMULATED),
                    "cash_savings_rate_pct": figure(round(100 * cash_flow / income, 2) if income else None, SIMULATED)}
    return {"person": p.name, "person_id": p.id, "topic": topic, **data}


def compare_paths(plan: Plan, args: CompareArgs) -> dict:
    default_months = plan.assumptions.horizon_months
    default_end = M.add(plan.assumptions.start, default_months - 1)
    extended_end = M.add(plan.assumptions.start, COMPARISON_MONTHS - 1)
    window = f"Checked {M.label(plan.assumptions.start)} through {M.label(extended_end)} ({COMPARISON_MONTHS} months)."
    runs = []
    paths, overtakes = [], []
    for entry in args.paths:
        scenario = apply_changes(plan, entry.changes)
        extended_plan = apply_changes(scenario, [Change(path="assumptions.horizon_months", value=COMPARISON_MONTHS)])
        extended = evaluate(extended_plan)
        ev = evaluate(scenario) if default_months < COMPARISON_MONTHS else extended
        default_worth = ev["household"]["net_worth"][-1]
        extended_worth = extended["household"]["net_worth"][-1]
        runs.append((entry.name, default_worth, extended["household"]["net_worth"]))
        people = [{k: p[k] for k in ("name", "min_cash", "min_cash_month", "end_net_worth", "goals")} for p in ev["people"]]
        low = min(people, key=lambda p: p["min_cash"])
        paths.append({
            "name": entry.name, "assumptions": figure([c.model_dump() for c in entry.changes], ASSUMPTION, basis=entry.assumption_source),
            "provenance": SIMULATED, "verdict": ev["status"], "people": people,
            "end_household_net_worth": default_worth,
            "extended_end_household_net_worth": extended_worth,
            "speakable": (
                f"In the {entry.name} simulation, combined net worth is {chf(default_worth)} at the default horizon end "
                f"in {M.label(default_end)} and {chf(extended_worth)} at the {COMPARISON_MONTHS}-month end "
                f"in {M.label(extended_end)}. {EXTRAPOLATION} Within the default horizon, {low['name']}'s lowest "
                f"cash is {chf(low['min_cash'])} in {M.label(low['min_cash_month'])}."
            ),
        })
    for (name, default_a, first), (other, default_b, second) in permutations(runs, 2):
        gaps = [round(a - b, 2) for a, b in zip(first, second)]
        default_gap = round(default_a - default_b, 2)
        last_below = next((i for i in range(len(gaps) - 1, -1, -1) if gaps[i] < 0), None)
        month = deficit_month = deficit = None
        if last_below is not None:
            worst = gaps.index(min(gaps[:last_below + 1]))
            deficit_month = M.add(plan.assumptions.start, worst)
            deficit = -gaps[worst]
            first_below = next(i for i, gap in enumerate(gaps) if gap < 0)
            start = (f"starts {chf(-gaps[0])} behind" if first_below == 0 else
                     f"falls {chf(-gaps[first_below])} behind in {M.label(M.add(plan.assumptions.start, first_below))}")
            if last_below + 1 < len(gaps):
                month = M.add(plan.assumptions.start, last_below + 1)
                status = "breaks even"
                outcome = f"{start} and breaks even in {M.label(month)}, staying at or above through the extended end"
            else:
                status = "does not catch up"
                catch_up = "does not stay caught up" if any(gap >= 0 for gap in gaps[first_below:]) else "does not catch up"
                outcome = f"{start} and {catch_up} by {M.label(extended_end)}"
        else:
            status = "never behind"
            outcome = ("stays ahead from the start" if all(gap > 0 for gap in gaps)
                       else "stays level throughout" if not any(gaps)
                       else "stays at or above throughout")
        overtakes.append({
            "path": name, "relative_to": other, "break_even_month": month,
            "default_end_gap_chf": default_gap, "extended_end_gap_chf": gaps[-1],
            "max_deficit_month": deficit_month, "max_deficit_chf": deficit,
            "end_monthly_difference_chf": round(gaps[-1] - gaps[-2], 2),
            "status": status,
            "speakable": (
                f"Compared with {other} on simulated combined net worth, {name} {outcome}. "
                f"It is {_gap_label(default_gap)} at the default horizon end in {M.label(default_end)} "
                f"and {_gap_label(gaps[-1])} at the extended end in {M.label(extended_end)}. "
                f"{window} {EXTRAPOLATION}"
            ),
        })
    return {
        "paths": paths, "overtakes": overtakes, "net_position": "combined month-end net worth",
        "default_horizon_months": default_months, "default_end_month": default_end,
        "extended_horizon_months": COMPARISON_MONTHS, "extended_end_month": extended_end,
        "start_month": plan.assumptions.start, "extrapolation": EXTRAPOLATION,
        "end_monthly_difference_basis": "change in the combined net worth gap during the final month",
        "focus_goal": args.focus_goal,
    }


def _gap_label(gap: float) -> str:
    if gap == 0:
        return "level"
    return f"{chf(abs(gap))} {'ahead' if gap > 0 else 'behind'}"
