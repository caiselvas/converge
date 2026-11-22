"""Hard and soft constraint detection and goal tracking."""
from converge.engine.changes import apply_changes
from converge.engine.evaluate import evaluate
from converge.models import Change, Goal


def C(path, value):
    return Change(path=path, value=value)


def test_on_track_baseline(simple_plan):
    ev = evaluate(simple_plan)
    assert ev["status"] == "on_track" and ev["issues"] == []


def test_liquidity_floor_breach_reports_person_month_amount_and_drivers(simple_plan):
    plan = apply_changes(simple_plan, [C("shared.property.enabled", True)])
    ev = evaluate(plan)
    # Ben has 40k + 12*3400 = 80.8k before paying 105k for his half -> breach.
    hard = [i for i in ev["issues"] if i["severity"] == "hard"]
    assert ev["status"] == "conflict"
    assert hard[0]["kind"] == "liquidity_floor" and hard[0]["person"] == "B"
    assert hard[0]["month"] == "2028-01"
    ben = next(p for p in ev["people"] if p["id"] == "B")
    assert hard[0]["amount_chf"] == round(10_000 - ben["min_cash"], 2)
    assert hard[0]["needs_financing"] is True
    labels = [d["label"] for d in hard[0]["drivers"]]
    assert "Home deposit" in labels


def test_affordability_failure_is_hard(simple_plan):
    p = simple_plan.model_copy(deep=True)
    p.people[0].opening_cash = p.people[1].opening_cash = 2_000_000
    plan = apply_changes(p, [C("shared.property.enabled", True), C("shared.property.price", 2_000_000)])
    ev = evaluate(plan)
    aff = next(i for i in ev["issues"] if i["kind"] == "affordability")
    assert aff["severity"] == "hard"
    assert ev["property"]["affordability"]["passes"] is False
    assert ev["property"]["affordability"]["max_price"] < 2_000_000


def test_late_purchase_is_soft(simple_plan):
    plan = apply_changes(simple_plan, [C("shared.property.enabled", True), C("shared.property.purchase", "2029-06"),
                                       C("shared.property.price", 500_000)])
    ev = evaluate(plan)
    soft = [i for i in ev["issues"] if i["kind"] == "home_goal"]
    assert soft and soft[0]["severity"] == "soft" and soft[0]["months_late"] == 12


def test_goals_funded_in_priority_order(simple_plan):
    p = simple_plan.model_copy(deep=True)
    # Ben ends 2027 with 40k + 12*3400 = 80.8k.
    p.people[1].goals = [
        Goal(id="g2", name="Car", target_chf=50_000, target_date="2027-12", priority="medium", measure="cash"),
        Goal(id="g1", name="Emergency savings", target_chf=50_000, target_date="2027-12", priority="high", measure="cash"),
    ]
    ev = evaluate(p)
    ben = next(x for x in ev["people"] if x["id"] == "B")
    g = {x["name"]: x for x in ben["goals"]}
    assert g["Emergency savings"]["met"] is True
    # The same francs cannot fund the car too: 80.8k - 50k = 30.8k < 50k.
    assert g["Car"]["met"] is False
    assert round(g["Car"]["shortfall_chf"]) == 19_200
    assert any(i["kind"] == "goal" and i["severity"] == "soft" for i in ev["issues"])


def test_conflicting_goals_and_insufficient_savings(simple_plan):
    p = simple_plan.model_copy(deep=True)
    p.people[1].emergency_floor = 1_000_000
    ev = evaluate(p)
    assert ev["status"] == "conflict"
    assert ev["people"][1]["breach"] is True
