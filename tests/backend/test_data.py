"""Loading and reconciling the UBS synthetic records; initialising the two twins."""
from conftest import requires_data

from converge.data import ubs
from converge.data.profiles import build_person

pytestmark = requires_data


def test_transactions_read_from_zip_and_reconcile_with_cash_balances():
    for pid in ("P00918", "P00809"):
        led = ubs.profile_ledger_summary(pid)
        assert led["months_observed"] == 24
        rec = led["reconciliation"]
        assert rec["max_abs_error_net_vs_ledger_chf"] < 0.01
        assert rec["max_abs_error_balance_chain_chf"] < 0.01
        # Opening cash + all transactions == final closing cash.
        tx = ubs.transactions_for(pid)
        assert abs(led["opening_cash_chf"] + tx["amount_chf"].sum() - led["closing_cash_chf"]) < 0.01


def test_profiles_initialise_independently_from_dataset():
    nina, emil = build_person("P00918"), build_person("P00809")
    assert (nina.name, emil.name) == ("Nina", "Emil")
    assert nina.city == emil.city == "Zurich"
    # Opening cash is the reconciled Dec-2026 closing balance.
    cb = ubs.cash_balances()
    last = cb[cb.profile_id == "P00809"].sort_values("month").iloc[-1]
    assert emil.opening_cash == round(float(last.closing_cash_chf), 2)
    assert emil.opening_cash_date == "2026-12"
    # Income equals the trailing-12-month mean of salary transactions.
    tx = ubs.transactions_for("P00809")
    sal = tx[(tx.category == "salary_or_support")]
    last12 = sorted(sal.month.unique())[-12:]
    assert abs(emil.income_monthly - round(sal[sal.month.isin(last12)].amount_chf.sum() / 12)) <= 1
    # Categories are non-negative, and observed == budget initially.
    for p in (nina, emil):
        assert p.categories and all(c.budget_monthly == c.observed_monthly >= 0 for c in p.categories)
        assert {c.key for c in p.categories if c.household} == {"housing_rent", "utilities", "groceries"}
        assert p.emergency_floor > 0
    # Dataset goals carried over with provenance.
    assert [g.name for g in emil.goals] == ["Emergency savings", "Career transition"]
    assert all(g.source == "dataset" for g in emil.goals)


def test_irregular_categories_flagged():
    emil = build_person("P00809")
    unplanned = next(c for c in emil.categories if c.key == "unexpected_expense")
    assert unplanned.group == "irregular" and not unplanned.regular
