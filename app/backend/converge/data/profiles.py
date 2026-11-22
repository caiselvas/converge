"""Initialise personal financial twins from the UBS synthetic records."""
from __future__ import annotations

import math

from converge.data import ubs
from converge.models import Category, Goal, Liability, Person

# key -> (label, group, household, estimator)
#   estimator "t12": trailing-12-month average (fixed monthly bills; reflects current level)
#   estimator "mean": average over the full observed period (variable spending)
CATEGORY_META: dict[str, tuple[str, str, bool, str]] = {
    "housing_rent": ("Rent", "housing", True, "t12"),
    "utilities": ("Utilities", "housing", True, "t12"),
    "groceries": ("Groceries", "essential", True, "mean"),
    "health_insurance": ("Health insurance", "essential", False, "t12"),
    "telecom": ("Phone & internet", "essential", False, "t12"),
    "transport": ("Transport", "essential", False, "t12"),
    "pharmacy": ("Health & pharmacy", "essential", False, "mean"),
    "education": ("Education", "essential", False, "mean"),
    "restaurants": ("Restaurants", "flexible", False, "mean"),
    "leisure": ("Leisure", "flexible", False, "mean"),
    "retail": ("Shopping", "flexible", False, "mean"),
    "travel": ("Travel", "irregular", False, "mean"),
    "unexpected_expense": ("Unplanned costs", "irregular", False, "mean"),
}
CATEGORY_ORDER = list(CATEGORY_META)
FLEXIBLE_KEYS = [k for k, m in CATEGORY_META.items() if m[1] in ("flexible", "irregular") and k != "unexpected_expense"]

GOAL_MEASURE = {"Emergency savings": "cash"}

FLOOR_MONTHS = 6  # default emergency floor = 6 months of current personal spending (illustrative)


def _month_of(date_str: str) -> str:
    return str(date_str)[:7]


def build_person(profile_id: str) -> Person:
    rec = ubs.profile_record(profile_id)
    led = ubs.profile_ledger_summary(profile_id)

    salary_t12 = 0.0
    bonus_annual = 0.0
    categories: list[Category] = []
    stats = {c["category"]: c for c in led["categories"] if c["transaction_type"] == "expense"}
    for c in led["categories"]:
        if c["transaction_type"] == "income" and c["category"] == "salary_or_support":
            salary_t12 = c["trailing12_monthly_chf"]
        elif c["transaction_type"] == "income":
            bonus_annual += c["mean_monthly_chf"] * 12
    for key in CATEGORY_ORDER:
        label, group, household, est = CATEGORY_META[key]
        s = stats.get(key)
        if s is None:
            continue
        observed = -(s["trailing12_monthly_chf"] if est == "t12" else s["mean_monthly_chf"])
        observed = round(max(0.0, observed), 0)
        regular = s["months_present"] >= 0.75 * s["months_observed"]
        categories.append(
            Category(
                key=key,
                label=label,
                group=group,  # type: ignore[arg-type]
                observed_monthly=observed,
                budget_monthly=observed,
                household=household,
                regular=regular,
            )
        )
    # Unknown categories in the ledger are kept as "Other" rather than dropped.
    for key, s in stats.items():
        if key not in CATEGORY_META:
            observed = round(max(0.0, -s["mean_monthly_chf"]), 0)
            categories.append(Category(key=key, label=key.replace("_", " ").title(), group="essential",
                                       observed_monthly=observed, budget_monthly=observed, regular=False))

    spending = sum(c.budget_monthly for c in categories)
    floor = math.ceil(FLOOR_MONTHS * spending / 1000) * 1000

    invest = 0.0
    invest_date = ""
    for a in ubs.profile_assets(profile_id):
        if a["asset_type"] == "investment_portfolio":
            invest += float(a["value_chf"])
            invest_date = str(a["as_of_date"])

    liabilities = [
        Liability(
            id=str(l["liability_id"]),
            kind=str(l["liability_type"]),
            principal_chf=float(l["opening_principal_chf"]),
            annual_rate=float(l["annual_interest_rate"]),
            monthly_payment_chf=float(l["monthly_payment_chf"]),
            note=str(l.get("notes", "")),
        )
        for l in ubs.profile_liabilities(profile_id)
    ]

    goals = [
        Goal(
            id=str(g["goal_id"]),
            name=str(g["goal_name"]),
            target_chf=round(float(g["target_amount_chf"]), 0),
            target_date=_month_of(g["target_date"]),
            priority=str(g["priority"]),  # type: ignore[arg-type]
            measure=GOAL_MEASURE.get(str(g["goal_name"]), "liquid"),  # type: ignore[arg-type]
            source="dataset",
        )
        for g in ubs.profile_goals(profile_id)
    ]

    return Person(
        id=profile_id,
        name=str(rec["display_name"]),
        age=int(rec["age_at_start"]) + 2,  # profile age is as of 2025-01; plan starts 2027-01
        city=str(rec["city"]),
        employment_status=str(rec["employment_status"]),
        income_monthly=round(salary_t12, 0),
        income_observed_monthly=round(salary_t12, 0),
        bonus_observed_annual=round(bonus_annual, 0),
        opening_cash=led["closing_cash_chf"],
        opening_cash_date=led["closing_month"],
        investments=round(invest, 2),
        investments_as_of=invest_date,
        liabilities=liabilities,
        categories=categories,
        emergency_floor=floor,
        goals=goals,
    )


def provenance(profile_id: str) -> dict:
    """What we know about a profile, and where it came from."""
    rec = ubs.profile_record(profile_id)
    led = ubs.profile_ledger_summary(profile_id)
    return {
        "profile": {k: (v.item() if hasattr(v, "item") else v) for k, v in rec.items()},
        "ledger": led,
        "assets": ubs.profile_assets(profile_id),
        "liabilities": ubs.profile_liabilities(profile_id),
        "goals": ubs.profile_goals(profile_id),
        "life_events": ubs.profile_life_events(profile_id),
    }
