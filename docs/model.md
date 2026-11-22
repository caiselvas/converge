# Financial model v0.1

## Time and accounting

The demo starts January 2027 and runs monthly for 120 periods. The opening state
is separate personal cash and investment holdings. Each month applies event
effects, computes after-tax income, personal spending, shared obligations,
contributions, debt service, and investment returns. Each ledger entry rounds
once to integer centimes. Consolidated cash equals personal A + personal B + shared.
Net worth adds investments and property, then subtracts outstanding mortgage.

Personal spending excludes insurance, rent, and separately modelled event costs.
Income is assumed after both payroll deductions and income tax. There is no
further income-tax deduction, and the engine does not infer an effective tax rate.

Shared costs follow an equal, income-proportional, or user-entered contribution
split. Income proportions are computed from each month's post-intervention
income; if both incomes are zero, the split defaults to equal. Shared savings
are an additional explicit cash transfer. Transfers cancel on consolidation.
Negative personal cash remains an unfunded gap even when the household is wealthy.
An initial reserve breach is reported separately from a later monthly breach.

## Events and assumptions

- Cohabitation replaces two rents with one entered shared rent from the move date.
- Study changes earned income by an entered percentage, charges a semester
  invoice every six months, and budgets support only if marked confirmed.
  The selected invoice uses EPFL's sourced CHF 780 / CHF 2,240 categories or a
  custom amount. Category eligibility and future fee adjustments are not inferred.
- Sabbatical, reduced hours, and business events alter income over their duration.
  Business operating costs, support and child costs are explicit recurring inputs.
- Home purchase moves the down payment into property equity and consumes entered
  transaction fees. Mortgage interest is paid on outstanding debt. Linear principal
  repayment is based on original debt and is capped at remaining principal.
  Maintenance uses the unchanged property value. Shared rent stops on purchase.
  Legal ownership shares, property taxation, pension withdrawals and actual bank
  approval criteria are not calculated. Personal investment sales are not assumed.

All future cost inflation and income growth use explicitly entered annual rates,
converted by fractional-year compounding. Yearly investment return converts to a
monthly effective return. Initial investment holdings remain invested; changing
investment contributions is outside this first version. Nominal values are shown.

Insurance chooses the entered young-adult or adult premium according to tariff
calendar year; adult pricing begins January after the year the person turns 25.
The amounts are fictional editable premiums, not fetched individual quotes. The
same explicit general cost escalation is applied thereafter. A national average
is not substituted for personal insurance.

## Policy scope

`policy.ts` stores jurisdiction, status, effective date where known, review date,
official URL and calculation boundary. The education helper computes attained age
on study start and contribution-related calendar checkpoints. It does not infer
an award, probability of award, or nationality/residence category from age alone.
Reported working years are an evidence prompt, not proof of legal independence;
future qualifying work history is not automatically assumed. Non-Vaud scholarship
rules require separate authority review. See `swiss-rules.md` for source details.

Current, scheduled and proposed rules do not silently become cash adjustments.
This makes missing tax/pension costs visible as unquantified checkpoints rather
than making up amounts. To model a verified additional payment, enter it as an
explicit event cost. The reference plan is conditional and incomplete for those
unquantified costs.

## Exact timing search

For one selected event, test each start from the current date up to 36 months
later within the horizon. Re-run the complete engine for every candidate. Reject
overlapping work changes and every plan with either personal reserve breach or
funding gap. Show up to three feasible starts. The search is a bounded deterministic
enumeration, not global life optimization or a stochastic safety guarantee.

## GP and uncertainty experiment

The synthetic residual history contains 24 monthly values. The fitted GP uses an
RBF covariance and observation-noise regularization; candidate length scales are
2, 4, 8 and 12 months, selected by log marginal likelihood. Cholesky solves avoid
explicit matrix inversion. Posterior joint covariance supplies correlated latent
spending residual samples across the whole horizon. Additional independent
monthly residual noise and an AR(1) common cost component are included.

For each of 160 paths, the exact accounting engine receives:

- correlated, positive spending factors derived from the GP residual paths;
- a common monthly cost component with persistence 0.8 and innovation SD 0.01;
- personal three-month income interruptions, sampled with 0.04/12 monthly hazard;
- a shared three-month interruption with 0.01/12 monthly hazard;
- income retained during interruptions of 20%, without claiming unemployment benefit;
- investment return shocks with 8% annualized volatility around the reference rate.

These are illustrative assumptions, not estimated Swiss transition probabilities.
The unchanged and edited plans receive exactly the same environment for each
path. Full paths determine whether either reserve is breached at least once.
Reported chart bands are pointwise 10th, 50th and 90th percentiles, not simultaneous
path guarantees. Finite-path frequencies have sampling error; no perfect coverage
claim is made. Hyperparameter and structural model uncertainty remain unmodelled.

The same seed reproduces outputs. The worker keeps stochastic work off the UI
thread and is terminated when a newer calculation replaces it. The implementation
is ready for a real-data pilot, but has not been calibrated or backtested on real
household histories. More generated samples do not supply empirical evidence.

## External observations

The local development endpoint retrieves the latest non-null Swiss World Bank
observations for CPI inflation (`FP.CPI.TOTL.ZG`), ILO-modelled unemployment
(`SL.UEM.TOTL.ZS`), and real GDP growth (`NY.GDP.MKTP.KD.ZG`). Requests have 15-second
timeouts, in-flight deduplication and a 24-hour in-memory cache. Results carry
observation year, units, source URL and retrieval timestamp, and are written to
ignored local storage. They appear as historical context; refresh never changes
a financial assumption. The national unemployment rate is not a personal job-loss
probability, and GDP growth is not wage growth.

World Bank default terms are CC BY 4.0 with provider/dataset-specific exceptions:
https://datacatalog.worldbank.org/public-licenses. Indicator retrieval documentation:
https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures.
Official policy text is linked and paraphrased; source reviews are manual.

## Validation

`npm test` checks consolidated monthly cash identities, internal transfer
neutrality, principal/equity accounting, semester tuition and confirmed grants,
visible negative personal cash, conflicting work changes, birthday/calendar-age
boundaries, bounded scholarship checks, seeded GP/Monte Carlo reproducibility,
invalid inputs and exact-search feasibility. `npm run build` checks TypeScript
and produces the static application. Browser QA additionally checks navigation,
calculation completion, source retrieval, responsive layout and input behavior.
