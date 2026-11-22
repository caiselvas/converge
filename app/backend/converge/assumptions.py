"""Explicit registry of assumptions and data sources.

``kind`` is one of: ``official`` (published by an authority/bank, cited),
``dataset`` (UBS synthetic challenge data), ``illustrative`` (a modelling
choice made by Converge, editable) or ``user`` (entered in the app).
"""
from __future__ import annotations

from converge.models import Plan

SOURCES = {
    "ubs_data": dict(name="UBS × LauzHack 2026 AI Financial Twin synthetic datasets", url=None, date="2026-11 (challenge release)"),
    "ubs_mortgage": dict(
        name="UBS — How much equity do you need to buy a house?",
        url="https://www.ubs.com/ch/en/services/guide/mortgages-and-financing/articles/how-much-equity-for-house-purchase.html",
        date="accessed 2026-11-22",
    ),
    "cs_affordability": dict(
        name="Credit Suisse — Everything you need to know about affordability calculation",
        url="https://credit-suisse.com/articles/private-banking/2023/03/en/alles-rund-um-die-tragbarkeit.html",
        date="2023-03, accessed 2026-11-22",
    ),
    "snb_sep2026": dict(
        name="SNB monetary policy assessment, 24 September 2026 (policy rate 0%, inflation 0.8%)",
        url="https://www.snb.ch/en/publications/communication/press-releases-restricted/pre_20260924",
        date="2026-09-24",
    ),
    "bwo_reference": dict(
        name="Federal Office for Housing (BWO) — mortgage reference rate 1.25%, average mortgage rate 1.31%",
        url="https://www.bwo.admin.ch/bwo/en/home/mietrecht/referenzzinssatz.html",
        date="published 2026-09-01",
    ),
}


def registry(plan: Plan) -> list[dict]:
    a = plan.assumptions
    pr = plan.shared.property
    hh = plan.shared.household
    rows = [
        dict(id="data", name="Starting balances, income and spending", value=None, unit=None, kind="dataset",
             source="ubs_data",
             note="Opening cash = Dec 2026 closing balance (reconciled to the ledger). Income and categories are "
                  "averages of 24 months of synthetic transactions (fixed bills: trailing 12 months)."),
        dict(id="investments", name="Investment portfolios", value=None, unit=None, kind="dataset", source="ubs_data",
             note="Snapshot dated 2025-01-01 (no investment transactions in the ledger); grown at the assumed return from Jan 2027."),
        dict(id="relationship", name="Nina and Emil as a couple", value=None, unit=None, kind="illustrative", source=None,
             note="Two unrelated synthetic profiles linked as a hypothetical couple for the demonstration."),
        dict(id="tax_rate", name="Optional extra deduction", value=a.tax_rate, unit="share of net income", kind="illustrative", source=None,
             note="Salary transactions reflect net pay. The default extra deduction is 0%. Set a positive rate to model "
                  "additional deductions from that pay."),
        dict(id="expense_inflation", name="Inflation (applied to spending and rent)", value=a.expense_inflation, unit="per year",
             kind="official", source="snb_sep2026", note="Latest observed CPI inflation reported by the SNB, held constant."),
        dict(id="income_growth", name="Income growth", value=a.income_growth, unit="per year", kind="illustrative", source=None,
             note="Set equal to inflation (flat real income)."),
        dict(id="investment_return", name="Investment return", value=a.investment_return, unit="per year", kind="illustrative",
             source=None, note="Constant nominal return; real returns are uncertain and can be negative."),
        dict(id="cash_interest", name="Interest on cash", value=a.cash_interest, unit="per year", kind="official",
             source="snb_sep2026", note="SNB policy rate is 0%; savings-account interest assumed negligible."),
        dict(id="floor", name="Minimum safety buffer", value=None, unit="CHF", kind="illustrative", source=None,
             note="Default: 6 months of each partner's current spending (rounded up to CHF 1,000). Editable per partner; hard constraint."),
        dict(id="goals", name="Personal goals", value=None, unit="CHF by date", kind="dataset", source="ubs_data",
             note="From synthetic-goals.csv. Funded in priority order so money is not counted twice. "
                  "'Emergency savings' is measured on cash; other goals on cash + investments."),
        dict(id="shared_rent", name="Shared rent before buying", value=hh.rent, unit="CHF/month", kind="illustrative",
             source=None, note="Illustrative rent for a larger shared flat in Zurich; replaces both partners' current rents."),
        dict(id="shared_groceries", name="Shared groceries", value=hh.groceries, unit="CHF/month", kind="derived", source="ubs_data",
             note="Sum of both partners' observed grocery spending (no economies of scale assumed)."),
        dict(id="mortgage_rate", name="Mortgage interest rate", value=pr.mortgage_rate, unit="per year", kind="illustrative",
             source="bwo_reference", note="Illustrative fixed rate for a new mortgage, above the 1.31% average on existing mortgages."),
        dict(id="deposit", name="Minimum deposit", value=0.20, unit="share of price", kind="official", source="ubs_mortgage",
             note="Swiss lending practice: at least 20% equity, of which at least 10% not from pension assets."),
        dict(id="imputed_rate", name="Imputed interest for affordability", value=a.imputed_rate, unit="per year", kind="official",
             source="cs_affordability", note="Banks test affordability at a notional ~5% rate, not the actual rate."),
        dict(id="maintenance", name="Maintenance and ancillary costs", value=pr.maintenance_pct, unit="of value per year",
             kind="official", source="cs_affordability", note="1% of property value per year (flat rate used by lenders)."),
        dict(id="affordability", name="Affordability limit", value=a.affordability_max_ratio, unit="of usual net income", kind="illustrative",
             source="cs_affordability",
             note="The lender benchmark uses gross income. Converge applies the threshold to combined usual net pay "
                  "before career breaks and any optional extra deduction. The result is indicative."),
        dict(id="amortization", name="Amortisation", value=a.amortization_years, unit="years", kind="official", source="ubs_mortgage",
             note="Second mortgage (above 2/3 of value) repaid within 15 years; modelled as direct monthly amortisation."),
        dict(id="fees", name="Purchase fees", value=pr.fees_pct, unit="of price", kind="illustrative", source=None,
             note="Notary, land-registry and mortgage-note fees (Zurich has no property transfer tax)."),
        dict(id="appreciation", name="Property value growth", value=a.property_appreciation, unit="per year", kind="illustrative",
             source=None, note="No appreciation assumed (conservative)."),
    ]
    for r in rows:
        r["source_detail"] = SOURCES.get(r["source"]) if r.get("source") else None
    return rows
