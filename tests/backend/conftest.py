import pytest

from converge.data import ubs
from converge.models import Assumptions, Category, Goal, Household, Person, Plan, Property, Shared, Split


def _person(pid, name, income, cash, rent=1500.0, floor=10_000.0, goals=None):
    cats = [
        Category(key="housing_rent", label="Rent", group="housing", observed_monthly=rent, budget_monthly=rent, household=True),
        Category(key="utilities", label="Utilities", group="housing", observed_monthly=150, budget_monthly=150, household=True),
        Category(key="groceries", label="Groceries", group="essential", observed_monthly=400, budget_monthly=400, household=True),
        Category(key="health_insurance", label="Health insurance", group="essential", observed_monthly=350, budget_monthly=350),
        Category(key="restaurants", label="Restaurants", group="flexible", observed_monthly=300, budget_monthly=300),
        Category(key="leisure", label="Leisure", group="flexible", observed_monthly=200, budget_monthly=200),
    ]
    return Person(id=pid, name=name, age=35, city="Zurich", employment_status="employed", income_monthly=income,
                  income_observed_monthly=income, opening_cash=cash, opening_cash_date="2026-12", investments=0.0,
                  categories=cats, emergency_floor=floor, goals=goals or [])


@pytest.fixture
def simple_plan() -> Plan:
    """Hand-built plan with round numbers and no growth/inflation/tax, for exact checks."""
    return Plan(
        people=[_person("A", "Ana", 8000, 100_000), _person("B", "Ben", 6000, 40_000, rent=1200)],
        shared=Shared(
            household=Household(enabled=False, move_in="2027-04", rent=2500, utilities=200, groceries=800, moving_cost=2000),
            split=Split(mode="equal"),
            property=Property(enabled=False, purchase="2028-01", price=1_000_000, deposit_pct=0.2, fees_pct=0.01,
                              ownership_share_first=0.5, mortgage_rate=0.02, maintenance_pct=0.01, target_date="2028-06"),
        ),
        assumptions=Assumptions(start="2027-01", horizon_months=36, tax_rate=0.0, expense_inflation=0.0,
                                income_growth=0.0, investment_return=0.0),
    )


def _data_available() -> bool:
    try:
        ubs.data_dir()
        return True
    except ubs.DataUnavailableError:
        return False


requires_data = pytest.mark.skipif(not _data_available(), reason="UBS data not present in external/ubs/Data")


@pytest.fixture(scope="session")
def demo_plan():
    if not _data_available():
        pytest.skip("UBS data not available")
    from converge.seed import default_plan

    return default_plan()


__all__ = ["requires_data", "_person"]
