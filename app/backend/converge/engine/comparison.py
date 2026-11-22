"""Verified option comparisons for a life decision, and temporary stress overlays.

Exploration and repair are separate concerns. The couple's own options and a few
deterministic variants of the decision's levers are always compared, so a plan
that already works still shows meaningful trade-offs. The recommendation engine
adds repairs only when the couple's own plan fails a safety check. Every figure
comes from ``evaluate``; labels such as "safest" are simple, explainable orderings
of those results and are never given to an option that fails a hard constraint.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from math import floor

from converge.engine import months as M
from converge.engine.changes import apply_changes
from converge.engine.evaluate import chf as _chf, evaluate
from converge.engine.recommend import _preference_notes, _preferences, recommend
from converge.models import Change, Plan

MAX_ALTERNATIVES = 3
# Stress overlays only ever touch these paths; a repair must never carry them into a proposal.
STRESS_PATHS = ("shared.property.mortgage_rate", "assumptions.")


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


@dataclass
class Candidate:
    """One option to compare: a full candidate plan and its changes relative to the agreed plan."""

    id: str
    title: str
    kind: str  # "yours" | "option" | "variant" | "fix"
    plan: Plan
    changes: list[Change]
    levers: tuple[str, ...] = ()
    overrides: dict = field(default_factory=dict)
    summary: list[str] = field(default_factory=list)
    event: str | None = None
    respects: list[str] | None = None
    asks: list[str] | None = None


def _column(agreed: Plan, c: Candidate, ev: dict, safe: bool, rules, preferences: dict | None) -> dict:
    target_dates = {(p.id, goal.id): goal.target_date for p in agreed.people for goal in p.goals}
    people = []
    for p in ev["people"]:
        cash = ev["series"][p["id"]]["cash"]
        people.append(dict(
            id=p["id"], name=p["name"], safe=not p["breach"], min_cash=p["min_cash"], min_cash_month=p["min_cash_month"],
            floor=p["floor"], headroom=round(p["min_cash"] - p["floor"], 2), cash=cash,
            breaches=[i for i, x in enumerate(cash) if x < p["floor"] - 0.005],
            goals=[_goal_slip(g, target_dates.get((p["id"], g["id"]), g["target_date"])) for g in p["goals"]
                   if (g["in_horizon"] and not g["met"]) or g["target_date"] > target_dates.get((p["id"], g["id"]), g["target_date"])],
        ))
    if c.respects is None:
        respects, asks = _preference_notes(c.levers, rules)
    else:
        respects, asks = list(c.respects), list(c.asks or [])
    safety_names = [p["name"] for p in ev["people"] if (preferences or {}).get("priority", {}).get(p["id"]) == "safety"]
    for name in safety_names:
        (respects if safe else asks).append(f"Protects {name}’s safety buffer." if safe
                                            else f"Asks {name} to accept a failed safety check.")
    home = ev["property"]
    net_worth = ev["household"]["net_worth"]
    return dict(
        id=c.id, title=c.title, kind=c.kind, summary=c.summary, overrides=c.overrides,
        changes=[ch.model_dump() for ch in c.changes], raw_changes=[ch.model_dump() for ch in c.changes],
        primary_lever=c.levers[0] if c.levers else None,
        safe=safe, issue=next((i["title"] for i in ev["issues"] if i["severity"] == "hard"), None),
        soft_issues=[i["title"] for i in ev["issues"] if i["severity"] == "soft"][:3],
        people=people, net_worth=net_worth, end_net_worth=net_worth[-1],
        event=c.event,
        home=dict(month=home["purchase"], delay_months=max(0, M.index(home["purchase"], min(home["target_date"], c.plan.shared.property.purchase))),
                  in_horizon=home["in_horizon"]) if home else None,
        respects=list(dict.fromkeys(respects)), asks=list(dict.fromkeys(asks)),
        labels=[], deltas=None, tradeoff=None, robustness=None,
    )


def _signed(x: float) -> str:
    return ("+" if x >= 0 else "−") + _chf(abs(x))


def _signature(col: dict) -> tuple:
    return (tuple(round(p["min_cash"], -2) for p in col["people"]), round(col["end_net_worth"], -2), col["event"],
            col["safe"])


def _min_headroom(col: dict) -> float:
    return min(p["headroom"] for p in col["people"])


def _unique_best(cols: list[dict], key: Callable[[dict], float], margin: float) -> dict | None:
    ranked = sorted(cols, key=key, reverse=True)
    if len(ranked) < 2 or key(ranked[0]) - key(ranked[1]) < margin:
        return None
    return ranked[0]


def _label(cols: list[dict], event_label: str, preference_label: bool, end_month: str) -> None:
    safe = [c for c in cols if c["safe"]]
    if len(safe) < 2:
        return
    best = _unique_best(safe, _min_headroom, 100)
    if best:
        best["labels"].append(dict(id="safest", text="Safest for both",
                                   detail=f"Keeps at least {_chf(_min_headroom(best))} above each buffer"))
    dated = [c for c in safe if c["event"]]
    if event_label and len({c["event"] for c in dated}) > 1:
        first = min(dated, key=lambda c: c["event"])
        if sum(1 for c in dated if c["event"] == first["event"]) == 1:
            first["labels"].append(dict(id="soonest", text=f"Earliest {event_label.lower()}",
                                        detail=M.label(first["event"])))
    best = _unique_best(safe, lambda c: c["end_net_worth"], 100)
    if best:
        best["labels"].append(dict(id="wealth", text="Most wealth in 10 years",
                                   detail=f"{_chf(best['end_net_worth'])} household net worth in {M.label(end_month)}"))
    if preference_label:
        best = _unique_best(safe, lambda c: len(c["respects"]) - len(c["asks"]), 1)
        if best and len(best["respects"]) > len(best["asks"]):
            best["labels"].append(dict(id="preferences", text="Best match for what you both said",
                                       detail=best["respects"][0] if best["respects"] else ""))


def _deltas(ref: dict, col: dict, event_label: str, end_month: str) -> None:
    people = {p["id"]: p for p in ref["people"]}
    d = dict(
        end_net_worth=round(col["end_net_worth"] - ref["end_net_worth"], 2),
        min_cash={p["id"]: round(p["min_cash"] - people[p["id"]]["min_cash"], 2) for p in col["people"]},
        event_months=M.index(col["event"], ref["event"]) if col["event"] and ref["event"] else None,
    )
    col["deltas"] = d
    parts = []
    if d["event_months"]:
        n = abs(d["event_months"])
        parts.append(f"{event_label} {n} month{'s' if n != 1 else ''} {'later' if d['event_months'] > 0 else 'earlier'}")
    if abs(d["end_net_worth"]) >= 500:
        parts.append(f"{_signed(d['end_net_worth'])} household net worth by {M.label(end_month)}")
    for p in col["people"]:
        delta = d["min_cash"][p["id"]]
        if abs(delta) >= 500:
            parts.append(f"{p['name']}’s lowest cash {_signed(delta)}")
    col["tradeoff"] = " · ".join(parts) or "About the same as your plan"


def compare(agreed: Plan, candidates: list[Candidate], variants: list[Candidate], *,
            preferences: dict | None = None, stress: dict | None = None, event_label: str = "",
            preference_label: bool = False, event_of: Callable[[Plan], str | None] = lambda plan: None) -> dict:
    """Compare the couple's options with up to three engine alternatives.

    ``candidates`` are the couple's own options; the first is their plan and the
    reference for every delta. ``variants`` are deterministic explorations of the
    decision's levers. Alternatives are added only when they are safe and
    meaningfully different; repairs from the recommendation engine are added
    first when the couple's plan fails a safety check.
    """
    stress = stress or {}
    rules = _preferences(agreed, preferences)
    evaluated = 0

    def run(c: Candidate) -> dict:
        nonlocal evaluated
        ev = evaluate(with_stress(c.plan, stress))
        evaluated += 1
        return _column(agreed, c, ev, _safe(ev), rules, preferences)

    def unstressed_safe(plan: Plan, col: dict) -> bool:
        nonlocal evaluated
        if not stress:
            return col["safe"]
        evaluated += 1
        return _safe(evaluate(plan, include_series=False))

    # Which alternatives to show is decided without the stress overlay, so turning a
    # stress test on shows which options survive instead of swapping them out.
    cols = [run(c) for c in candidates]
    yours = cols[0]
    seen = {_signature(c) for c in cols}
    pool: list[Candidate] = []
    notice = None
    base_safe = {c.id: unstressed_safe(c.plan, col) for c, col in zip(candidates, cols)}
    if not base_safe[candidates[0].id]:
        base = candidates[0]
        recs = recommend(base.plan, preferences=preferences, comparison=True)
        evaluated += recs.get("evaluated", 0)
        for rec in recs["recommendations"]:
            extra = [Change.model_validate(ch) for ch in rec["raw_changes"]
                     if not ch["path"].startswith(STRESS_PATHS) and not ch["path"].endswith(".income_monthly")]
            if not extra:
                continue
            plan = apply_changes(base.plan, extra)
            latest = {ch.path: ch for ch in [*base.changes, *extra]}
            pool.append(Candidate(id=rec["id"], title=rec["title"], kind="fix", plan=plan, changes=list(latest.values()),
                                  levers=(rec.get("primary_lever"),) if rec.get("primary_lever") else (),
                                  summary=[], event=event_of(plan), respects=rec["respects"], asks=rec["asks"]))
    pool.extend(variants)
    alternatives = []
    for c in pool:
        if len(alternatives) == MAX_ALTERNATIVES:
            break
        col = run(c)
        ok = unstressed_safe(c.plan, col)
        if not ok or _signature(col) in seen:
            continue
        seen.add(_signature(col))
        base_safe[c.id] = ok
        alternatives.append(col)
    cols.extend(alternatives)

    end_month = M.add(agreed.assumptions.start, agreed.assumptions.horizon_months - 1)
    if not any(c["safe"] for c in cols):
        notice = ("No option we tested passes every safety check. Try a smaller change in the inputs, "
                  "or reset the stress test if one is active.")
    elif not alternatives:
        notice = ("Converge tested variations of this decision and found none that is both safe and meaningfully "
                  "different from yours. Add your own option to compare.")
    for col in cols[1:]:
        _deltas(yours, col, event_label or "Decision", end_month)
    _label(cols, event_label, preference_label, end_month)
    plans = {c.id: c.plan for c in [*candidates, *pool]}
    for col in cols:
        col["robustness"] = _robustness(plans[col["id"]], base_safe[col["id"]])
    months = [M.add(agreed.assumptions.start, t) for t in range(agreed.assumptions.horizon_months)]
    return dict(
        months=months, columns=cols, notice=notice, end_month=end_month, event_label=event_label,
        mortgage_rate=candidates[0].plan.shared.property.mortgage_rate if candidates[0].plan.shared.property.enabled else None,
        evaluated=evaluated,
    )
