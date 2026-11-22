"""Monthly cash-flow identities, transfers, housing, mortgage and career breaks."""
import pytest

from converge.engine.changes import apply_changes
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
