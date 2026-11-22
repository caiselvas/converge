import pytest

from converge.engine.changes import apply_changes, required_approvers
from converge.engine.simulate import simulate
from converge.engine.what_if import WhatIf, compare, scenario_changes
from converge.models import Change


def test_study_cash_flows_and_pension_follow_the_same_period(simple_plan):
    plan = apply_changes(simple_plan, [
        Change(path="people.A.income_tax_monthly", value=300),
        Change(path="people.A.pension_opening_chf", value=40_000),
        Change(path="people.A.pension_credit_monthly", value=500),
    ])
    choice = WhatIf.model_validate({"study": {
        "person": "A", "program": "quant_finance", "start": "2027-03",
        "income_pct": 50, "extra_cost_chf": 200, "monthly_pay_delta": 1000,
    }})
    changes, _ = scenario_changes(plan, choice)
    assert required_approvers(plan, changes) == ["A"]
    scenario = apply_changes(plan, changes)
    s, partner = simulate(scenario).people
    assert [(i, cost) for i, cost in enumerate(s.one_off) if cost] == [(2, 980), (8, 780), (14, 780)]
    assert s.income[1:3] == [8000, 4000]
    assert s.income[19:21] == [4000, 9000]
    assert s.tax[2] == 300
    assert s.pension[2] == 41_250
    assert s.net_worth[2] == pytest.approx(s.cash[2] + s.pension[2])
    assert partner.cash == simulate(plan).people[1].cash
    removed = apply_changes(scenario, [Change(path="people.A.career_breaks", value=[])])
    assert simulate(removed).people[0].cash == simulate(plan).people[0].cash


def test_paired_risk_and_combined_minimum_use_the_same_months(simple_plan):
    choice = WhatIf.model_validate({
        "study": {"person": "B", "program": "fine_arts", "start": "2027-02", "income_pct": 0},
        "housing": {"arrangement": "together", "purchase": "include"},
        "uncertainty": {},
    })
    result = compare(simple_plan, choice)
    assert result == compare(simple_plan, choice)
    assert result["inputs"]["study"]["duration_months"] == 24
    assert result["inputs"]["study"]["semester_fee_chf"] == 755
    ana, ben, combined = result["scenario"]
    assert combined["minimum_cash"] == pytest.approx(min(a + b for a, b in zip(ana["cash"], ben["cash"])), abs=0.02)
    assert all(0 <= count <= result["risk"]["trials"] for count in result["risk"]["scenario_breaches"])
    assert result["risk"]["baseline_breaches"] == [0, 0, 0]
    assert result["risk"]["scenario_breaches"][2] >= max(result["risk"]["scenario_breaches"][:2])
    assert result["checks_passed"]
    assert not simple_plan.shared.household.enabled and not simple_plan.shared.property.enabled


def test_no_change_produces_zero_paired_delta(simple_plan):
    choice = WhatIf.model_validate({"uncertainty": {}})
    result = compare(simple_plan, choice)
    assert result["risk"]["paired_worth_delta"] == [0, 0, 0]
    assert result["risk"]["baseline_breaches"] == result["risk"]["scenario_breaches"]
    assert not result["draft_changes"]
