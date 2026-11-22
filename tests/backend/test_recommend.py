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
    brk = [dict(id="cb1", start="2028-01", months=6, income_pct=0, one_off_cost_chf=8000)]
    plan = apply_changes(demo_plan, [C("shared.household.enabled", True), C("shared.property.enabled", True),
                                     C("people.P00809.career_breaks", brk)])
    ev = evaluate(plan)
    assert ev["status"] == "conflict"
    assert ev["issues"][0]["person"] == "P00809"
    out = recommend(plan)
    assert len(out["recommendations"]) == 3
