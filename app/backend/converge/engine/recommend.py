"""Deterministic recommendation search.

Bounded search over a fixed set of supported decision levers. Every candidate
is applied to a copy of the plan and fully re-simulated; only candidates that
the simulator verifies as free of hard-constraint violations are presented as
feasible. Candidates are ranked under several transparent strategies and the
best *meaningfully different* options are returned.

No language model is involved in generating or checking any number here.
"""
from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from itertools import combinations

from converge.data.profiles import FLEXIBLE_KEYS
from converge.engine import months as M
from converge.engine.changes import apply_changes, describe, format_value, required_approvers
from converge.engine.evaluate import chf, evaluate
from converge.engine.simulate import simulate
from converge.models import Change, Plan

# Disruption points per unit of each kind of adjustment (documented in docs/model.md).
UNIT_COST = {
    "lifestyle": 1 / 100,  # 1 point per CHF 100/month of reduced spending
    "delay": 1.0,  # 1 point per month the home purchase moves
    "budget": 2 / 50_000,  # 2 points per CHF 50k lower property budget
    "ownership": 1 / 0.05,  # 1 point per 5 pp shift of deposit/ownership
    "split": 0.8 / 0.05,  # 0.8 points per 5 pp shift of household contributions
    "support": 2.0,  # flat: partner covers more during a career break
    "break_shorter": 2.0,  # per month removed from a career break
    "break_partial": 1 / 20,  # 1 point per 20% of income earned during the break
    "break_later": 1 / 3,  # 1 point per 3 months a break is postponed
    "deposit": 1 / 0.01 * 0.5,  # 0.5 points per pp of deposit change
    "goal": 2 / 6,  # 2 points per 6 months a goal is postponed (explicit concession)
}

STRATEGIES = {
    "lifestyle": dict(
        title="Keep your lifestyle",
        blurb="Changes structure and timing rather than everyday spending or personal plans.",
        weights={"lifestyle": 4.0, "break_shorter": 3.0, "break_partial": 3.0, "break_later": 2.0},
    ),
    "speed": dict(
        title="Stay on schedule",
        blurb="Keeps the shared home and personal plans as close to the original dates as possible.",
        weights={"delay": 5.0, "break_later": 3.0, "goal": 3.0},
    ),
    "resilience": dict(
        title="Strongest safety net",
        blurb="Leaves both partners with the largest cash cushion above their minimum.",
        weights={},
    ),
}


@dataclass
class Candidate:
    kinds: tuple[str, ...]
    changes: list[Change]
    cost: dict[str, float]
    title_parts: list[str]
    ev: dict | None = None
    sim_ok: bool = False
    extras: dict = field(default_factory=dict)

    def disruption(self, weights: dict[str, float] | None = None) -> float:
        w = weights or {}
        return sum(UNIT_COST[k] * v * w.get(k, 1.0) for k, v in self.cost.items())


def _round_to(x: float, step: float) -> float:
    return round(x / step) * step


def _generate(plan: Plan, ev: dict) -> dict[str, list[Candidate]]:
    """Single-lever candidates grouped by lever family, ordered by magnitude."""
    gens: dict[str, list[Candidate]] = {}
    a = plan.assumptions
    end = M.add(a.start, a.horizon_months - 1)
    people = plan.people
    names = {p.id: p.name for p in people}
    hard = [i for i in ev["issues"] if i["severity"] == "hard"]
    soft = [i for i in ev["issues"] if i["severity"] == "soft"]
    stressed = {i["person"] for i in hard if i.get("person")} | {i["person"] for i in soft if i.get("person")}
    pr = plan.shared.property

    def add(fam: str, c: Candidate) -> None:
        gens.setdefault(fam, []).append(c)

    if pr.enabled:
        # Delay the purchase.
        for d in range(1, 25):
            new = M.add(pr.purchase, d)
            if M.index(new, end) > 0:
                break
            add("delay", Candidate(("delay",), [Change(path="shared.property.purchase", value=new)], {"delay": d},
                                   [f"Buy in {M.label(new)}"]))
        # Lower budget.
        for pct in (0.05, 0.10, 0.15, 0.20, 0.25):
            price = _round_to(pr.price * (1 - pct), 10_000)
            add("budget", Candidate(("budget",), [Change(path="shared.property.price", value=price)],
                                    {"budget": pr.price - price}, [f"Look for a home around {chf(price)}"]))
        # Shift deposit/ownership towards the partner with more headroom.
        first_stressed = people[0].id in stressed
        second_stressed = people[1].id in stressed
        if first_stressed != second_stressed:
            direction = -1 if first_stressed else 1
            for k in range(1, 7):
                s = round(pr.ownership_share_first + direction * 0.05 * k, 2)
                if not 0.2 <= s <= 0.8:
                    break
                payer = people[0] if direction > 0 else people[1]
                share = s if direction > 0 else 1 - s
                add("ownership", Candidate(
                    ("ownership",), [Change(path="shared.property.ownership_share_first", value=s)],
                    {"ownership": abs(s - pr.ownership_share_first)},
                    [f"{payer.name} funds {share * 100:.0f}% of the deposit (and owns {share * 100:.0f}%)"]))
        # Deposit level (affects both cash need and mortgage affordability).
        aff_fail = any(i["kind"] == "affordability" for i in hard)
        if aff_fail:
            for k in range(1, 16):
                d = round(pr.deposit_pct + 0.01 * k, 2)
                if d > 0.5:
                    break
                add("deposit", Candidate(("deposit",), [Change(path="shared.property.deposit_pct", value=d)],
                                         {"deposit": d - pr.deposit_pct}, [f"Raise the deposit to {d * 100:.0f}%"]))
        else:
            for k in range(1, 11):
                d = round(pr.deposit_pct - 0.01 * k, 2)
                if d < 0.20:
                    break
                add("deposit", Candidate(("deposit",), [Change(path="shared.property.deposit_pct", value=d)],
                                         {"deposit": pr.deposit_pct - d}, [f"Lower the deposit to {d * 100:.0f}%"]))

    # Household cost split.
    has_break = any(p.career_breaks for p in people)
    if plan.shared.household.enabled or pr.enabled:
        sp = plan.shared.split
        if has_break and not sp.adjust_for_breaks:
            breaker = next(p for p in people if p.career_breaks)
            other = next(p for p in people if p.id != breaker.id)
            add("support", Candidate(("support",), [Change(path="shared.split.adjust_for_breaks", value=True)],
                                     {"support": 1}, [f"{other.name} covers household costs during {breaker.name}'s break"]))
        if len(stressed & {people[0].id, people[1].id}) == 1:
            from converge.engine.simulate import household_share_first

            cur = household_share_first(plan, people[0].income_monthly, people[1].income_monthly)
            direction = -1 if people[0].id in stressed else 1
            for k in range(1, 5):
                s = round(_round_to(cur, 0.05) + direction * 0.05 * k, 2)
                if not 0.2 <= s <= 0.8:
                    break
                payer = people[0] if direction > 0 else people[1]
                add("split", Candidate(
                    ("split",),
                    [Change(path="shared.split.mode", value="custom"), Change(path="shared.split.custom_share_first", value=s)],
                    {"split": abs(s - cur)},
                    [f"{payer.name} pays {(s if direction > 0 else 1 - s) * 100:.0f}% of household costs"]))

    # Personal levers for the partner(s) under pressure.
    for p in people:
        if p.id not in stressed:
            continue
        flex = [c for c in p.categories if c.key in FLEXIBLE_KEYS and c.budget_monthly > 0]
        if flex:
            for pct in (0.10, 0.20, 0.30, 0.40):
                chs, saved = [], 0.0
                for c in flex:
                    nb = round(c.budget_monthly * (1 - pct))
                    saved += c.budget_monthly - nb
                    chs.append(Change(path=f"people.{p.id}.categories.{c.key}.budget_monthly", value=nb))
                add(f"lifestyle:{p.id}", Candidate(("lifestyle",), chs, {"lifestyle": saved},
                                                   [f"{p.name} trims flexible spending by {pct * 100:.0f}% ({chf(saved)}/month)"]))
        for b in p.career_breaks:
            base = f"people.{p.id}.career_breaks.{b.id}"
            for m in range(b.months - 1, 0, -1):
                add(f"break_shorter:{p.id}", Candidate(("break_shorter",), [Change(path=f"{base}.months", value=m)],
                                                       {"break_shorter": b.months - m},
                                                       [f"{p.name}'s break lasts {m} months instead of {b.months}"]))
            for pct in (20, 40, 50, 60):
                if pct <= b.income_pct:
                    continue
                add(f"break_partial:{p.id}", Candidate(("break_partial",), [Change(path=f"{base}.income_pct", value=pct)],
                                                       {"break_partial": pct - b.income_pct},
                                                       [f"{p.name} keeps {pct}% of income during the break (part-time)"]))
            for d in (3, 6, 9, 12, 15, 18):
                ns = M.add(b.start, d)
                if M.index(M.add(ns, b.months - 1), end) > 0:
                    break
                add(f"break_later:{p.id}", Candidate(("break_later",), [Change(path=f"{base}.start", value=ns)],
                                                     {"break_later": d},
                                                     [f"{p.name} starts the break in {M.label(ns)}"]))
        # Soft-goal concessions (only for goals currently missed).
        for i in soft:
            if i["kind"] != "goal" or i["person"] != p.id:
                continue
            gid = i["id"].split(":", 2)[2]
            goal = next(g for g in p.goals if g.id == gid)
            for d in (6, 12, 18, 24):
                nd = M.add(goal.target_date, d)
                if M.index(nd, end) > 0:
                    break
                add(f"goal:{gid}", Candidate(("goal",), [Change(path=f"people.{p.id}.goals.{gid}.target_date", value=nd)],
                                             {"goal": d}, [f"Revisit {p.name}'s {goal.name.lower()} target: {M.label(nd)}"]))
    return gens


def _run(plan: Plan, c: Candidate, base_soft: set[str]) -> Candidate:
    try:
        cand_plan = apply_changes(plan, c.changes)
    except ValueError:
        c.ev = None
        return c
    res = simulate(cand_plan)
    c.ev = evaluate(cand_plan, res)
    c.sim_ok = bool(res.checks["ok"])
    c.extras["plan"] = cand_plan
    soft_ids = {i["id"] for i in c.ev["issues"] if i["severity"] == "soft"}
    c.extras["new_soft"] = soft_ids - base_soft
    return c


def _feasible(c: Candidate) -> bool:
    return c.ev is not None and c.sim_ok and not any(i["severity"] == "hard" for i in c.ev["issues"])


def _hard_total(c: Candidate) -> float:
    if c.ev is None:
        return math.inf
    return sum(i["amount_chf"] for i in c.ev["issues"] if i["severity"] == "hard")


def _min_headroom_ratio(ev: dict) -> float:
    return min(p["headroom"] / max(p["floor"], 1.0) for p in ev["people"])


def _total_cost(c: Candidate, weights: dict | None = None) -> float:
    # +3 per newly created soft issue, +1 per extra lever (simpler plans are easier to agree on).
    return c.disruption(weights) + 3.0 * len(c.extras.get("new_soft", ())) + 1.0 * (len(c.kinds) - 1)


def search(plan: Plan, max_pairs_per_family: int = 5) -> tuple[list[Candidate], dict]:
    ev0 = evaluate(plan)
    base_soft = {i["id"] for i in ev0["issues"] if i["severity"] == "soft"}
    gens = _generate(plan, ev0)
    singles: list[Candidate] = []
    for fam, cands in gens.items():
        for c in cands:
            singles.append(_run(plan, c, base_soft))

    # Pairs: combine the gentlest levels of two different families. For each
    # family keep the smallest levels plus the smallest level that already
    # resolves the hard issues on its own (if any), to bound the search.
    def family_levels(fam: str) -> list[Candidate]:
        return gens[fam][:max_pairs_per_family]

    pairs: list[Candidate] = []
    fams = list(gens)
    for f1, f2 in combinations(fams, 2):
        for c1 in family_levels(f1):
            for c2 in family_levels(f2):
                paths = {ch.path for ch in c1.changes} & {ch.path for ch in c2.changes}
                if paths:
                    continue
                cost = dict(c1.cost)
                for k, v in c2.cost.items():
                    cost[k] = cost.get(k, 0) + v
                pairs.append(_run(plan, Candidate(c1.kinds + c2.kinds, c1.changes + c2.changes, cost,
                                                  c1.title_parts + c2.title_parts), base_soft))
    return singles + pairs, ev0


def _select(cands: list[Candidate], n: int) -> list[tuple[str, Candidate]]:
    """Best candidate per strategy, preferring options that share no lever with earlier picks."""
    feas = [c for c in cands if _feasible(c)]

    def ranked_for(strat: str) -> list[Candidate]:
        weights = STRATEGIES[strat]["weights"]
        if strat == "resilience":
            if not feas:
                return []
            least = min(_total_cost(c) for c in feas)
            pool = [c for c in feas if _total_cost(c) <= least * 2 + 4]
            return sorted(pool, key=lambda c: (-_min_headroom_ratio(c.ev), _total_cost(c)))
        return sorted(feas, key=lambda c: (_total_cost(c, weights), -_min_headroom_ratio(c.ev)))

    chosen: list[tuple[str, Candidate]] = []
    for strict in (True, False):
        for strat in ("lifestyle", "speed", "resilience"):
            if len(chosen) >= n or any(s == strat for s, _ in chosen):
                continue
            used_kinds = {k for _, c in chosen for k in c.kinds}
            used_sigs = {frozenset(c.kinds) for _, c in chosen}
            for c in ranked_for(strat):
                sig = frozenset(c.kinds)
                if any(c is x for _, x in chosen) or sig in used_sigs:
                    continue
                if strict and sig & used_kinds:
                    continue
                if not strict and sig <= used_kinds:
                    continue
                chosen.append((strat, c))
                break
    order = {"lifestyle": 0, "speed": 1, "resilience": 2}
    chosen.sort(key=lambda sc: order[sc[0]])
    return chosen


def _person_impact(ev_before: dict, ev_after: dict) -> list[dict]:
    out = []
    for b, a in zip(ev_before["people"], ev_after["people"]):
        goals_b = {g["id"]: g for g in b["goals"]}
        out.append(dict(
            id=a["id"], name=a["name"], floor=a["floor"],
            min_cash=[b["min_cash"], a["min_cash"]],
            min_cash_month=[b["min_cash_month"], a["min_cash_month"]],
            headroom=[b["headroom"], a["headroom"]],
            runway=[b["lowest_runway_months"], a["lowest_runway_months"]],
            end_cash=[b["end_cash"], a["end_cash"]],
            end_net_worth=[b["end_net_worth"], a["end_net_worth"]],
            goals=[dict(name=g["name"], met=[goals_b[g["id"]]["met"], g["met"]],
                        projected=[goals_b[g["id"]]["projected_chf"], g["projected_chf"]], target=g["target_chf"],
                        target_date=[goals_b[g["id"]]["target_date"], g["target_date"]],
                        reached_month=[goals_b[g["id"]]["reached_month"], g["reached_month"]],
                        shortfall=[goals_b[g["id"]]["shortfall_chf"], g["shortfall_chf"]],
                        in_horizon=g["in_horizon"])
                   for g in a["goals"] if g["id"] in goals_b],
        ))
    return out


def _explain(plan: Plan, c: Candidate, ev0: dict, strat: str) -> dict:
    ev = c.ev
    assert ev is not None
    issues0 = {i["id"]: i for i in ev0["issues"]}
    issues1 = {i["id"]: i for i in ev["issues"]}
    resolved = [issues0[k]["title"] for k in issues0 if k not in issues1]
    remaining = [issues1[k]["title"] for k in issues1 if k in issues0]
    introduced = [issues1[k]["title"] for k in issues1 if k not in issues0]
    described = [describe(plan, ch) for ch in c.changes]
    changes_out = []
    for d in described:
        changes_out.append(dict(
            **d.model_dump(),
            previous_text=format_value(d.unit, d.previous),
            value_text=format_value(d.unit, d.value),
        ))
    tradeoffs = []
    cost = c.cost
    if "lifestyle" in cost:
        tradeoffs.append(f"Less flexible spending: {chf(cost['lifestyle'])}/month lower budgets.")
    if "delay" in cost:
        tradeoffs.append(f"The home is bought {int(cost['delay'])} month{'s' if cost['delay'] != 1 else ''} later; rent is paid in the meantime.")
    if "budget" in cost:
        tradeoffs.append(f"A {chf(cost['budget'])} lower budget narrows the choice of homes.")
    if "ownership" in cost:
        tradeoffs.append("Ownership follows the deposit, so property equity is split unequally.")
    if "split" in cost:
        tradeoffs.append("Household costs are no longer shared in proportion to income.")
    if "support" in cost:
        tradeoffs.append("The partner who keeps working temporarily carries a larger share of household costs.")
    if "break_shorter" in cost:
        tradeoffs.append(f"The career break is {int(cost['break_shorter'])} month{'s' if cost['break_shorter'] != 1 else ''} shorter.")
    if "break_partial" in cost:
        tradeoffs.append("Some paid work continues during the break.")
    if "break_later" in cost:
        tradeoffs.append(f"The career break starts {int(cost['break_later'])} months later.")
    if "deposit" in cost:
        tradeoffs.append("A different deposit changes the mortgage size and its interest cost.")
    if "goal" in cost:
        tradeoffs.append("A personal savings target is postponed — a concession, not a saving.")

    # Optionality: change in the tightest runway across both partners.
    rw0 = min((p["lowest_runway_months"] or 0) for p in ev0["people"])
    rw1 = min((p["lowest_runway_months"] or 0) for p in ev["people"])
    hr = [p["headroom"] for p in ev["people"]]
    why_parts = []
    hard0 = [i for i in ev0["issues"] if i["severity"] == "hard"]
    if hard0:
        i0 = hard0[0]
        why_parts.append(i0["detail"])
    why_parts.append(
        "With this change the simulator finds no month in which either partner drops below their minimum"
        + (f"; the smallest cushion left is {chf(min(hr))}." if hr else ".")
    )
    pr0, pr1 = ev0.get("property"), ev.get("property")
    shared = None
    if pr0 and pr1:
        shared = dict(
            purchase=[pr0["purchase"], pr1["purchase"]],
            price=[pr0["price"], pr1["price"]],
            contributions=[pr0["contributions"], pr1["contributions"]],
            target_date=pr1["target_date"],
            on_time=[M.index(pr0["purchase"], pr0["target_date"]) <= 0, M.index(pr1["purchase"], pr1["target_date"]) <= 0],
            affordability_ratio=[(pr0["affordability"] or {}).get("ratio"), (pr1["affordability"] or {}).get("ratio")],
        )
    title = " + ".join(c.title_parts)
    return dict(
        id="rec-" + hashlib.sha1(json.dumps([ch.model_dump() for ch in c.changes], sort_keys=True, default=str).encode()).hexdigest()[:10],
        strategy=strat,
        strategy_title=STRATEGIES[strat]["title"],
        strategy_blurb=STRATEGIES[strat]["blurb"],
        concession="goal" in cost,
        title=title,
        changes=changes_out,
        raw_changes=[ch.model_dump() for ch in c.changes],
        approvers=required_approvers(plan, c.changes),
        disruption=round(_total_cost(c), 2),
        resolves=resolved,
        remaining=remaining,
        introduces=introduced,
        tradeoffs=tradeoffs,
        why=" ".join(why_parts),
        optionality=dict(lowest_runway_months=[rw0, rw1], min_headroom=min(hr) if hr else None),
        people=_person_impact(ev0, ev),
        shared=shared,
        status=ev["status"],
        verified=c.sim_ok,
        assumptions=[
            "Projection under the plan's stated assumptions; not a forecast or advice.",
            "All values re-simulated month by month by the Converge engine.",
        ],
    )


def recommend(plan: Plan, n: int = 3) -> dict:
    cands, ev0 = search(plan)
    hard0 = [i for i in ev0["issues"] if i["severity"] == "hard"]
    soft0 = [i for i in ev0["issues"] if i["severity"] == "soft"]
    if not hard0 and not soft0:
        return dict(status="on_track", evaluated=len(cands), recommendations=[], message="This plan meets every constraint and goal — no changes needed.")
    if not hard0:
        # Only soft issues: look for options that remove soft issues without adding hard ones.
        improving = [c for c in cands if _feasible(c) and
                     len([i for i in c.ev["issues"] if i["severity"] == "soft"]) < len(soft0) and not c.extras.get("new_soft")]
        chosen = _select(improving, n)
        if n > 0 and not any("goal" in c.cost for _, c in chosen):
            concessions = [c for c in improving if c.kinds == ("goal",)]
            if concessions:
                concession = min(concessions, key=_total_cost)
                if len(chosen) == n:
                    chosen[-1] = (chosen[-1][0], concession)
                else:
                    chosen.append(("speed", concession))
    else:
        chosen = _select(cands, n)
    recs = [_explain(plan, c, ev0, s) for s, c in chosen]
    out = dict(status=ev0["status"], evaluated=len(cands), recommendations=recs, message=None)
    if not recs:
        best = min(cands, key=_hard_total, default=None)
        if hard0:
            msg = ("No combination of up to two supported adjustments removes every hard constraint violation. ")
            if best is not None and best.ev is not None and _hard_total(best) < math.inf:
                msg += (f"The closest option ({'; '.join(best.title_parts)}) still leaves a shortfall of "
                        f"{chf(_hard_total(best))}. Consider a larger change to the plan, such as a lower budget "
                        "or a different timeline.")
            out["message"] = msg
            out["closest"] = _explain(plan, best, ev0, "resilience") if best is not None and best.ev else None
        else:
            out["message"] = "No supported adjustment improves the remaining goals without creating new problems."
    return out
