"""Constraint checks, goal tracking and explanation facts for a simulation."""
from __future__ import annotations

from converge.engine import months as M
from converge.engine.simulate import SimResult, simulate
from converge.models import Plan


def chf(x: float) -> str:
    return f"CHF {x:,.0f}".replace(",", "’")


PRIORITY_RANK = {"high": 0, "medium": 1, "low": 2}


def goal_order(goals) -> list:
    """Goals are funded in priority order (then by date) so money is never counted twice."""
    return sorted(goals, key=lambda g: (PRIORITY_RANK.get(g.priority, 3), g.target_date))


def _goal_status(res: SimResult, pi: int, goal, reserved_before: float) -> dict:
    """``reserved_before`` = targets of higher-ranked goals, which are funded first."""
    s = res.people[pi]
    H = len(res.months)
    start = res.months[0]
    idx = M.index(goal.target_date, start)

    def value(t: int) -> float:
        base = s.cash[t] if goal.measure == "cash" else s.liquid(t)
        return base - reserved_before

    reached = next((t for t in range(H) if value(t) >= goal.target_chf), None)
    if idx < 0:
        idx = 0
    in_horizon = idx < H
    at = value(min(idx, H - 1))
    met = in_horizon and at >= goal.target_chf
    return dict(
        id=goal.id,
        name=goal.name,
        priority=goal.priority,
        measure=goal.measure,
        source=goal.source,
        target_chf=goal.target_chf,
        target_date=goal.target_date,
        reserved_before_chf=round(reserved_before, 2),
        projected_chf=round(max(0.0, at), 2),
        shortfall_chf=round(max(0.0, goal.target_chf - at), 2),
        progress=round(max(0.0, min(1.0, at / goal.target_chf)), 4) if goal.target_chf > 0 else 1.0,
        met=met,
        in_horizon=in_horizon,
        reached_month=res.months[reached] if reached is not None else None,
    )


def _drivers(res: SimResult, pi: int, upto: int) -> list[dict]:
    """Largest identifiable causes of cash decline up to month ``upto`` (inclusive)."""
    s = res.people[pi]
    out: dict[str, float] = {}
    for (t, lbl, amt) in s.one_off_items:
        if t <= upto:
            out[lbl] = out.get(lbl, 0.0) + amt
    retained = 1 - res.plan.assumptions.tax_rate
    out["Income lost during career break"] = sum(s.career_break_loss[:upto + 1]) * retained
    out["Parental leave income"] = sum(s.parental_leave_loss[:upto + 1]) * retained
    out["Everyday child costs"] = sum(s.everyday_child_costs[:upto + 1])
    out["Childcare"] = sum(s.childcare[:upto + 1])
    housing = sum(s.housing[t] for t in range(upto + 1))
    if housing > 1:
        out["Mortgage interest & maintenance"] = housing
    amort = sum(s.amortization[t] for t in range(upto + 1))
    if amort > 1:
        out["Mortgage amortisation"] = amort
    items = [dict(label=k, amount_chf=round(v, 2)) for k, v in out.items() if v > 1]
    items.sort(key=lambda d: -d["amount_chf"])
    return items


def evaluate(plan: Plan, res: SimResult | None = None) -> dict:
    res = res or simulate(plan)
    H = len(res.months)
    issues: list[dict] = []
    people_out = []
    for pi, (p, s) in enumerate(zip(plan.people, res.people)):
        min_t = min(range(H), key=lambda t: s.cash[t])
        min_cash = s.cash[min_t]
        breach = [t for t in range(H) if s.cash[t] < p.emergency_floor - 0.005]
        runway = [s.cash[t] / s.outgoings[t] if s.outgoings[t] > 0 else float("inf") for t in range(H)]
        rw_t = min(range(H), key=lambda t: runway[t])
        avg_net = sum(s.net_flow) / H
        goals = []
        reserved = 0.0
        for g in goal_order(p.goals):
            goals.append(_goal_status(res, pi, g, reserved))
            reserved += g.target_chf
        if breach:
            first = breach[0]
            shortfall = p.emergency_floor - min_cash
            drivers = _drivers(res, pi, min_t)
            issues.append(
                dict(
                    id=f"floor:{p.id}",
                    severity="hard",
                    kind="liquidity_floor",
                    person=p.id,
                    month=res.months[first],
                    worst_month=res.months[min_t],
                    amount_chf=round(shortfall, 2),
                    months_below=len(breach),
                    title=f"{p.name}'s safety buffer is breached",
                    detail=(
                        f"{p.name}'s cash falls to {chf(min_cash)} in {M.label(res.months[min_t])}, "
                        f"{chf(shortfall)} below the minimum of {chf(p.emergency_floor)} "
                        f"({len(breach)} month{'s' if len(breach) != 1 else ''} below, from {M.label(res.months[first])})."
                        + (" Cash turns negative — this would require borrowing." if min_cash < 0 else "")
                    ),
                    drivers=drivers,
                    needs_financing=min_cash < 0,
                )
            )
        for g in goals:
            if not g["in_horizon"] or g["met"]:
                continue
            when = f" It is reached in {M.label(g['reached_month'])}." if g["reached_month"] else " It is not reached within the plan horizon."
            issues.append(
                dict(
                    id=f"goal:{p.id}:{g['id']}",
                    severity="soft",
                    kind="goal",
                    person=p.id,
                    month=g["target_date"],
                    amount_chf=g["shortfall_chf"],
                    title=f"{p.name}: {g['name']} missed",
                    detail=(
                        f"{g['name']} needs {chf(g['target_chf'])} by {M.label(g['target_date'])}; "
                        f"projected {chf(g['projected_chf'])} ({chf(g['shortfall_chf'])} short)"
                        + (f" after first funding higher-priority goals ({chf(g['reserved_before_chf'])})" if g["reserved_before_chf"] else "")
                        + f".{when}"
                    ),
                    drivers=_drivers(res, pi, min(M.index(g["target_date"], res.months[0]), H - 1)),
                    priority=g["priority"],
                )
            )
        people_out.append(
            dict(
                id=p.id,
                name=p.name,
                floor=p.emergency_floor,
                start_cash=round(p.opening_cash, 2),
                end_cash=round(s.cash[-1], 2),
                end_net_worth=round(s.net_worth[-1], 2),
                start_net_worth=round(p.opening_cash + p.investments - sum(l.principal_chf for l in p.liabilities), 2),
                min_cash=round(min_cash, 2),
                min_cash_month=res.months[min_t],
                headroom=round(min_cash - p.emergency_floor, 2),
                lowest_runway_months=round(runway[rw_t], 1) if runway[rw_t] != float("inf") else None,
                lowest_runway_month=res.months[rw_t],
                avg_monthly_saving=round(avg_net, 2),
                breach=bool(breach),
                goals=goals,
            )
        )

    pr = plan.shared.property
    property_out = None
    if pr.enabled:
        aff = res.affordability
        if res.purchase_index is None:
            issues.append(
                dict(
                    id="property:horizon",
                    severity="soft",
                    kind="home_goal",
                    person=None,
                    month=pr.purchase,
                    amount_chf=0,
                    title="Home purchase is outside the plan horizon",
                    detail=f"The purchase in {M.label(pr.purchase)} falls after the end of the {H}-month horizon.",
                    drivers=[],
                )
            )
        if aff and not aff["passes"]:
            issues.append(
                dict(
                    id="property:affordability",
                    severity="hard",
                    kind="affordability",
                    person=None,
                    month=aff["month"],
                    amount_chf=round(aff["annual_cost"] - aff["max_ratio"] * aff["annual_net_income"], 2),
                    title="Home fails the indicative affordability test",
                    detail=(
                        (f"Imputed costs of {chf(aff['annual_cost'])}/year are {aff['ratio'] * 100:.1f}% of combined usual "
                         f"net income, above Converge's {aff['max_ratio'] * 100:.0f}% limit. "
                         f"Highest price passing this test: about {chf(aff['max_price'])}.")
                        if aff["ratio"] is not None else
                        f"With no regular income, imputed costs of {chf(aff['annual_cost'])}/year cannot be carried."
                    ),
                    drivers=[
                        dict(label="Imputed interest (5%)", amount_chf=aff["imputed_interest"]),
                        dict(label="Maintenance (1%)", amount_chf=aff["maintenance"]),
                        dict(label="Required amortisation", amount_chf=aff["amortization"]),
                    ],
                )
            )
        if M.index(pr.purchase, pr.target_date) > 0:
            late = M.index(pr.purchase, pr.target_date)
            issues.append(
                dict(
                    id="property:target",
                    severity="soft",
                    kind="home_goal",
                    person=None,
                    month=pr.target_date,
                    amount_chf=0,
                    months_late=late,
                    title="Home bought later than hoped",
                    detail=f"Purchase in {M.label(pr.purchase)} is {late} months after the shared target of {M.label(pr.target_date)}.",
                    drivers=[],
                )
            )
        deposit = pr.deposit_pct * pr.price
        fees = pr.fees_pct * pr.price
        mortgage0 = pr.price - deposit
        second = max(0.0, mortgage0 - plan.assumptions.second_mortgage_ltv * pr.price)
        amort_m = second / (plan.assumptions.amortization_years * 12) if pr.amortize else 0.0
        property_out = dict(
            purchase=pr.purchase,
            in_horizon=res.purchase_index is not None,
            price=pr.price,
            deposit=round(deposit, 2),
            fees=round(fees, 2),
            mortgage=round(mortgage0, 2),
            monthly_interest=round(mortgage0 * pr.mortgage_rate / 12, 2),
            monthly_maintenance=round(pr.price * pr.maintenance_pct / 12, 2),
            monthly_amortization=round(amort_m, 2),
            ownership=[pr.ownership_share_first, 1 - pr.ownership_share_first],
            contributions=[round((deposit + fees) * pr.ownership_share_first, 2),
                           round((deposit + fees) * (1 - pr.ownership_share_first), 2)],
            affordability=aff,
            end_mortgage=round(res.mortgage[-1], 2),
            target_date=pr.target_date,
        )

    hard = [i for i in issues if i["severity"] == "hard"]
    soft = [i for i in issues if i["severity"] == "soft"]
    status = "conflict" if hard else ("attention" if soft else "on_track")

    events = []
    if res.move_in_index is not None and plan.shared.household.enabled and res.move_in_index != res.purchase_index:
        events.append(dict(month=res.months[res.move_in_index], kind="move_in", label="Move in together", person=None))
    if res.purchase_index is not None:
        events.append(dict(month=res.months[res.purchase_index], kind="purchase", label="Buy home", person=None))
    for p in plan.people:
        for b in p.career_breaks:
            events.append(dict(month=b.start, kind="career_break", label=f"{p.name}: {b.label} ({b.months} mo)",
                               person=p.id, end=M.add(b.start, b.months)))
    children = []
    for child in plan.shared.children:
        if child.birth in res.months:
            events.append(dict(month=child.birth, kind="child_birth", label="Child born", person=None))
        children.append(dict(
            id=child.id,
            label=child.label,
            birth=child.birth,
            costs=[dict(everyday=round(cost.everyday, 2), childcare=round(cost.childcare, 2),
                        allowance=round(cost.allowance, 2), net_cost=round(cost.everyday + cost.childcare - cost.allowance, 2))
                   for cost in res.child_costs[child.id]],
        ))
    events.sort(key=lambda e: e["month"])

    shares = res.people[0].household_share
    return dict(
        status=status,
        months=res.months,
        people=people_out,
        issues=hard + soft,
        property=property_out,
        children=children,
        events=events,
        household=dict(
            cash=[round(res.people[0].cash[t] + res.people[1].cash[t], 2) for t in range(H)],
            net_worth=[round(res.people[0].net_worth[t] + res.people[1].net_worth[t], 2) for t in range(H)],
            property_value=[round(x, 2) for x in res.property_value],
            mortgage=[round(x, 2) for x in res.mortgage],
            joint_transfers=[round(x, 2) for x in res.joint_in],
            share_first=[round(x, 4) for x in shares],
        ),
        series={
            p.id: {
                k: [round(x, 2) for x in getattr(s, k)]
                for k in ("cash", "investments", "net_worth", "income", "family_allowance", "tax", "spending", "household",
                          "housing", "amortization", "one_off", "deposit", "net_flow", "property_value", "mortgage")
            }
            for p, s in zip(plan.people, res.people)
        },
        checks=res.checks,
    )


def score(ev: dict) -> tuple:
    """Compact comparable summary used by the recommendation search."""
    hard = [i for i in ev["issues"] if i["severity"] == "hard"]
    soft = [i for i in ev["issues"] if i["severity"] == "soft"]
    return len(hard), sum(i["amount_chf"] for i in hard), len(soft), sum(i["amount_chf"] for i in soft)
