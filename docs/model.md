# Converge financial model

All amounts are CHF. The time step is one calendar month, and flows are booked at month end. Rates are annual and converted to monthly consistently: interest uses `rate / 12` on the outstanding balance, and growth uses `(1 + r)^(t/12)`. The plan starts in **January 2027**, the month after the last ledger month, and runs for 120 months by default (configurable from 12 to 120).

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

Salary transactions are treated as **net pay** because they closely match the UBS profile field `reference_monthly_net_income_chf`. The optional extra deduction defaults to 0% and can be set to model an additional outflow proportional to net pay.

## 2. Monthly transition (per partner *i*)

```
income_i   = usual_income_i · (1+g)^(t/12) · break_factor_i(t)     (+ bonus/12 if enabled)
deduct_i   = τ · income_i                                         optional extra deduction (default 0%)
spending_i = (personal budgets + own-home budgets if not cohabiting) · (1+π)^(t/12)
household_i= share_i(t) · (shared rent* + utilities + groceries) · (1+π)^(t/12)  (+ moving cost once)
housing_i  = own_i · (mortgage_t · r_m/12 + value_t · m/12)        interest + maintenance (expenses)
amort_i    = own_i · min(mortgage_t, A)                              principal repayment (not an expense)
deposit_i  = own_i · d · price      (purchase month; cash → equity)
fees_i     = own_i · f · price      (purchase month; expense)
cash_i[t]  = cash_i[t-1] + income − deduct − spending − household − housing − amort − loans − one-offs − deposit + cash interest
```

\* Shared rent stops once the home is owned.

- **Investment sales.** `people.{pid}.sell_investments` accepts a list of `{month, amount}` requests in CHF. Apply investment growth for the month, then transfer the requested amount from investments to cash, capped at the available portfolio. Sales are cash inflows and do not change net worth at the time of sale. Investment gains from the sold balance stop accruing. Taxes and transaction costs are omitted.
- **Separate accounts.** Each partner has their own cash, investments and share of the property. Shared costs are paid from a joint account funded by transfers in the agreed split. Transfers out of personal accounts equal transfers into the joint account, so the joint balance is identically zero and the transfers **cancel at household level**. This is tested.
- **No double counting.** From the move-in month (or the purchase month, whichever comes first), each partner's own rent, utilities and groceries stop, and the household budget replaces them.
- **Property.** The deposit converts cash into equity: net worth changes only by the fees. Interest and maintenance are expenses. Amortisation reduces cash and debt equally. The second mortgage (above 2/3 of value) is amortised over 15 years. Ownership, deposit and running costs all follow `own_i`, so each partner's equity is `own_i · (value − mortgage)`.
- **Cost-sharing rules.** Equal, proportional to usual income, or custom. Optionally, contributions follow *actual* income during a career break, so the working partner covers more.
- **Career break.** Income is multiplied by `income_pct` for the break's months, with optional one-off costs in the first month. Overlapping breaks are rejected.
- **Net worth** = cash + investments + property share − mortgage share − loans. Liquidity (cash) is tracked separately.

### Planning for a child

- A shared plan can contain up to three children. Both partners approve changes. Everyday costs start in the birth month and go through the joint account with childcare, even if the partners live separately. The editable everyday budget starts at CHF 700 per month, including health insurance. Zurich discontinued its child-cost table in 2026. [Canton of Zurich notice](https://www.zh.ch/de/familie/eltern-in-trennung/unterhalt-elterliche-sorge/kinderkosten-tabelle.html)
- Kita costs equal days per week × 4.2 × day tariff. The default is two days a week starting four months after birth and ending before the fourth birthday month. The default day tariff is CHF 138 before age 18 months and CHF 120 from that month. A custom tariff applies at every age. The engine uses the unindexed report figures as plan-start inputs and applies the plan's expense inflation to both childcare and everyday costs. [Canton of Zurich childcare report, Table 9](https://www.zh.ch/content/dam/zhweb/bilder-dokumente/themen/bildung/bildungssystem/studien/20201201_kinderbetreuungsbericht.pdf#page=63)
- One Zurich child allowance goes to the selected partner from the birth month. It pays CHF 215 through the 12th birthday month, then CHF 268 through the 16th birthday month. The model holds these nominal rates fixed. Zurich has no lump-sum birth allowance. [Zurich rates](https://www.zh.ch/de/soziales/sozialhilfe/sozialhilfehandbuch/flexdata-definition/11-weitere-leistungen-soziale-sicherheit/11-1-sozialversicherungsleistungen/11-1-13-ueberblick-ueber-die-familienzulagen.html) · [Federal entitlement rules](https://www.bsv.admin.ch/de/familienzulagen-leistungen-und-voraussetzungen) · [Federal cantonal comparison](https://www.bsv.admin.ch/de/zulagen-fuer-familien)
- The engine places birth leave (98 calendar days) and other-parent leave (14 daily allowances) consecutively from the first day of the birth month for each parent. It replaces the fraction of that month's salary corresponding to the actual calendar days on leave with the daily benefit. The benefit is 80% of projected usual monthly net salary in the birth month divided by 30, capped at CHF 220 per day. Net salary proxies for the statutory earnings base. Where leave overlaps a career break, the benefit replaces that period's planned salary. Each parent receives at most one benefit per day for overlapping child scenarios. Longer breaks use the career-break lever. [AHV/EO maternity allowance](https://www.ahv-iv.ch/p/6.02.e) · [AHV/EO other-parent allowance](https://www.ahv-iv.ch/p/6.04.e)
- The monthly net child cost is everyday spending plus Kita spending less the child allowance. The cash projection also includes any change in earnings during parental leave. The **Parental leave income** driver shows the reduction in earnings attributable to leave.

## 3. Constraints and goals

| Constraint | Type | Rule |
|---|---|---|
| Safety buffer | **hard** | Each partner's cash ≥ their minimum in every month (default: 6 months of current spending, rounded up; editable) |
| Indicative affordability | **hard** | Annual costs (mortgage · 5% + value · 1% + required amortisation) must fit within one third of combined usual annual **net** income, before career breaks or any optional extra deduction. The lender benchmark uses gross income |
| Minimum deposit | **schema** | ≥ 20% (Swiss lending practice) |
| Personal goals | soft | Funded in priority order (then by date), so the same franc never counts twice. "Emergency savings" is measured on cash, other goals on cash + investments |
| Home by target date | soft | The purchase month is ≤ the shared target |

Every violation reports the partner, the first and worst month, the shortfall, and its **drivers**: deposit, fees, income lost to a break (after any optional extra deduction), break costs, moving costs, mortgage interest and maintenance, amortisation.

**Future optionality** is reported as the *tightest runway*: at the worst month, how many months of recurring costs cash alone could cover.

## 4. Recommendations (no LLM involved)

1. **Levers** (all bounded, all on whitelisted plan paths): delay the purchase (1–24 months); lower the budget (5–25%); shift the deposit/ownership share towards the partner with headroom (5 pp steps, 20–80%); lower or raise the deposit (≥ 20%); change the household split; let the partner cover costs during a break; trim the stressed partner's flexible spending (10–40%); shorten, delay or partially pay a career break; sell part of the investments in the first cash-breach month; postpone a missed soft goal (an explicit concession).
2. **Search.** All single-lever candidates, plus pairs combining the five gentlest levels of two different lever families. The planner tries the two gentlest levels per family in pairs. Every candidate is fully re-simulated.
3. **Feasibility.** A candidate is shown as feasible only if the simulator finds no hard violation and all accounting checks pass.
4. **Ranking.** Disruption points per unit of change (for example, 1 point per CHF 100/month of spending cuts, 1 per month of delay, 1 per 5 pp ownership shift, 2 per month of shortened break). New soft issues add +3, and each extra lever adds +1. Three transparent strategies re-weight these costs: *Keep your lifestyle*, *Stay on schedule*, and *Strongest safety net* (maximise the smaller relative cushion among low-disruption options).
5. **Diversity.** The planner shows at most one option per ranking strategy and at most one per primary lever family. It favours single-family options.
6. Each recommendation lists the exact old → new values, who must approve, the impact on each partner (cushion, runway, end cash and net worth, goals), the impact on the shared home, what it resolves or leaves open, and its trade-offs. If nothing works, the closest option and its remaining shortfall are reported.

## 5. Life-decision planner

Goals offers guided planners for moving in, buying a home, having a child and taking a career break. Each is a module in `app/backend/converge/decisions.py` that declares:

- its questions (kind, bounds, options), each tied to a whitelisted lever path or to a small compile step;
- how a question is prefilled: an answer given in the planner, otherwise the **agreed plan** when that part of the plan already exists (and is then not asked again), otherwise a labelled suggestion or default;
- how the answers compile into `Change` objects. Only changes that differ from the agreed plan are kept, and the whole set is validated with `apply_changes` before it can be simulated or proposed.

| Decision | Plan fields |
|---|---|
| Move in together | `shared.household.*` (enabled, move-in, rent, utilities, groceries, moving costs), `shared.split.*` |
| Buy a home | `shared.property.*` (price, purchase, target date, deposit, ownership share, mortgage rate, fees, amortisation), plus living together from the purchase month or earlier, and the split |
| Have a child | `shared.children` (birth, birth parent, Kita days, start and end, everyday costs, allowance recipient), `shared.split.adjust_for_breaks`, and optional extra time off as a career break (`cb-<child id>`) starting after the statutory leave |
| Take a career break | `people.{pid}.career_breaks` (start, months, net pay kept, one-off costs). A partner can keep the usual split, use actual income shares during the break, or move halfway toward those shares with `shared.split.break_support_share`. |

**Preferences.** Each partner enters their own answers. A firm date rules out moves to that date. Willingness to wait, work part-time, trim spending or lower the budget halves the matching disruption cost. A lifestyle priority raises the cost of spending trims, and a safety priority favours more buffer headroom. Each option states what it respects and what it asks from the partners. An agreed home's recorded date and budget preferences inform later planners involving that home.

**Comparison and approval.** `/api/decisions/{id}/compare` simulates the brief and up to three options. It reports each partner's cash low, home timing, delayed goals and household net worth. Robustness starts from each unstressed option and bisects one shock at a time using the hard checks. The mortgage search stops at 10% or the base rate if already higher. The income search stops at a 50% cut in both partners' usual pay. Displayed passing limits are rounded down to a tenth of a percentage point. A stress overlay rechecks the displayed options and stays outside the proposed changes. The career-break planner needs both partners' approval, including when the chosen change only touches one personal plan.

**State.** Answers live in a per-decision session in `workspace.json`, separate from the agreed plan and personal drafts. Choosing an option updates the brief and creates a `decision` proposal. A newer proposal supersedes a pending earlier one. Ask opens the matching planner and uses the same intake path to prefill recognised changes.

**Language model role.** With a key, the model reads free-text answers and phrases the next open question (`/api/decisions/{id}/step`). It returns structured answers that are validated exactly like form input; preference answers are accepted only for the viewer; question wording that introduces numbers not in its context is discarded. It sees questions and answers, never simulation results. Without a key (or on an error), the built-in parser reads the focused question only and questions follow a fixed order, labelled as such.

**Not in this version:** probability estimates for stress, more than one child per planner session (the planner edits the earliest child), and other decision types.

## 6. Language model boundary

- **Interpret.** Claude (`claude-opus-5-5`, JSON-schema constrained output) maps text to `Change` objects drawn from the plan's lever catalogue. Each change is validated by the same schema as user edits, and invalid ones are dropped and reported. The model never sees or produces results.
- **Explain.** Claude summarises engine facts. Every number in the text must match a fact (allowing rounding). Otherwise the text is discarded and the engine's deterministic summary is shown, with a notice.
- **Without a key, or on an API error,** the rule-based parser and deterministic summaries are used, and they are labelled as such.

## 7. Assumptions and sources

Listed in-app (`···` → *Assumptions & sources*) and in `app/backend/converge/assumptions.py`:

- Inflation 0.8% (SNB, 24 Sep 2026); cash interest 0% (SNB policy rate 0%).
- Mortgage rate 1.8% illustrative (BWO average mortgage rate 1.31%, reference rate 1.25%).
- 20% minimum deposit, 5% imputed rate, 1% maintenance, one-third affordability rule, 15-year amortisation to 2/3 (UBS and Credit Suisse mortgage guides).
- Illustrative defaults include an extra deduction of 0%, income growth of 0.8%, an investment return of 3%, purchase fees of 1%, shared rent of CHF 3,400 and flat property prices.

## 8. Limitations

- Synthetic data only. It is not representative of the Swiss population, and the relationship between the two profiles is assumed.
- The optional extra deduction is a flat percentage of net pay. The model omits tax lag, wealth tax, pillar 2/3a and the tax effects of marriage or home ownership.
- Child scenarios assume eligibility for the modeled benefits. They omit employment top-ups, child tax deductions, Zurich income- and wealth-based subsidies, school-age care, education costs and allowances, larger housing costs, and automatic safety-buffer increases. Users can change rent and safety buffers through their normal plan controls.
- Deterministic single path, with no Monte Carlo. Sensitivity is explored through stress tests.
- Investment portfolios are a single snapshot with a constant assumed return, and are never sold to fund a deposit.
- The affordability check gives an indication using combined usual net income. A lender makes its own assessment using gross income.
- The recommendation search is bounded (single levers and pairs). Larger restructurings must be made by the user.
- Identity is simulated by switching between partners; there is no authentication.
- The live LLM path was verified for request shape and error fallback, but not run with a valid key in this environment.
