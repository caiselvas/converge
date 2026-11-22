"""Typed domain model for Converge plans.

All monetary values are CHF. Recurring amounts are **per month** unless the
field name says otherwise. Dates are calendar months formatted ``YYYY-MM``.
Rates are decimals per **year** (0.018 = 1.8% p.a.).
"""
from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _check_month(v: str) -> str:
    if not MONTH_RE.match(v):
        raise ValueError("month must be formatted YYYY-MM")
    return v


Month = Annotated[str, AfterValidator(_check_month)]
CHILD_EVERYDAY_DEFAULT = 700.0
KITA_INFANT_TARIFF = 138.0
KITA_OLDER_TARIFF = 120.0
CHILD_ALLOWANCE_BASE = 215.0
CHILD_ALLOWANCE_OLDER = 268.0
BIRTH_LEAVE_DAYS = 98
OTHER_PARENT_LEAVE_DAYS = 14
LEAVE_REPLACEMENT = 0.8
LEAVE_DAILY_CAP = 220.0


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


CategoryGroup = Literal["housing", "essential", "flexible", "irregular"]
Provenance = Literal["dataset", "derived", "user", "assumption"]


class Category(Model):
    key: str
    label: str
    group: CategoryGroup
    observed_monthly: float = Field(ge=0, description="Average from the UBS ledger (trailing 12 months)")
    budget_monthly: float = Field(ge=0, description="Forward budget used by the simulation")
    household: bool = Field(False, description="Becomes a shared household cost once the couple lives together")
    regular: bool = True


class Goal(Model):
    id: str
    name: str
    target_chf: float = Field(ge=0)
    target_date: Month
    priority: Literal["high", "medium", "low"] = "medium"
    measure: Literal["cash", "liquid"] = Field(
        "cash", description="cash = bank cash only; liquid = cash + investment portfolio"
    )
    source: Provenance = "dataset"


class CareerBreak(Model):
    id: str
    start: Month
    months: int = Field(ge=1, le=36)
    income_pct: float = Field(0.0, ge=0, le=100, description="Share of usual net income received during the break")
    one_off_cost_chf: float = Field(0.0, ge=0, description="E.g. course fees, paid in the first month")
    label: str = "Career break"


class InvestmentSale(Model):
    month: Month
    amount: float = Field(gt=0, allow_inf_nan=False)


class Liability(Model):
    id: str
    kind: str
    principal_chf: float = Field(ge=0)
    annual_rate: float = Field(ge=0, le=0.5)
    monthly_payment_chf: float = Field(ge=0)
    note: str = ""


class Person(Model):
    id: str  # UBS profile id
    name: str
    age: int
    city: str
    employment_status: str
    income_monthly: float = Field(ge=0, description="Usual net income per month (forward assumption)")
    income_observed_monthly: float = Field(ge=0, description="Observed net salary, trailing 12 months")
    bonus_observed_annual: float = Field(0.0, ge=0, description="Observed irregular bonus income (not extrapolated)")
    include_bonus: bool = False
    opening_cash: float
    opening_cash_date: Month
    investments: float = Field(0.0, ge=0)
    investments_as_of: str = ""
    liabilities: list[Liability] = []
    categories: list[Category]
    emergency_floor: float = Field(ge=0, description="Hard constraint: cash must never fall below this")
    goals: list[Goal] = []
    career_breaks: list[CareerBreak] = []
    sell_investments: list[InvestmentSale] = Field(default_factory=list, max_length=120)

    @model_validator(mode="after")
    def _no_overlapping_breaks(self) -> "Person":
        spans = []
        for b in self.career_breaks:
            y, m = (int(x) for x in b.start.split("-"))
            start = y * 12 + m
            spans.append((start, start + b.months))
        spans.sort()
        for (s1, e1), (s2, _) in zip(spans, spans[1:]):
            if s2 < e1:
                raise ValueError("career breaks of one person must not overlap")
        if len({b.id for b in self.career_breaks}) != len(self.career_breaks):
            raise ValueError("career break ids must be unique")
        return self


class Household(Model):
    """Shared living arrangement. Before ``move_in`` each partner keeps their own home."""

    enabled: bool = False
    move_in: Month = "2027-04"
    rent: float = Field(3200.0, ge=0)
    utilities: float = Field(260.0, ge=0)
    groceries: float = Field(0.0, ge=0, description="Combined household groceries")
    moving_cost: float = Field(3000.0, ge=0, description="One-off, shared")


class Split(Model):
    """How shared household costs are divided between the partners."""

    mode: Literal["equal", "income", "custom"] = "income"
    custom_share_first: float = Field(0.5, ge=0, le=1, description="Share paid by the first partner (custom mode)")
    break_support_share: float = Field(1.0, ge=0, le=1)
    adjust_for_breaks: bool = Field(
        False, description="During a partner's career break, contributions follow actual income"
    )


class Property(Model):
    enabled: bool = False
    purchase: Month = "2028-04"
    price: float = Field(1_400_000.0, ge=0)
    deposit_pct: float = Field(0.25, ge=0.20, le=1.0, description="Equity share of the price (Swiss practice: ≥ 20%)")
    fees_pct: float = Field(0.01, ge=0, le=0.1, description="Notary, land registry and mortgage-note fees")
    ownership_share_first: float = Field(
        0.5, ge=0, le=1, description="First partner's share of deposit, ownership and property costs"
    )
    mortgage_rate: float = Field(0.018, ge=0, le=0.15)
    maintenance_pct: float = Field(0.01, ge=0, le=0.05, description="Annual maintenance, % of property value")
    amortize: bool = True
    target_date: Month = "2028-06"


class ParentalLeave(Model):
    birth_parent: str
    other_parent: str


class Child(Model):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]+$")
    label: str = Field("Child", min_length=1, max_length=80)
    birth: Month
    everyday_cost_monthly: float = Field(CHILD_EVERYDAY_DEFAULT, ge=0, allow_inf_nan=False)
    childcare_days_per_week: float = Field(2, ge=0, le=5)
    childcare_day_tariff: float | None = Field(None, ge=0, allow_inf_nan=False, description="Override the Zurich age-based tariff")
    childcare_start_months_after_birth: int = Field(4, ge=0, le=48)
    childcare_until_age: int = Field(4, ge=0, le=4)
    allowance_recipient: str
    leave: ParentalLeave


class Shared(Model):
    household: Household = Household()
    split: Split = Split()
    property: Property = Property()
    children: list[Child] = Field(default_factory=list, max_length=3)


class Assumptions(Model):
    start: Month = "2027-01"
    horizon_months: int = Field(120, ge=12, le=120)
    tax_rate: float = Field(0.0, ge=0, le=0.6, description="Optional extra deduction as a share of net income")
    expense_inflation: float = Field(0.008, ge=-0.05, le=0.2)
    income_growth: float = Field(0.008, ge=-0.1, le=0.2)
    investment_return: float = Field(0.03, ge=-0.5, le=0.5)
    cash_interest: float = Field(0.0, ge=0, le=0.2)
    property_appreciation: float = Field(0.0, ge=-0.2, le=0.2)
    imputed_rate: float = Field(0.05, ge=0, le=0.2)
    affordability_max_ratio: float = Field(1 / 3, gt=0, le=1)
    second_mortgage_ltv: float = Field(2 / 3, gt=0, le=1)
    amortization_years: int = Field(15, ge=1, le=40)


class Plan(Model):
    people: list[Person] = Field(min_length=2, max_length=2)
    shared: Shared = Shared()
    assumptions: Assumptions = Assumptions()

    @model_validator(mode="after")
    def _distinct(self) -> "Plan":
        partner_ids = {p.id for p in self.people}
        if len(partner_ids) != 2:
            raise ValueError("partners must be two distinct profiles")
        if len({child.id for child in self.shared.children}) != len(self.shared.children):
            raise ValueError("child ids must be unique")
        for child in self.shared.children:
            if child.allowance_recipient not in partner_ids:
                raise ValueError("child allowance recipient must be a partner")
            if {child.leave.birth_parent, child.leave.other_parent} != partner_ids:
                raise ValueError("leave must name two distinct partners")
        return self

    def person(self, pid: str) -> Person:
        for p in self.people:
            if p.id == pid:
                return p
        raise KeyError(pid)


# --------------------------------------------------------------------------- changes


class Change(Model):
    """A single validated modification to a plan, addressed by a dotted path.

    List elements are addressed by their ``id``/``key`` (e.g.
    ``people.P00809.categories.restaurants.budget_monthly``).
    """

    path: str
    value: object
    note: str | None = None


class DescribedChange(Model):
    path: str
    value: object
    previous: object
    label: str
    unit: str
    scope: str  # "shared" | "assumption" | <person id>
    owner_name: str | None = None
    delta_monthly_chf: float | None = None
    note: str | None = None
