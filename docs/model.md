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
| Taxes and pensions | Plan inputs | Separate per-person income tax budget, vested opening pension, and monthly pension credit. All default to zero pending better data |

Salary transactions are treated as **net pay** because they closely match the UBS profile field `reference_monthly_net_income_chf`. The optional extra deduction defaults to 0% and can model an additional outflow proportional to net pay. The optional personal tax budget is fixed in nominal CHF and covers income tax payable outside payroll. Include only amounts that are not already accounted for in take-home pay, spending or the extra deduction. Switzerland’s salary certificate lists salary, withheld amounts and contributions. [Swiss salary certificate](https://www.ch.ch/en/work/salary/salary-certificate/)

## 2. Monthly transition (per partner *i*)

```
income_i   = usual_income_i · (1+g)^(t/12) · break_factor_i(t)     (+ bonus/12 if enabled)
deduct_i   = τ · (income_i − family allowance) + tax_budget_i      personal tax budget and extra deduction are optional
spending_i = (personal budgets + own-home budgets if not cohabiting) · (1+π)^(t/12)
household_i= share_i(t) · (shared rent* + utilities + groceries) · (1+π)^(t/12)  (+ moving cost once)
housing_i  = own_i · (mortgage_t · r_m/12 + value_t · m/12)        interest + maintenance (expenses)
amort_i    = own_i · min(mortgage_t, A)                              principal repayment (not an expense)
deposit_i  = own_i · d · price      (purchase month; cash → equity)
fees_i     = own_i · f · price      (purchase month; expense)
cash_i[t]  = cash_i[t-1] + income − deduct − spending − household − housing − amort − loans − one-offs − deposit + cash interest
```

\* Shared rent stops once the home is owned.

- **Separate accounts.** Each partner has their own cash, investments and share of the property. Shared costs are paid from a joint account funded by transfers in the agreed split. Transfers out of personal accounts equal transfers into the joint account, so the joint balance is identically zero and the transfers **cancel at household level**. This is tested.
- **No double counting.** From the move-in month (or the purchase month, whichever comes first), each partner's own rent, utilities and groceries stop, and the household budget replaces them.
- **Property.** The deposit converts cash into equity: net worth changes only by the fees. Interest and maintenance are expenses. Amortisation reduces cash and debt equally. The second mortgage (above 2/3 of value) is amortised over 15 years. Ownership, deposit and running costs all follow `own_i`, so each partner's equity is `own_i · (value − mortgage)`.
- **Cost-sharing rules.** Equal, proportional to usual income, or custom. Optionally, contributions follow *actual* income during a career break, so the working partner covers more.
- **Career break.** Income is multiplied by `income_pct` for the break's months, with optional one-off costs in the first month. Overlapping breaks are rejected.
- **Net worth** = cash + investments + vested occupational pension + property share − mortgage share − loans. Liquidity (cash) is tracked separately.
- **Pension.** A user can supply a vested balance and the combined employer and employee savings credit from their pension statement. The employee deduction is already reflected in take-home pay, and the employer contribution does not pass through personal cash. During a career break or study period the credit scales with the fraction of pay retained. The model applies no pension interest, thresholds, payout schedules or Pillar 1/3 calculations. Pension balances are excluded from ordinary goals and cash buffers. [Federal Social Insurance Office](https://www.bsv.admin.ch/en/old-age-provision-occupational-benefits-plan)

### Future net income scenarios

A personal path can add dated `income_steps` with a user-assumed CHF/month delta and label. Each step adds a fixed nominal amount to grown regular net salary from its start month. Active steps stack; any scenario with a negative projected salary is rejected. Career break pay and other salary-based rules use the resulting income. Steps are assumptions. UBS data cannot estimate the salary effect of a degree, promotion or job change.

The voice path tool compares combined month-end net worth over a common projection. It reports the first month after the last shortfall as sustained break-even, or explains whether the option was never behind or remains behind at the end.

### What-if explorer

- The agreed plan, or the viewer's draft when there is one, provides the baseline. The alternative applies validated changes over the same starting balances and projection months. Cohabitation and study can be combined with an existing or planned joint purchase. Living separately keeps independent housing costs and disables a joint purchase. Existing obligations such as shared childcare continue.
- A study event uses the programme’s published duration and pays the selected nominal fees every six months from the first study month. Quantitative Finance defaults to three semesters at CHF 780 each. Fine Arts defaults to four semesters at CHF 755 each (CHF 720 tuition plus CHF 35 compulsory sports fee). Fee supplements, application costs and materials can be entered explicitly. The default 30% pay retained during studies is illustrative. Post-study pay starts at the first month after the programme and defaults to no change. It represents a user assumption, including the assumption of an immediate return to employment. The FSO publishes distributions by field, but the cited cohort is applied-sciences bachelor graduates, standardized to full-time gross earnings. It supplies context, rather than individual master’s net pay or a causal degree premium. [UZH / ETH fee and duration](https://www.msfinance.uzh.ch/en/admission/applicationinformation.html) · [ZHdK programme](https://www.zhdk.ch/en/degree-programmes/finearts/master-fine-arts) · [ZHdK fees](https://www.zhdk.ch/en/degree-programmes/tuition-fees) · [FSO survey](https://dam-api.bfs.admin.ch/hub/api/dam/assets/32172110/master)
- The comparison reports each partner’s minimum month-end cash, the date and margin over their buffer, and combined ending net worth. Combined cash is calculated by summing both balances in the same month. A break-even date for net worth means the first month after the last shortfall through the selected horizon. Other path comparisons in the agent may use an explicitly labelled 120-month extension.
- Uncertainty is optional. Each of 128 paired draws (seed 20261122) uses the same shocks for the baseline and alternative. A uniform shock within ±1.5 percentage points shifts the annual spending inflation for the full run, clipped to the engine’s allowed inflation bounds. Investment values use a common monthly lognormal shock with 10% annualized volatility. The log drift preserves the assumed annual expected investment growth. The inflation and monthly market draws are independent. Controls let users vary both magnitudes. The result shows counts of draws with any month below a cash buffer and the 10th/50th/90th percentiles of the paired difference in combined ending net worth. Market returns move net worth and have no direct cash effect because investments are never sold. No job-loss, admission or salary probabilities are claimed.
- The interface uses an overlaid baseline and adjustable counterfactual, informed by how ProjectionLab and Boldin make scenario comparisons discoverable. Converge adds side-by-side constraints for each partner and a separate household view. [ProjectionLab What If](https://projectionlab.com/help/using-what-if) · [Boldin scenario comparison](https://help.boldin.com/en/articles/4326642-video-demo-create-and-compare-scenarios)

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
- Illustrative defaults include an extra deduction of 0%, income growth of 0.8%, an investment return of 3%, purchase fees of 1%, shared rent of CHF 3,400 and flat property prices.

## 7. Limitations

- Synthetic data only. It is not representative of the Swiss population, and the relationship between the two profiles is assumed.
- The optional extra deduction is a flat percentage of net pay. The model applies user-entered tax budgets and pension credits. It omits tax assessments, wealth tax, Pillar 1 and 3a entitlement, and the legal or tax effects of marriage and home ownership.
- Child scenarios assume eligibility for the modeled benefits. They omit employment top-ups, child tax deductions, Zurich income- and wealth-based subsidies, school-age care, education costs and allowances, larger housing costs, and automatic safety-buffer increases. Users can change rent and safety buffers through their normal plan controls.
- The main path is deterministic. The what-if explorer layers on illustrative, seeded inflation and market draws. These are conditional model outputs and depend on their specified distributions.
- Investment portfolios start from a single snapshot. The standard projection uses constant assumed growth and the uncertainty run applies market shocks. Investments are never sold to fund a deposit.
- The affordability check gives an indication using combined usual net income. A lender makes its own assessment using gross income.
- The recommendation search is bounded (single levers and pairs). Larger restructurings must be made by the user.
- Identity is simulated by switching between partners; there is no authentication.
- The agent uses the validated scenario tool and returns engine comparison cards separately from its conversational explanation. Numeric grounding checks magnitudes against recent tool facts and cannot prove that a number was attributed to the correct person, date or metric.

- The finance agent is an AI interview and scenario tool over the synthetic twin. Sensitive questions are skippable. The app stores transcripts and per-viewer memory in local SQLite. Users can review the observations and clear their conversation history on the Profile page. Converge persists no audio. See [Agent and voice configuration](VOICE.md).
