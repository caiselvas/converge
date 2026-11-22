"""Verified planner comparisons and temporary stress overlays."""
from collections.abc import Callable
from math import floor

from converge.engine import months as M
from converge.engine.changes import apply_changes
from converge.engine.evaluate import evaluate
from converge.engine.recommend import _preference_notes, _preferences, recommend
from converge.models import Change, Plan


def with_stress(plan: Plan, stress: dict) -> Plan:
    paths = {
        "mortgage_rate": "shared.property.mortgage_rate",
        "expense_inflation": "assumptions.expense_inflation",
        "investment_return": "assumptions.investment_return",
    }
    changes = [Change(path=paths[key], value=value) for key, value in stress.items() if key in paths]
    if stress.get("income_drop"):
        changes.extend(Change(path=f"people.{p.id}.income_monthly", value=p.income_monthly * (1 - stress["income_drop"]))
                       for p in plan.people)
    return apply_changes(plan, changes) if changes else plan


def _safe(ev: dict) -> bool:
    return ev["checks"]["ok"] and ev["status"] != "conflict"


def _limit(test: Callable[[float], bool], low: float, cap: float) -> dict:
    if not test(low):
        return dict(kind="unsafe", value=low)
    if test(cap):
        return dict(kind="cap", value=cap)
    high = cap
    while high - low > 0.0001:
        mid = (low + high) / 2
        if test(mid):
            low = mid
        else:
            high = mid
    return dict(kind="threshold", value=floor(low * 1000) / 1000)


def _robustness(plan: Plan, safe: bool) -> dict:
    rate = plan.shared.property.mortgage_rate

    def passes(key: str, value: float) -> bool:
        return _safe(evaluate(with_stress(plan, {key: value}), include_series=False))

    return dict(
        mortgage=(None if not plan.shared.property.enabled else
                  _limit(lambda v: passes("mortgage_rate", v), rate, max(rate, 0.10)) if safe
                  else dict(kind="unsafe", value=rate)),
        income=(_limit(lambda v: passes("income_drop", v), 0.0, 0.50) if safe else dict(kind="unsafe", value=0.0)),
    )


def _goal_slip(goal: dict, original_date: str) -> dict:
    month = goal["target_date"] if goal["met"] else goal["reached_month"]
    if month and month <= original_date:
        month = None  # This goal may have briefly been funded before its missed deadline.
    return dict(name=goal["name"], reached_month=month,
                slip_months=M.index(month, original_date) if month else None)


def compare(plan: Plan, preferences: dict | None = None, stress: dict | None = None) -> dict:
    recommendations = recommend(plan, preferences=preferences, comparison=True)
    respects, asks = _preference_notes((), _preferences(plan, preferences))
    options = [dict(id="your-plan", title="Your plan", raw_changes=[], respects=respects, asks=asks, primary_lever=None)]
    options += recommendations["recommendations"]
    columns = []
    for option in options:
        changes = [Change.model_validate(ch) for ch in option["raw_changes"]]
        candidate = apply_changes(plan, changes) if changes else plan
        ev = evaluate(with_stress(candidate, stress or {}))
        safe = _safe(ev)
        base_safe = safe if not stress else _safe(evaluate(candidate, include_series=False))
        target_dates = {(p.id, goal.id): goal.target_date for p in plan.people for goal in p.goals}
        safety_names = [p["name"] for p in ev["people"]
                        if (preferences or {}).get("priority", {}).get(p["id"]) == "safety"]
        safety_notes = [f"Protects {name}’s safety buffer." if safe else f"Asks {name} to accept a failed safety check."
                        for name in safety_names]
        people = [
            dict(id=p["id"], name=p["name"], safe=not p["breach"], min_cash=p["min_cash"],
                 min_cash_month=p["min_cash_month"], floor=p["floor"], cash=ev["series"][p["id"]]["cash"],
                 breaches=[i for i, cash in enumerate(ev["series"][p["id"]]["cash"]) if cash < p["floor"] - 0.005],
                 goals=[_goal_slip(g, target_dates[p["id"], g["id"]]) for g in p["goals"]
                        if (g["in_horizon"] and not g["met"]) or g["target_date"] > target_dates[p["id"], g["id"]]])
            for p in ev["people"]
        ]
        home = ev["property"]
        columns.append(dict(
            **{key: option[key] for key in ("id", "title", "primary_lever", "raw_changes")},
            respects=option["respects"] + (safety_notes if safe else []),
            asks=option["asks"] + ([] if safe else safety_notes),
            safe=safe, people=people, net_worth=ev["household"]["net_worth"],
            home=dict(month=home["purchase"], delay_months=max(0, M.index(home["purchase"], min(home["target_date"], plan.shared.property.purchase))),
                      in_horizon=home["in_horizon"]) if home else None,
            robustness=_robustness(candidate, base_safe),
            issue=next((i["title"] for i in ev["issues"] if i["severity"] == "hard"), None),
        ))
    return dict(months=ev["months"], columns=columns, mortgage_rate=plan.shared.property.mortgage_rate if plan.shared.property.enabled else None,
                evaluated=recommendations["evaluated"])
