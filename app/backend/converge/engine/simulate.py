"""Deterministic monthly simulation of two linked personal financial twins.

Accounting model (all CHF, monthly time step, flows booked at month end):

* Each partner has their own cash account, investment portfolio and share of
  any jointly owned property. There is no undifferentiated household balance.
* Shared household costs (rent, utilities, groceries, moving) are paid from a
  joint account that is funded by transfers from both partners in the agreed
  split. Transfers out of personal accounts equal transfers into the joint
  account, so the joint balance is identically zero and the transfers cancel
  at household level.
* A property purchase converts cash (deposit) into property equity. Purchase
  fees are an expense. Mortgage interest and maintenance are expenses;
  amortisation reduces both cash and mortgage debt (net-worth neutral).
* Partners' own rent/utilities/groceries stop once they live together, so
  housing costs are never double counted.

cash[t] = cash[t-1] + income - tax - spending - household_transfer - housing
          - amortisation - loan_payment - one_offs - deposit + cash_interest
"""
from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass, field

from converge.engine import months as M
from converge.models import (
    BIRTH_LEAVE_DAYS, CHILD_ALLOWANCE_BASE, CHILD_ALLOWANCE_OLDER, KITA_INFANT_TARIFF,
    KITA_OLDER_TARIFF, LEAVE_DAILY_CAP, LEAVE_REPLACEMENT, OTHER_PARENT_LEAVE_DAYS, Plan,
)

FLOW_KEYS = (
    "income",
    "tax",
    "spending",
    "household",
    "housing",
    "amortization",
    "loan_payment",
    "one_off",
    "deposit",
    "interest_income",
)


@dataclass
class PersonSeries:
    pid: str
    name: str
    floor: float
    income: list[float] = field(default_factory=list)
    usual_income: list[float] = field(default_factory=list)
    family_allowance: list[float] = field(default_factory=list)
    career_break_loss: list[float] = field(default_factory=list)
    parental_leave_loss: list[float] = field(default_factory=list)
    everyday_child_costs: list[float] = field(default_factory=list)
    childcare: list[float] = field(default_factory=list)
    tax: list[float] = field(default_factory=list)
    spending: list[float] = field(default_factory=list)
    household: list[float] = field(default_factory=list)
    housing: list[float] = field(default_factory=list)
    amortization: list[float] = field(default_factory=list)
    loan_payment: list[float] = field(default_factory=list)
    one_off: list[float] = field(default_factory=list)
    deposit: list[float] = field(default_factory=list)
    interest_income: list[float] = field(default_factory=list)
    net_flow: list[float] = field(default_factory=list)
    cash_open: list[float] = field(default_factory=list)
    cash: list[float] = field(default_factory=list)
    investments: list[float] = field(default_factory=list)
    investment_sale: list[float] = field(default_factory=list)
    pension: list[float] = field(default_factory=list)
    property_value: list[float] = field(default_factory=list)
    mortgage: list[float] = field(default_factory=list)
    loans: list[float] = field(default_factory=list)
    net_worth: list[float] = field(default_factory=list)
    outgoings: list[float] = field(default_factory=list)  # recurring outflows used for runway
    household_share: list[float] = field(default_factory=list)
    one_off_items: list[tuple[int, str, float]] = field(default_factory=list)

    def liquid(self, t: int) -> float:
        return self.cash[t] + self.investments[t]


@dataclass
class ChildMonth:
    everyday: float = 0.0
    childcare: float = 0.0
    allowance: float = 0.0


@dataclass
class SimResult:
    plan: Plan
    months: list[str]
    people: list[PersonSeries]
    joint_balance: list[float]
    joint_in: list[float]
    joint_out: list[float]
    property_value: list[float]
    mortgage: list[float]
    purchase_index: int | None
    move_in_index: int | None
    affordability: dict | None
    child_costs: dict[str, list[ChildMonth]]
    checks: dict
    investment_factors: list[float] | None = None


def household_share_first(plan: Plan, inc_first: float, inc_second: float) -> float:
    sp = plan.shared.split
    if sp.mode == "equal":
        return 0.5
    if sp.mode == "custom":
        return sp.custom_share_first
    total = inc_first + inc_second
    return 0.5 if total <= 0 else inc_first / total


def _child_flows(plan: Plan, months: list[str]) -> tuple[dict[str, list[ChildMonth]], list[dict[int, tuple[float, float]]]]:
    """Return per-child costs and per-parent monthly leave fractions and benefits."""
    a = plan.assumptions
    days = [monthrange(int(month[:4]), int(month[5:]))[1] for month in months]
    positions = {p.id: i for i, p in enumerate(plan.people)}
    costs = {}
    leave_rates: list[dict[int, dict[int, float]]] = [{}, {}]
    for child in plan.shared.children:
        birth = M.index(child.birth, a.start)
        series = [ChildMonth() for _ in months]
        costs[child.id] = series
        for t in range(max(0, birth), len(months)):
            age = t - birth
            inflation = (1 + a.expense_inflation) ** (t / 12)
            childcare = 0.0
            if child.childcare_start_months_after_birth <= age < child.childcare_until_age * 12:
                tariff = child.childcare_day_tariff
                if tariff is None:
                    tariff = KITA_INFANT_TARIFF if age < 18 else KITA_OLDER_TARIFF
                childcare = child.childcare_days_per_week * 4.2 * tariff * inflation
            allowance = CHILD_ALLOWANCE_BASE if age <= 144 else CHILD_ALLOWANCE_OLDER if age <= 192 else 0.0
            series[t] = ChildMonth(child.everyday_cost_monthly * inflation, childcare, allowance)
        if birth >= len(months):
            continue
        for parent, available in (
            (child.leave.birth_parent, BIRTH_LEAVE_DAYS), (child.leave.other_parent, OTHER_PARENT_LEAVE_DAYS),
        ):
            i = positions[parent]
            salary = plan.people[i].usual_net_income(months[max(0, birth)], a.start, a.income_growth)
            rate = min(LEAVE_DAILY_CAP, LEAVE_REPLACEMENT * salary / 30)
            t = birth
            while available > 0 and t < len(months):
                month = M.add(a.start, t)
                length = days[t] if t >= 0 else monthrange(int(month[:4]), int(month[5:]))[1]
                taken = min(available, length)
                if t >= 0:
                    paid_days = leave_rates[i].setdefault(t, {})
                    for day in range(taken):
                        paid_days[day] = max(rate, paid_days.get(day, 0.0))
                available -= taken
                t += 1
    leave = [{t: (len(paid) / days[t], sum(paid.values())) for t, paid in rates.items()} for rates in leave_rates]
    return costs, leave


def simulate(plan: Plan, *, investment_factors: list[float] | None = None) -> SimResult:
    a = plan.assumptions
    H = a.horizon_months
    start = a.start
    months = [M.add(start, t) for t in range(H)]
    hh = plan.shared.household
    pr = plan.shared.property
    child_costs, leave = _child_flows(plan, months) if plan.shared.children else ({}, [{}, {}])
    child_recipients = [(child_costs[c.id], c.allowance_recipient) for c in plan.shared.children]

    purchase_idx = M.index(pr.purchase, start) if pr.enabled else None
    if purchase_idx is not None and not (0 <= purchase_idx < H):
        purchase_idx = None if purchase_idx >= H else 0
    move_idx = M.index(hh.move_in, start) if hh.enabled else None
    if move_idx is not None:
        move_idx = max(0, move_idx)
        if move_idx >= H:
            move_idx = None
    # Buying a home together implies living together from the purchase date.
    cohabit_idx = move_idx
    if purchase_idx is not None:
        cohabit_idx = purchase_idx if cohabit_idx is None else min(cohabit_idx, purchase_idx)

    own = [pr.ownership_share_first, 1.0 - pr.ownership_share_first]

    # Pre-compile per-person inputs.
    comp = []
    for p in plan.people:
        hh_keys = {c.key for c in p.categories if c.household}
        personal_budget = sum(c.budget_monthly for c in p.categories if not c.household)
        own_home_budget = sum(c.budget_monthly for c in p.categories if c.household)
        breaks = []
        for b in p.career_breaks:
            bi = M.index(b.start, start)
            breaks.append((bi, bi + b.months, b))
        sales: dict[int, float] = {}
        for sale in p.sell_investments:
            t = M.index(sale.month, start)
            sales[t] = sales.get(t, 0.0) + sale.amount
        comp.append(
            dict(
                personal_budget=personal_budget,
                own_home_budget=own_home_budget,
                hh_keys=hh_keys,
                breaks=breaks,
                sales=sales,
                bonus=(p.bonus_observed_annual / 12.0) if p.include_bonus else 0.0,
                loans=[[l.principal_chf, l.annual_rate, l.monthly_payment_chf] for l in p.liabilities],
            )
        )

    series = [PersonSeries(pid=p.id, name=p.name, floor=p.emergency_floor) for p in plan.people]
    cash = [p.opening_cash for p in plan.people]
    inv = [p.investments for p in plan.people]
    pensions = [p.pension_opening_chf for p in plan.people]

    prop_val = 0.0
    mort = 0.0
    amort_monthly = 0.0
    inv_growth = (1 + a.investment_return) ** (1 / 12) if a.investment_return > -1 else 0.0
    prop_growth = (1 + a.property_appreciation) ** (1 / 12)
    joint_bal = 0.0
    joint_balance, joint_in, joint_out, pv_series, mort_series = [], [], [], [], []
    affordability = None

    for t in range(H):
        infl = (1 + a.expense_inflation) ** (t / 12)
        cohabit = cohabit_idx is not None and t >= cohabit_idx
        owned = purchase_idx is not None and t >= purchase_idx

        # --- incomes
        usual = [p.usual_net_income(months[t], a.start, a.income_growth) for p in plan.people]
        actual = []
        allowance = [0.0, 0.0]
        everyday = childcare = 0.0
        for costs, recipient in child_recipients:
            cost = costs[t]
            everyday += cost.everyday
            childcare += cost.childcare
            allowance[0 if recipient == plan.people[0].id else 1] += cost.allowance
        on_break = False
        break_one_off = [0.0, 0.0]
        break_factors = [1.0, 1.0]
        for i, c in enumerate(comp):
            factor = 1.0
            for bs, be, career_break in c["breaks"]:
                if bs <= t < be:
                    factor = min(factor, career_break.income_pct / 100)
                    if (t - bs) % 6 == 0 and career_break.semester_fee_chf:
                        fee = career_break.semester_fee_chf
                        break_one_off[i] += fee
                        series[i].one_off_items.append((t, f"{career_break.label} semester fees", fee))
                if t == bs and career_break.one_off_cost_chf:
                    cost = career_break.one_off_cost_chf
                    break_one_off[i] += cost
                    series[i].one_off_items.append((t, f"{career_break.label} costs", cost))
            salary = usual[i] * factor
            break_factors[i] = factor
            fraction, benefit = leave[i].get(t, (0.0, 0.0))
            earnings = salary * (1 - fraction) + benefit
            actual.append(earnings + c["bonus"] + allowance[i])
            series[i].career_break_loss.append(usual[i] - salary)
            series[i].parental_leave_loss.append(salary - earnings)
            series[i].family_allowance.append(allowance[i])
            on_break = on_break or earnings < usual[i] - 1e-9

        # --- household split
        s1 = household_share_first(plan, usual[0], usual[1])
        if plan.shared.split.adjust_for_breaks and on_break:
            # While a partner is on a career break, contributions follow actual income.
            tot = actual[0] + actual[1]
            if tot > 0:
                s1 += plan.shared.split.break_support_share * (actual[0] / tot - s1)
        shares = [s1, 1.0 - s1]

        # --- shared household costs (via joint account)
        hh_cost = 0.0
        moving = 0.0
        if cohabit:
            hh_cost = (hh.utilities + hh.groceries + (0.0 if owned else hh.rent)) * infl
            if t == cohabit_idx and hh.enabled:
                moving = hh.moving_cost
        hh_cost += everyday + childcare

        # --- property
        purchase_now = owned and t == purchase_idx
        prop_interest = prop_maint = amort = 0.0
        deposit_total = fees_total = 0.0
        if purchase_now:
            prop_val = pr.price
            deposit_total = pr.deposit_pct * pr.price
            fees_total = pr.fees_pct * pr.price
            mort = pr.price - deposit_total
            second = max(0.0, mort - a.second_mortgage_ltv * pr.price)
            amort_monthly = second / (a.amortization_years * 12) if pr.amortize else 0.0
            # The indicative check uses normal combined ledger net income before
            # career breaks and any optional extra deduction.
            annual_income = sum(usual) * 12
            imputed = mort * a.imputed_rate
            maint_aff = pr.price * 0.01
            amort_aff = second / a.amortization_years
            cost = imputed + maint_aff + amort_aff
            affordability = dict(
                month=months[t],
                annual_net_income=round(annual_income, 2),
                imputed_interest=round(imputed, 2),
                maintenance=round(maint_aff, 2),
                amortization=round(amort_aff, 2),
                annual_cost=round(cost, 2),
                ratio=round(cost / annual_income, 4) if annual_income > 0 else None,
                max_ratio=round(a.affordability_max_ratio, 4),
                max_price=None,
                passes=bool(annual_income > 0 and cost / annual_income <= a.affordability_max_ratio + 1e-9),
            )
            # Highest price passing the test with the same deposit share (closed form).
            d = pr.deposit_pct
            per_chf = (1 - d) * a.imputed_rate + 0.01 + max(0.0, (1 - d) - a.second_mortgage_ltv) / a.amortization_years
            affordability["max_price"] = round(a.affordability_max_ratio * annual_income / per_chf, -3) if per_chf > 0 else None
        elif owned:
            prop_val *= prop_growth
        if owned and not purchase_now:
            prop_interest = mort * pr.mortgage_rate / 12
            prop_maint = prop_val * pr.maintenance_pct / 12
            amort = min(mort, amort_monthly)
        elif purchase_now:
            pass  # running costs start the month after completion

        transfers = [0.0, 0.0]
        for i, p in enumerate(plan.people):
            s = series[i]
            c = comp[i]
            s.cash_open.append(cash[i])
            income = actual[i]
            tax = a.tax_rate * (income - allowance[i]) + p.income_tax_monthly
            spending = c["personal_budget"] * infl + (0.0 if cohabit else c["own_home_budget"] * infl)
            household = shares[i] * (hh_cost + moving)
            transfers[i] = household
            housing = own[i] * (prop_interest + prop_maint)
            amortization = own[i] * amort
            # Personal loans: interest-only when no payment is given in the data.
            loan_payment = 0.0
            for loan in c["loans"]:
                principal, rate, pay = loan
                if principal <= 0:
                    continue
                interest = principal * rate / 12
                payment = interest if pay <= 0 else min(pay, principal + interest)
                loan[0] = principal - (payment - interest)
                loan_payment += payment
            one_off = break_one_off[i] + own[i] * fees_total
            deposit = own[i] * deposit_total
            interest_income = max(cash[i], 0.0) * a.cash_interest / 12
            inv[i] *= inv_growth if investment_factors is None else investment_factors[t]
            sale = min(inv[i], c["sales"].get(t, 0.0))
            inv[i] -= sale
            net = (
                income - tax - spending - household - housing - amortization - loan_payment - one_off - deposit
                + interest_income + sale
            )
            cash[i] += net
            s.investment_sale.append(sale)
            pensions[i] += p.pension_credit_monthly * break_factors[i]
            if purchase_now and own[i] > 0:
                s.one_off_items.append((t, "Home deposit", deposit))
                if fees_total:
                    s.one_off_items.append((t, "Purchase fees", own[i] * fees_total))
            if moving and shares[i] > 0:
                s.one_off_items.append((t, "Moving costs", shares[i] * moving))

            s.income.append(income)
            s.usual_income.append(usual[i] + c["bonus"])
            s.tax.append(tax)
            s.spending.append(spending)
            s.household.append(household)
            s.everyday_child_costs.append(shares[i] * everyday)
            s.childcare.append(shares[i] * childcare)
            s.housing.append(housing)
            s.amortization.append(amortization)
            s.loan_payment.append(loan_payment)
            s.one_off.append(one_off)
            s.deposit.append(deposit)
            s.interest_income.append(interest_income)
            s.net_flow.append(net)
            s.cash.append(cash[i])
            s.investments.append(inv[i])
            s.pension.append(pensions[i])
            loans_total = sum(max(0.0, l[0]) for l in c["loans"])
            s.loans.append(loans_total)
            s.household_share.append(shares[i])
            # Mortgage after this month's amortisation.
            s.outgoings.append(tax + spending + shares[i] * hh_cost + housing + amortization + loan_payment)

        mort -= amort
        joint_bal += sum(transfers) - (hh_cost + moving)
        joint_balance.append(joint_bal)
        joint_in.append(sum(transfers))
        joint_out.append(hh_cost + moving)
        pv_series.append(prop_val if owned else 0.0)
        mort_series.append(mort if owned else 0.0)
        for i in range(2):
            s = series[i]
            s.property_value.append(own[i] * pv_series[-1])
            s.mortgage.append(own[i] * mort_series[-1])
            s.net_worth.append(s.cash[-1] + s.investments[-1] + s.pension[-1] + s.property_value[-1] - s.mortgage[-1] - s.loans[-1])

    res = SimResult(
        plan=plan,
        months=months,
        people=series,
        joint_balance=joint_balance,
        joint_in=joint_in,
        joint_out=joint_out,
        property_value=pv_series,
        mortgage=mort_series,
        purchase_index=purchase_idx,
        move_in_index=cohabit_idx,
        affordability=affordability,
        child_costs=child_costs,
        checks={},
        investment_factors=investment_factors,
    )
    res.checks = verify(res)
    return res


def verify(res: SimResult) -> dict:
    """Accounting identities. All errors should be ~0 (floating point)."""
    cash_err = 0.0
    flow_err = 0.0
    nw_err = 0.0
    inv_err = 0.0
    growth = (1 + res.plan.assumptions.investment_return) ** (1 / 12)
    for s, person in zip(res.people, res.plan.people):
        prev = s.cash_open[0]
        balance = person.investments
        for t in range(len(res.months)):
            inflow = s.income[t] + s.interest_income[t] + s.investment_sale[t]
            outflow = (
                s.tax[t] + s.spending[t] + s.household[t] + s.housing[t] + s.amortization[t]
                + s.loan_payment[t] + s.one_off[t] + s.deposit[t]
            )
            flow_err = max(flow_err, abs((inflow - outflow) - s.net_flow[t]))
            cash_err = max(cash_err, abs(prev + s.net_flow[t] - s.cash[t]))
            nw = s.cash[t] + s.investments[t] + s.pension[t] + s.property_value[t] - s.mortgage[t] - s.loans[t]
            nw_err = max(nw_err, abs(nw - s.net_worth[t]))
            prev = s.cash[t]
            factor = growth if res.investment_factors is None else res.investment_factors[t]
            inv_err = max(inv_err, abs(balance * factor - s.investment_sale[t] - s.investments[t]))
            balance = s.investments[t]
    transfer_err = max((abs(x) for x in res.joint_balance), default=0.0)
    transfer_err = max(transfer_err, max((abs(i - o) for i, o in zip(res.joint_in, res.joint_out)), default=0.0))
    prop_err = 0.0
    for t in range(len(res.months)):
        prop_err = max(prop_err, abs(sum(s.property_value[t] for s in res.people) - res.property_value[t]))
        prop_err = max(prop_err, abs(sum(s.mortgage[t] for s in res.people) - res.mortgage[t]))
    tol = 1e-6
    return dict(
        cash_identity_max_error=cash_err,
        flow_sum_max_error=flow_err,
        net_worth_identity_max_error=nw_err,
        investment_identity_max_error=inv_err,
        transfers_cancel_max_error=transfer_err,
        ownership_split_max_error=prop_err,
        mortgage_non_negative=all(m >= -tol for m in res.mortgage),
        ok=max(cash_err, flow_err, nw_err, inv_err, transfer_err, prop_err) < tol * 1000,
    )
