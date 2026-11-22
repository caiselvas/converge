"""Read-only profile and scenario comparison tools."""
from __future__ import annotations

from itertools import combinations
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
        }
    elif topic == "spending":
        data = {"categories": [{"key": c.key, "label": c.label,
                                "observed_chf_monthly": figure(c.observed_monthly, HISTORICAL),
                                "budget_chf_monthly": figure(c.budget_monthly, ASSUMPTION)} for c in p.categories],
                "observed_total_chf_monthly": figure(round(sum(c.observed_monthly for c in p.categories), 2), HISTORICAL),
                "budget_total_chf_monthly": figure(round(sum(c.budget_monthly for c in p.categories), 2), ASSUMPTION)}
    elif topic == "balances":
        data = {"opening_cash": figure(p.opening_cash, HISTORICAL, as_of=p.opening_cash_date),
                "investments": figure(p.investments, HISTORICAL, as_of=p.investments_as_of)}
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
    runs = [(entry, evaluate(apply_changes(plan, entry.changes))) for entry in args.paths]
    paths, overtakes = [], []
    for entry, ev in runs:
        people = [{k: p[k] for k in ("name", "min_cash", "min_cash_month", "end_net_worth", "goals")} for p in ev["people"]]
        low = min(people, key=lambda p: p["min_cash"])
        paths.append({
            "name": entry.name, "assumptions": figure([c.model_dump() for c in entry.changes], ASSUMPTION, basis=entry.assumption_source),
            "provenance": SIMULATED, "verdict": ev["status"], "people": people,
            "end_household_net_worth": ev["household"]["net_worth"][-1],
            "speakable": f"In the {entry.name} simulation, {low['name']}'s lowest cash is {chf(low['min_cash'])} in {M.label(low['min_cash_month'])}.",
        })
    for a, b in combinations(runs, 2):
        for (entry, first), (other, second) in ((a, b), (b, a)):
            jointly_modelled = dict(zip(second["months"], second["household"]["net_worth"]))
            month = next((m for m, worth in zip(first["months"], first["household"]["net_worth"])
                          if m in jointly_modelled and worth - jointly_modelled[m] >= 0.009), None)
            outcome = (f"In this simulation, {entry.name} first leads {other.name} on total net worth in {M.label(month)}."
                       if month else f"In this simulation, {entry.name} never overtakes {other.name} within the common horizon.")
            overtakes.append({"path": entry.name, "relative_to": other.name, "month": month,
                              "speakable": outcome, "status": "overtakes" if month else "never within horizon"})
    return {"paths": paths, "overtakes": overtakes, "net_position": "combined month-end net worth", "focus_goal": args.focus_goal}
