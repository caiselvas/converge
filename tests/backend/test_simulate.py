"""Monthly cash-flow identities, transfers, housing, mortgage and career breaks."""
import pytest

from converge.engine.changes import apply_changes
from converge.engine.evaluate import evaluate
from converge.engine.simulate import simulate
from converge.models import Change


def C(path, value):
    return Change(path=path, value=value)


def test_cash_identity_and_checks(simple_plan):
    res = simulate(simple_plan)
    assert res.checks["ok"]
    for s in res.people:
        prev = s.cash_open[0]
        for t in range(len(res.months)):
            assert s.cash[t] == pytest.approx(prev + s.net_flow[t], abs=1e-6)
            prev = s.cash[t]


def test_independent_twins_exact_numbers(simple_plan):
    res = simulate(simple_plan)
    a, b = res.people
    # Ana: 8000 - (1500+150+400+350+300+200) = 5100 per month
    assert a.net_flow[0] == pytest.approx(5100)
    assert a.cash[-1] == pytest.approx(100_000 + 36 * 5100)
    # Ben: 6000 - (1200+150+400+350+300+200) = 3400
    assert b.cash[-1] == pytest.approx(40_000 + 36 * 3400)
    assert all(x == 0 for x in res.joint_in)


def test_moving_in_replaces_own_housing_without_double_counting(simple_plan):
    plan = apply_changes(simple_plan, [C("shared.household.enabled", True)])
    res = simulate(plan)
    a, b = res.people
    t = 3  # 2027-04 move in
    assert res.months[t] == "2027-04"
    # Before: own rent+utilities+groceries; after: only personal categories.
    assert a.spending[t - 1] == pytest.approx(1500 + 150 + 400 + 350 + 300 + 200)
    assert a.spending[t] == pytest.approx(350 + 300 + 200)
    # Household costs 2500+200+800 = 3500, plus 2000 moving in the first month, split equally.
    assert a.household[t] == pytest.approx((3500 + 2000) / 2)
    assert a.household[t + 1] == pytest.approx(1750)
    # Transfers into the joint account equal its payments: they cancel at household level.
    assert res.checks["transfers_cancel_max_error"] < 1e-9
    total_hh = sum(s.household[t + 1] for s in res.people)
    assert total_hh == pytest.approx(3500)


def test_income_proportional_and_custom_split(simple_plan):
    plan = apply_changes(simple_plan, [C("shared.household.enabled", True), C("shared.split.mode", "income")])
    res = simulate(plan)
    assert res.people[0].household[10] == pytest.approx(3500 * 8000 / 14000)
    plan = apply_changes(plan, [C("shared.split.mode", "custom"), C("shared.split.custom_share_first", 0.7)])
    res = simulate(plan)
    assert res.people[0].household[10] == pytest.approx(3500 * 0.7)
    assert res.people[1].household[10] == pytest.approx(3500 * 0.3)


def test_property_purchase_converts_cash_to_equity_and_mortgage_accounting(simple_plan):
    plan = apply_changes(simple_plan, [C("shared.property.enabled", True)])
    base = simulate(simple_plan)
    res = simulate(plan)
    tp = res.purchase_index
    assert res.months[tp] == "2028-01"
    a = res.people[0]
    # Deposit 200k + fees 10k split 50/50.
    assert a.deposit[tp] == pytest.approx(100_000)
    assert a.one_off[tp] == pytest.approx(5_000)
    # Net worth only falls by fees (plus the different running costs), not by the deposit.
    nw_change = a.net_worth[tp] - a.net_worth[tp - 1]
    expected = a.income[tp] - a.spending[tp] - a.household[tp] - 5_000
    assert nw_change == pytest.approx(expected, abs=1e-6)
    # Mortgage 800k; second tier above 2/3 of value amortised over 15 years.
    assert res.mortgage[tp] == pytest.approx(800_000)
    amort = (800_000 - 1_000_000 * 2 / 3) / 180
    assert res.mortgage[tp + 1] == pytest.approx(800_000 - amort)
    # Interest is an expense on the outstanding balance, maintenance 1%/yr of value.
    assert a.housing[tp + 1] == pytest.approx(0.5 * (800_000 * 0.02 / 12 + 1_000_000 * 0.01 / 12))
    # Amortisation reduces cash and debt equally -> net-worth neutral.
    assert a.amortization[tp + 1] == pytest.approx(0.5 * amort)
    # Rent stops once the home is owned; cohabitation starts at purchase if not earlier.
    assert res.joint_out[tp + 1] == pytest.approx(200 + 800)
    assert res.checks["ok"] and res.checks["mortgage_non_negative"]
    # The baseline is untouched (scenario isolation).
    assert base.purchase_index is None
    assert not simple_plan.shared.property.enabled


def test_mortgage_never_negative_when_paid_off(simple_plan):
    plan = apply_changes(simple_plan, [C("shared.property.enabled", True), C("shared.property.deposit_pct", 0.333),
                                       C("assumptions.horizon_months", 120)])
    res = simulate(plan)
    assert all(m >= 0 for m in res.mortgage)


def test_zero_interest_rate_and_zero_income(simple_plan):
    plan = apply_changes(simple_plan, [C("shared.property.enabled", True), C("shared.property.mortgage_rate", 0.0),
                                       C("people.B.income_monthly", 0.0)])
    res = simulate(plan)
    assert res.checks["ok"]
    b = res.people[1]
    assert all(x == 0 for x in b.income)
    assert b.cash[-1] < b.cash_open[0]
    assert res.people[0].housing[res.purchase_index + 1] == pytest.approx(0.5 * 1_000_000 * 0.01 / 12)


def test_career_break_only_affects_its_months(simple_plan):
    brk = [dict(id="cb1", start="2027-06", months=6, income_pct=25, one_off_cost_chf=3000)]
    plan = apply_changes(simple_plan, [C("people.B.career_breaks", brk)])
    res = simulate(plan)
    b = res.people[1]
    assert b.income[4] == 6000 and b.income[11] == 6000
    assert all(b.income[t] == pytest.approx(1500) for t in range(5, 11))
    assert b.one_off[5] == pytest.approx(3000)
    base = simulate(simple_plan).people[1]
    assert base.cash[-1] - b.cash[-1] == pytest.approx(6 * 4500 + 3000)


def test_break_adjusted_split_shifts_costs_to_working_partner(simple_plan):
    brk = [dict(id="cb1", start="2027-06", months=3, income_pct=0, one_off_cost_chf=0)]
    plan = apply_changes(simple_plan, [C("shared.household.enabled", True), C("people.B.career_breaks", brk),
                                       C("shared.split.adjust_for_breaks", True)])
    res = simulate(plan)
    assert res.people[1].household[6] == 0
    assert res.people[0].household[6] == pytest.approx(3500)
    assert res.people[1].household[9] == pytest.approx(1750)


def test_tax_and_units(simple_plan):
    plan = apply_changes(simple_plan, [C("assumptions.tax_rate", 0.1)])
    res = simulate(plan)
    assert sum(res.people[0].tax[:12]) == pytest.approx(0.1 * 8000 * 12)


def test_inflation_compounds_annually_consistently(simple_plan):
    plan = apply_changes(simple_plan, [C("assumptions.expense_inflation", 0.02)])
    a = simulate(plan).people[0]
    assert a.spending[12] == pytest.approx(a.spending[0] * 1.02)
    assert a.spending[24] == pytest.approx(a.spending[0] * 1.02 ** 2)


def test_negative_investment_return(simple_plan):
    p = simple_plan.model_copy(deep=True)
    p.people[0].investments = 10_000
    p.assumptions.investment_return = -0.1
    res = simulate(p)
    assert res.people[0].investments[11] == pytest.approx(9_000)


def test_deterministic(simple_plan):
    assert simulate(simple_plan).people[0].cash == simulate(simple_plan).people[0].cash


def test_overlapping_career_breaks_rejected(simple_plan):
    from converge.engine.changes import ChangeError

    brk = [dict(id="a", start="2027-06", months=6, income_pct=0, one_off_cost_chf=0),
           dict(id="b", start="2027-09", months=3, income_pct=0, one_off_cost_chf=0)]
    with pytest.raises(ChangeError):
        apply_changes(simple_plan, [C("people.B.career_breaks", brk)])


def child_change(*, birth="2027-01", **updates):
    data = dict(id="child-1", birth=birth, allowance_recipient="B",
                leave={"birth_parent": "A", "other_parent": "B"})
    return C("shared.children", [{**data, **updates}])


def test_child_costs_cancel_transfers_and_raise_outgoings(simple_plan):
    plan = apply_changes(simple_plan, [child_change()])
    res = simulate(plan)
    base = simulate(simple_plan)
    a, b = res.people
    ev = evaluate(plan, res)
    assert res.checks["ok"]
    assert res.joint_in == pytest.approx(res.joint_out)
    assert res.joint_balance == pytest.approx([0] * len(res.months))
    assert a.spending == base.people[0].spending  # no cohabitation implied
    assert res.joint_in[0] == pytest.approx(700)
    assert res.joint_in[4] == pytest.approx(700 + 2 * 4.2 * 138)
    assert a.outgoings[4] - base.people[0].outgoings[4] == pytest.approx(res.joint_in[4] / 2)
    assert all(v == 0 for v in a.family_allowance)
    assert b.family_allowance[0] == b.family_allowance[4] == 215
    assert b.income[4] - base.people[1].income[4] == 215
    assert ev["children"][0]["costs"][4]["net_cost"] == pytest.approx(1644.20)
    assert ev["children"][0]["costs"][18]["childcare"] == pytest.approx(2 * 4.2 * 120)
    assert {"month": "2027-01", "kind": "child_birth", "label": "Child born", "person": None} in ev["events"]


def test_parental_leave_prorates_months_and_caps_daily_pay(simple_plan):
    plan = apply_changes(simple_plan, [C("people.A.income_monthly", 10_000), child_change(birth="2028-02")])
    res = simulate(plan)
    a, b = res.people
    feb = res.months.index("2028-02")
    assert a.income[feb:feb + 3] == pytest.approx([29 * 220, 31 * 220, 30 * 220])
    assert a.income[feb + 3] == pytest.approx(10_000 * 23 / 31 + 8 * 220)
    assert a.income[feb + 4] == 10_000
    assert b.income[feb] == pytest.approx(6000 * 15 / 29 + 14 * 160 + 215)
    assert b.income[feb + 1] == 6000 + 215


def test_zero_childcare_and_birth_after_horizon(simple_plan):
    plan = apply_changes(simple_plan, [child_change(childcare_days_per_week=0)])
    res = simulate(plan)
    assert all(cost.childcare == 0 for cost in res.child_costs["child-1"])
    assert res.joint_in[4] == 700
    later = apply_changes(simple_plan, [child_change(birth="2040-01")])
    ev = evaluate(later)
    base = evaluate(simple_plan)
    assert ev["series"] == base["series"] and ev["events"] == base["events"]
    assert all(cost["net_cost"] == 0 for cost in ev["children"][0]["costs"])


def test_childcare_stops_at_four_and_allowance_steps_after_birthday_month(simple_plan):
    childcare = simulate(apply_changes(simple_plan, [child_change(birth="2023-02")])).child_costs["child-1"]
    assert childcare[0].childcare == pytest.approx(2 * 4.2 * 120)
    assert childcare[1].childcare == 0
    allowance = simulate(apply_changes(simple_plan, [child_change(birth="2015-02")])).people[1].family_allowance
    assert allowance[:3] == [215, 215, 268]


def test_child_drivers_distinguish_leave_and_care(simple_plan):
    plan = apply_changes(simple_plan, [
        C("people.B.emergency_floor", 40_000),
        child_change(childcare_start_months_after_birth=0, everyday_cost_monthly=5000, childcare_days_per_week=5),
    ])
    issue = next(i for i in evaluate(plan)["issues"] if i["id"] == "floor:B")
    labels = {driver["label"] for driver in issue["drivers"]}
    assert {"Childcare", "Everyday child costs", "Parental leave income"} <= labels
    assert "Income lost during career break" not in labels


def test_twins_share_leave_days_but_each_receive_an_allowance(simple_plan):
    change = child_change()
    one = simulate(apply_changes(simple_plan, [change]))
    twin = {**change.value[0], "id": "child-2"}
    both = simulate(apply_changes(simple_plan, [C("shared.children", [*change.value, twin])]))
    assert both.people[0].income == one.people[0].income
    assert both.people[1].family_allowance[0] == 2 * one.people[1].family_allowance[0]
    assert both.people[1].income[0] - one.people[1].income[0] == 215
    assert both.joint_in[4] == pytest.approx(2 * one.joint_in[4])


def test_investment_sale_moves_cash_only_and_caps_at_available_portfolio(simple_plan):
    simple_plan.people[0].investments = 30_000
    plan = apply_changes(simple_plan, [C("people.A.sell_investments", [
        {"month": "2027-04", "amount": 15_000},
        {"month": "2027-06", "amount": 25_000},
        {"month": "2040-06", "amount": 1000},
    ])])
    baseline = simulate(simple_plan).people[0]
    result = simulate(plan)
    a = result.people[0]
    assert result.checks["ok"]
    assert a.investment_sale[3] == 15_000 and a.investment_sale[5] == 15_000
    assert a.cash[3] - baseline.cash[3] == 15_000
    assert a.investments[3] == 15_000 and a.investments[5] == 0
    assert a.income == baseline.income
    assert a.net_worth == pytest.approx(baseline.net_worth, abs=1e-6)
    assert sum(a.investment_sale) == 30_000


@pytest.mark.parametrize("sale", [{"month": "2027-04", "amount": -1}, {"month": "2027-13", "amount": 1}])
def test_invalid_investment_sale(simple_plan, sale):
    from converge.engine.changes import ChangeError

    with pytest.raises(ChangeError):
        apply_changes(simple_plan, [C("people.A.sell_investments", [sale])])
