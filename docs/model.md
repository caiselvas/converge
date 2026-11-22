# Converge financial model

All amounts are CHF. The time step is one calendar month, and flows are booked at month end. Rates are annual and converted to monthly consistently: interest uses `rate / 12` on the outstanding balance, and growth uses `(1 + r)^(t/12)`. The plan starts in **January 2027**, the month after the last ledger month, and runs for 72 months by default (configurable from 12 to 120).

## 1. Data → starting state

| Item | Source | Treatment |
|---|---|---|
| Profile (name, age, city, status) | `synthetic-profiles.csv` | As recorded; age shifted by +2 to the plan start |
| Transactions | `synthetic-transactions.zip` (read in-memory) | Aggregated per category |
| Opening cash | `synthetic-cash-balances.csv`, Dec 2026 closing | **Reconciled**: opening + Σ transactions = closing for every month (max error CHF 0.00 for both demo profiles; tested) |
| Net income | salary transactions | Trailing-12-month average. Bonuses are irregular and not extrapolated (optional toggle) |
| Spending categories | expense transactions | Fixed bills (rent, insurance, telecom, utilities, transport): trailing-12 average. Variable spending: 24-month average. Irregular categories (travel, unplanned, education) are kept as a labelled monthly *provision* rather than extrapolated from single events |
| Investments | `synthetic-assets.csv` | Single snapshot from 2025-01-01 with no transaction history. Grown at the assumed return; **not** counted as liquidity |
| Liabilities | `synthetic-liabilities.csv` | Snapshot. Treated as interest-only when the data has no payment (the demo profiles have none) |
| Goals | `synthetic-goals.csv` | Target amount by date |

The ledger contains **no tax payments**, so income tax is an explicit, editable assumption (default 13% of net income). This is a rough effective rate for a single taxpayer in Zurich at this income level, not a tax calculation. Unmarried partners are taxed individually.

## 2. Monthly transition (per partner *i*)

```
income_i   = usual_income_i · (1+g)^(t/12) · break_factor_i(t)     (+ bonus/12 if enabled)
tax_i      = τ · income_i
spending_i = (personal budgets + own-home budgets if not cohabiting) · (1+π)^(t/12)
household_i= share_i(t) · (shared rent* + utilities + groceries) · (1+π)^(t/12)  (+ moving cost once)
housing_i  = own_i · (mortgage_t · r_m/12 + value_t · m/12)        interest + maintenance (expenses)
amort_i    = own_i · min(mortgage_t, A)                              principal repayment (not an expense)
deposit_i  = own_i · d · price      (purchase month; cash → equity)
fees_i     = own_i · f · price      (purchase month; expense)
cash_i[t]  = cash_i[t-1] + income − tax − spending − household − housing − amort − loans − one-offs − deposit + cash interest
```

\* Shared rent stops once the home is owned.

- **Separate accounts.** Each partner has their own cash, investments and share of the property. Shared costs are paid from a joint account funded by transfers in the agreed split. Transfers out of personal accounts equal transfers into the joint account, so the joint balance is identically zero and the transfers **cancel at household level**. This is tested.
- **No double counting.** From the move-in month (or the purchase month, whichever comes first), each partner's own rent, utilities and groceries stop, and the household budget replaces them.
- **Property.** The deposit converts cash into equity: net worth changes only by the fees. Interest and maintenance are expenses. Amortisation reduces cash and debt equally. The second mortgage (above 2/3 of value) is amortised over 15 years. Ownership, deposit and running costs all follow `own_i`, so each partner's equity is `own_i · (value − mortgage)`.
- **Cost-sharing rules.** Equal, proportional to usual income, or custom. Optionally, contributions follow *actual* income during a career break, so the working partner covers more.
- **Career break.** Income is multiplied by `income_pct` for the break's months, with optional one-off costs in the first month. Overlapping breaks are rejected.
- **Net worth** = cash + investments + property share − mortgage share − loans. Liquidity (cash) is tracked separately.

## 3. Constraints and goals

| Constraint | Type | Rule |
|---|---|---|
| Safety buffer | **hard** | Each partner's cash ≥ their minimum in every month (default: 6 months of current spending, rounded up; editable) |
| Indicative affordability | **hard** | (mortgage · 5% + value · 1% + required amortisation) ≤ 1/3 of income. Gross income is not in the data, so Converge uses **net** income, which is stricter. Labelled as an indication, *not* a lender assessment |
| Minimum deposit | **schema** | ≥ 20% (Swiss lending practice) |
| Personal goals | soft | Funded in priority order (then by date), so the same franc never counts twice. "Emergency savings" is measured on cash, other goals on cash + investments |
| Home by target date | soft | The purchase month is ≤ the shared target |

Every violation reports the partner, the first and worst month, the shortfall, and its **drivers**: deposit, fees, income lost to a break (after tax), break costs, moving costs, mortgage interest and maintenance, amortisation.

**Future optionality** is reported as the *tightest runway*: at the worst month, how many months of recurring costs cash alone could cover.

## 4. Recommendations (no LLM involved)

1. **Levers** (all bounded, all on whitelisted plan paths): delay the purchase (1–24 months); lower the budget (5–25%); shift the deposit/ownership share towards the partner with headroom (5 pp steps, 20–80%); lower or raise the deposit (≥ 20%); change the household split; let the partner cover costs during a break; trim the stressed partner's flexible spending (10–40%); shorten, delay or partially pay a career break; postpone a missed soft goal (an explicit concession).
2. **Search.** All single-lever candidates, plus pairs combining the five gentlest levels of two different lever families. That is about 900 candidates, each **fully re-simulated** in about 1.4 seconds total.
3. **Feasibility.** A candidate is shown as feasible only if the simulator finds no hard violation and all accounting checks pass.
4. **Ranking.** Disruption points per unit of change (for example, 1 point per CHF 100/month of spending cuts, 1 per month of delay, 1 per 5 pp ownership shift, 2 per month of shortened break). New soft issues add +3, and each extra lever adds +1. Three transparent strategies re-weight these costs: *Keep your lifestyle*, *Stay on schedule*, and *Strongest safety net* (maximise the smaller relative cushion among low-disruption options).
5. **Diversity.** The selected options share no lever, so the alternatives are meaningfully different.
6. Each recommendation lists the exact old → new values, who must approve, the impact on each partner (cushion, runway, end cash and net worth, goals), the impact on the shared home, what it resolves or leaves open, and its trade-offs. If nothing works, the closest option and its remaining shortfall are reported.

## 5. Language model boundary

- **Interpret.** Claude (`claude-opus-5-5`, JSON-schema constrained output) maps text to `Change` objects drawn from the plan's lever catalogue. Each change is validated by the same schema as user edits, and invalid ones are dropped and reported. The model never sees or produces results.
- **Explain.** Claude summarises engine facts. Every number in the text must match a fact (allowing rounding). Otherwise the text is discarded and the engine's deterministic summary is shown, with a notice.
- **Without a key, or on an API error,** the rule-based parser and deterministic summaries are used, and they are labelled as such.

## 6. Assumptions and sources

Listed in-app (`···` → *Assumptions & sources*) and in `app/backend/converge/assumptions.py`:

- Inflation 0.8% (SNB, 24 Sep 2026); cash interest 0% (SNB policy rate 0%).
- Mortgage rate 1.8% illustrative (BWO average mortgage rate 1.31%, reference rate 1.25%).
- 20% minimum deposit, 5% imputed rate, 1% maintenance, one-third affordability rule, 15-year amortisation to 2/3 (UBS and Credit Suisse mortgage guides).
- Illustrative: tax rate 13%, income growth 0.8%, investment return 3%, purchase fees 1%, shared rent CHF 3,400, no property appreciation.

## 7. Limitations

- Synthetic data only. It is not representative of the Swiss population, and the relationship between the two profiles is assumed.
- Tax is a flat illustrative rate. There is no tax lag, wealth tax, pillar 2/3a, or tax effects of marriage or home ownership (imputed rental value).
- Deterministic single path, with no Monte Carlo. Sensitivity is explored through stress tests.
- Investment portfolios are a single snapshot with a constant assumed return, and are never sold to fund a deposit.
- The affordability check is an indication based on net income, not a lender decision.
- The recommendation search is bounded (single levers and pairs). Larger restructurings must be made by the user.
- Identity is simulated by switching between partners; there is no authentication.
- The live LLM path was verified for request shape and error fallback, but not run with a valid key in this environment.
