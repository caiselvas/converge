"""Recommendations must be verified by independent re-simulation."""
from converge.engine.changes import apply_changes
from converge.engine.evaluate import evaluate
from converge.engine.recommend import recommend
from converge.models import Change


def C(path, value):
    return Change(path=path, value=value)


def _conflict(plan):
    return apply_changes(plan, [C("shared.household.enabled", True), C("shared.property.enabled", True)])


def test_recommendations_are_feasible_distinct_and_explained(simple_plan):
    plan = _conflict(simple_plan)
    assert evaluate(plan)["status"] == "conflict"
    out = recommend(plan)
    recs = out["recommendations"]
    assert 1 <= len(recs) <= 3
    seen = set()
    for r in recs:
        # Independently re-apply and re-simulate: no hard violations.
        changes = [Change(**c) for c in r["raw_changes"]]
        ev = evaluate(apply_changes(plan, changes))
        assert not [i for i in ev["issues"] if i["severity"] == "hard"]
        assert r["verified"] is True
        assert "Ben's safety buffer is breached" in r["resolves"]
        for c in r["changes"]:
            assert c["previous"] != c["value"] and c["previous_text"] and c["value_text"]
        assert r["people"][1]["headroom"][1] >= 0
        assert r["approvers"]
        kinds = frozenset(c["path"] for c in r["changes"])
        assert kinds not in seen
        seen.add(kinds)


def test_no_recommendations_when_on_track(simple_plan):
    out = recommend(simple_plan)
    assert out["status"] == "on_track" and out["recommendations"] == []


def test_infeasible_plan_is_explained(simple_plan):
    p = simple_plan.model_copy(deep=True)
    p.people[0].opening_cash = 0.0
    plan = apply_changes(_conflict(p), [C("people.B.income_monthly", 0.0), C("people.A.income_monthly", 0.0)])
    out = recommend(plan)
    assert out["recommendations"] == []
    assert "No combination" in out["message"]


def test_recommendations_do_not_mutate_input(simple_plan):
    plan = _conflict(simple_plan)
    before = plan.model_dump()
    recommend(plan)
    assert plan.model_dump() == before


def test_demo_conflict_has_alternatives(demo_plan):
    brk = [dict(id="cb1", start="2028-01", months=12, income_pct=0, one_off_cost_chf=8000)]
    plan = apply_changes(demo_plan, [C("shared.household.enabled", True), C("shared.property.enabled", True),
                                     C("people.P00809.career_breaks", brk)])
    ev = evaluate(plan)
    assert ev["status"] == "conflict"
    assert ev["issues"][0]["person"] == "P00809"
    out = recommend(plan)
    assert len(out["recommendations"]) == 3


def test_firm_home_date_excludes_delay_from_every_option(simple_plan):
    simple_plan.people[1].opening_cash = 65_000
    plan = _conflict(simple_plan)
    baseline = recommend(plan, comparison=True)["recommendations"]
    assert any(c["path"] == "shared.property.purchase" for option in baseline for c in option["raw_changes"])
    firm = recommend(plan, preferences={"date_flex": {"A": "fixed"}}, comparison=True)["recommendations"]
    assert firm and all(c["path"] != "shared.property.purchase" for option in firm for c in option["raw_changes"])
    assert all("For Ana, keeps the home purchase month." in option["respects"] for option in firm)


def test_flexible_budget_becomes_less_disruptive_than_delay(simple_plan):
    simple_plan.people[1].opening_cash = 65_000
    plan = _conflict(simple_plan)
    baseline = recommend(plan, comparison=True)["recommendations"]
    preferred = recommend(plan, preferences={"budget_flex": {"A": "lower"}}, comparison=True)["recommendations"]
    old_budget = next(o for o in baseline if o["primary_lever"] == "budget")
    new_budget = next(o for o in preferred if o["primary_lever"] == "budget")
    assert new_budget["disruption"] == old_budget["disruption"] / 2
    assert new_budget["disruption"] < next(o for o in preferred if o["primary_lever"] == "delay")["disruption"]
    assert "For Ana, uses a lower budget as requested." in new_budget["respects"]


def test_recommendation_can_sell_investments_before_first_breach(simple_plan):
    simple_plan.shared.property.price = 900_000
    simple_plan.people[1].investments = 100_000
    plan = _conflict(simple_plan)
    option = next(o for o in recommend(plan, comparison=True)["recommendations"]
                  if o["primary_lever"] == "sell_investments")
    ev = evaluate(apply_changes(plan, [Change(**c) for c in option["raw_changes"]]))
    assert ev["status"] != "conflict" and ev["checks"]["ok"]
    assert sum(ev["series"]["B"]["investment_sale"]) > 0
