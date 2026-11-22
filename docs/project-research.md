# Converge: challenge, data audit, and product direction

Research date: 2026-11-22. User direction: Swiss couple first; explore several
decisions and unexpected combinations, rather than limiting the demo to one.

## What the challenge asks

The supplied 23-page UBS challenge deck asks for a fictional financial profile,
one working intervention, a calculated before/after comparison, and transparent
assumptions. Conversational AI and uncertainty are extensions. Its framing is
conditional decision exploration, not a promise to forecast a person's future.
The repository's scoring weights are explicitly draft guidance; they should not
be represented as confirmed event rules.

Converge's existing `.agents/PROJECT.md` adds two independent profiles, shared
commitments, constraints, verified recommendations, and mutual approval. At the
time of inspection, frontend, backend, and tests contained placeholders only.

## Material actually read

Read the 43 supplied Markdown documents, all 23 pages of the challenge PDF,
starter Python engine, example runner, tests, and both JSON configurations.
Parsed every row and field in all 11 CSV files, including the two copies of the
120-scenario catalogue, and all transactions directly from the ZIP. Large tables
were processed programmatically, rather than printing half a million records.

The populated source was `../../ubstwin/data` relative to this repository.
`external/ubs/ai-financial-twin-lauzhack-2026-main/` existed but contained no files
at the last inspection. No supplied datasets were copied or committed.

Reproduce the audit with:

```powershell
python scripts/audit_ubs_data.py ../../ubstwin/data
```

The script accepts a challenge-root directory, discovers CSVs recursively, and
streams the compressed transaction CSV without extracting it. It uses decimal
arithmetic for reconciliation. It reports checks; it is not a complete schema
validator or an assertion that the data represents real households.

## What is in the data

| Material | Rows | Interpretation |
|---|---:|---|
| Profiles | 1,200 | Fictional Swiss people; all CHF; opening date 2025-01-01 |
| Accounts | 1,200 | One cash account per profile |
| Transactions | 552,295 | Synthetic income/expenses, January 2025 through December 2026 |
| Monthly cash balances | 28,800 | 24 months per profile; opening, net transactions, closing |
| Assets | 2,399 | 1,200 cash and 1,199 investment opening snapshots |
| Liabilities | 283 | Opening debt snapshots; every monthly payment is zero |
| Goals | 1,500 | Targets, deadlines, priorities; all profiles represented |
| Life events | 600 | Only 200 profiles; all marked `proposed_not_executed` |
| Scenario assumptions | 240 | Only 120 profiles; two parameters each, all for S001 |
| Scenario catalogue | 120 | Descriptions of interventions; no fitted effects or probabilities |

The second scenario CSV is byte-identical to the first. The file called
`data-dictionary.md` is byte-identical to the data README and supplies no actual
field-by-field dictionary. The data README names an `alexia-profile.json` that
is absent; the runnable profile is instead `starter-kit/sample_profile.json`.
The CSV catalogue and the Markdown scenario library also assign some IDs to
different ideas. For example, CSV S025 is Singapore while the Markdown table
describes New York. Use one canonical, versioned catalogue; do not join the two
by ID as if their meanings were identical.

### Checks and consequential gaps

- All monthly opening + net = closing identities reconcile exactly.
- All transaction totals match the associated monthly net cash amounts.
- Opening balances continue correctly between months and match profile/account
  starting values; cash asset snapshots also agree.
- No duplicate transaction IDs, unknown transaction profiles, account ownership
  mismatches, inconsistent income/expense signs, or non-CHF/non-synthetic
  transaction records were found.
- There are 772 negative closing balances across 61 profiles. These are funding
  shortfalls, not implicitly approved overdrafts. Alexia first goes negative in
  September 2025 and finishes December 2026 at CHF -16,741.11.
- Investment asset records refer to investment account IDs that are absent from
  the cash-only account table. Import these as separate asset snapshots, or
  explicitly construct typed investment accounts; do not silently drop them
  through an inner join.
- Debt is not amortized in the transaction history. Investment valuation paths,
  investment transfers, tax calculations, and pension dynamics are absent.
- All life-event cash-effect fields are blank. Events are suggestions, not
  observed interventions. They cannot train an education or relocation effect.
- There are 349 profiles labelled `couple`, but no partner IDs, household IDs,
  joint account ownership, shared expense allocations, or consent preferences.
  A household-type label is not a linked second person.
- Future-dated 2026 records are synthetic fixtures, not observations available
  in the real world. Any training/evaluation exercise needs a declared cutoff.

The supplied starter engine is intentionally cash-only. All five supplied tests
pass. Running its example produces final cash of CHF 152,000 for working,
CHF 144,600 for a master's, and CHF 97,500 for moving abroad. The master's path
has a CHF -18,600 minimum and a first shortfall in month 7. The illustrative
slide-14 chart instead shows CHF 93k/112k/95k for those choices. Those slide
figures are not regression targets for the starter configuration: the deck
does not provide a reproducible matching parameter set.

### Is it useful?

Yes: useful integration fixtures, import/accounting checks, transaction views,
fictional demo personas, liquidity failure cases, and ideas for interventions.
No: not sufficient evidence for Swiss population distributions, realistic
partner dependence, causal salary benefits of education, calibrated rare-event
probabilities, or investment performance. A model fitted to these records learns
their synthetic construction, not demonstrated real financial behaviour.

Keep this dataset as a compatibility and regression layer. Build a separately
identified, statistically informed synthetic couple generator for Converge.

## External data: collect for a specific modelling purpose

Three World Bank JSON requests and the FRED FX CSV returned HTTP 200 in direct
probes. The FSO PXWeb catalogue request timed out after 20 seconds; this does not
establish that it is permanently unavailable. No external observations were
persisted in the repository. Other sources below were researched, not integrated.

| Priority | Source | Intended contribution | Access/evidence |
|---|---|---|---|
| 1 | FSO Household Budget Survey | Expenses by household type/income; shared housing economies | [Survey](https://statistik.admin.ch/en/understanding-data-statistics/surveys/hbs); obtain exact table metadata and sample definitions |
| 1 | FSO earnings statistics | Income distributions conditioned on available relevant characteristics | [Swiss Stats Explorer guide](https://dam-api.bfs.admin.ch/hub/api/dam/assets/orderNr%3Ado-e-00.02-sse-01/master); discover current table/export rather than assuming old PXWeb endpoints |
| 1 | FSO CPI | Monthly cost changes and category differences | Use exact FSO series and reference base; national CPI is not a personal spending basket |
| 1 | FOPH/Priminfo | Insurance premium costs by relevant region/product/person attributes | [Dataset and CSV resources](https://opendata.swiss/en/dataset/health-insurance-premiums); current landing page covers 2027, with 2026 archive separately available |
| 1 | FTA tax calculator and source tables | Verify Swiss canton/municipality/family-status tax assumptions | [Official calculator](https://www.estv.admin.ch/en/tax-calculator-calculate-taxes); no supported public API was verified |
| 2 | SNB statistical portal | Swiss rates, yields, FX and historical stress environments | [API guidance](https://data.snb.ch/en/help_api); choose table and generated endpoint; use caching/ETags |
| 2 | World Bank Swiss inflation | Annual historical macro context | `FP.CPI.TOTL.ZG`: 66 non-null annual observations, 1960-2025 in probe |
| 2 | World Bank Swiss unemployment | Aggregate labour stress context | `SL.UEM.TOTL.ZS`: 35 observations, 1991-2025; not a personal job-loss probability |
| 2 | World Bank Swiss GDP growth | Historical macro scenarios | `NY.GDP.MKTP.KD.ZG`: 65 observations, 1961-2025; not salary growth |
| 2 | FRED DEXSZUS | Historical FX stress for later cross-border extensions | 14,575 daily rows in probe; units are **CHF per USD**, despite the challenge catalogue saying USD per CHF |
| 3 | Federal Office for Housing | Rental reference-rate scenarios | [Official history](https://www.bwo.admin.ch/de/entwicklung-referenzzinssatz-und-durchschnittszinssatz); distinct from a new mortgage quote |
| 3 | Eurostat/BIS | Later international living-cost/housing/rate scenarios | Select a named series and inspect definitions/terms before integration |

World Bank request pattern:

```text
https://api.worldbank.org/v2/country/CHE/indicator/FP.CPI.TOTL.ZG?format=json&per_page=100
```

[World Bank API documentation](https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures)
and [data licensing](https://datacatalog.worldbank.org/public-licenses) describe
access and the default CC BY 4.0 terms, with dataset-specific exceptions.
[FSO terms](https://statistik.admin.ch/en/terms-use) explain OPEN BY attribution.
[SNB copyright](https://www.snb.ch/en/srv/disclaimer_copyright) explicitly
discusses non-commercial reuse and third-party rights; do not label everything
in its portal unrestricted. Check the specific source and intended use.

For each adopted series record provider, exact code, source URL, geography,
observation period, publication/retrieval date, units, frequency, license/terms,
transformations, missingness, and version/hash. Cache inputs locally in ignored
storage. Live API availability should not determine whether a demo works.

Do not spend the hackathon collecting GDP/population/US indicators that do not
change a chosen decision. Swiss rent, spending, salary, insurance, and taxes are
more directly useful. This is a relevance priority, not a restriction on breadth.

## Recommended financial and uncertainty architecture

Use an exact, reproducible monthly transition engine, then put stochastic inputs
around it. Monte Carlo and GPs solve different parts of the problem and can work
together. Given a scenario and one sampled environment, accounting remains
deterministic. Use decimal currency arithmetic or integer minor units for ledger
entries, with an explicit rounding policy.

1. **Ownership-aware state:** Partner A, Partner B, and shared accounts;
   liabilities, asset ownership fractions, personal goals/reserves, joint costs,
   contribution rules, financial disclosure settings, and decision approval.
   Shared account allocations must sum to ownership, and internal transfers
   cancel at household consolidation.
2. **Composable events:** each event declares owner(s), start/duration, one-off
   cash flows, recurring changes, eligibility, dependencies, and source-backed
   assumptions. Resolve overlapping effects explicitly. Moving together replaces
   separate rent with one shared housing cost; it does not merely add a third rent.
3. **Exact simulation:** distinguish salary after payroll deductions from salary
   after income tax; the dataset's `net` label does not settle this. Track debt
   interest/principal, transfers, fees, investments, liquidity, and taxes without
   double counting. Report unfunded obligations instead of inventing financing.
4. **Uncertainty paths:** combine a common macro component, possible common
   employer/sector exposure, and personal variation. Employment gaps and large
   expenses need explicit discrete events or jump distributions; a smooth GP
   does not automatically represent them. Preserve temporal and cross-partner
   dependence. Where dependence is unknown, expose a sensitivity/stress range.
5. **Comparison:** use the same sampled environments for competing plans
   (common random numbers). Return per-person and shared liquidity, goal dates,
   cumulative contributions, transfers, and shortfall magnitudes/frequencies.
   Measure any-month breaches from full paths, not from pointwise quantile bands.
6. **Decision search:** enumerate or optimize timing and contribution splits;
   show Pareto trade-offs. Personal reserves and consent are constraints, not
   quantities the optimizer may trade away for a larger household total.
7. **Language layer:** parse proposed edits into validated structures, request
   missing assumptions, call the engine, and explain only verified results.

### Where Gaussian processes could add value

Recommended experiment: model a modest, continuous unknown such as residual
discretionary spending after recurring commitments and known events have been
removed. Start with a simple mean and conservative kernel; do not fit many
seasonal and trend components to 24 monthly points per person. If using pooled
profiles, recognize that the supplied profiles are synthetic, not real evidence.

Use posterior **joint samples across the forecast dates**, plus justified
observation/process noise, as inputs to Monte Carlo. Sampling independent
marginal normal distributions at each month would discard temporal covariance.
Keep uncertainty in an inferred trend separate from irreducible expense shocks.
Hyperparameter uncertainty and structural model error also remain unless modelled.

A second possible role is a GP surrogate for an expensive simulator over a small
continuous decision space (e.g. purchase date and contribution split). Its bands
then describe approximation uncertainty, not household outcome risk. Benchmark
latency first: if exact simulation is fast, a surrogate adds little. Always
re-evaluate suggested decisions with the exact engine and fresh validation paths.

Validate with temporal holdouts, rolling-origin errors, interval coverage and
sharpness, and comparison with a simple seasonal/constant baseline or block
bootstrap. Keep synthetic recovery experiments separate from real-data validation.
Do not market a GP posterior interval as universally calibrated future risk.
Historical macro forecasts over a decade are especially assumption-sensitive.

Primary technical reference: [scikit-learn GP documentation](https://scikit-learn.org/stable/modules/gaussian_process.html).
The proposed model roles and validation design above are engineering judgments,
not findings established by the supplied financial dataset.

### Generating our own synthetic couples

Generate a household context first, then two compatible people conditional on
that context. Calibrate whatever marginals/conditional summaries the official
tables actually support. Age, income, employment, housing, debt, and household
size cannot all be sampled independently without creating implausible records.
Do not claim an observed joint distribution when only marginal tables exist.

Separate personal and shared expenditures. Choose fixed commitments first, then
stochastic category spending and rare shocks. Materialize cash snapshots from the
generated ledger, rather than generating both independently. Label every field as
synthetic input, statistical calibration, explicit assumption, or calculation.
Store seeds and generator versions; validate distributions, accounting, ownership,
and difficult cases. More synthetic rows do not create new empirical information.

## Demo breadth and what would distinguish Converge

Couples and uncertainty already exist in financial planning products. A stronger
claim to demonstrate is: **help two people find a shared plan while preserving
each person's financial freedom and showing who bears the downside.**

Use a common scenario workspace with several genuinely calculated options:

| Decision | Interactions to demonstrate |
|---|---|
| Move in together | Shared rent, deposits, moving costs, personal contributions |
| Study or take a career break | Lost income, tuition, support transfer, reserve protection |
| Buy a home | Down payment, ownership shares, mortgage/debt service, liquidity |
| Both move to 80% work | Extra time versus income loss, saving delays, common shocks |
| Stagger two career breaks | Sequence matters even with the same total time off |
| Launch a small business | Explicit runway and a stopping rule if a personal reserve is threatened |
| Keep a second city base | Commute/rent overlap versus career opportunities |
| Support a family member | A personal commitment competes with a shared goal |

Out-of-the-box interaction: select a personal boundary (e.g. preserve my reserve),
then ask which shared plans remain feasible. Another: a plan survives one partner
losing work but fails if both share an employer/sector shock. A third: calculate
the latest start date for a joint goal compatible with both partners' sabbaticals.
These are proposed capabilities, not implemented features.

Build breadth through reusable event primitives and verified combinations.
Each visible option needs an implemented financial effect, editable assumptions,
and a working comparison; a large catalogue of labels does not establish breadth.
Start with exact accounting and ownership, wire several events to one excellent
timeline, then add correlated uncertainty and a benchmarked GP experiment.

## Interface research

See [interface-references.md](interface-references.md) for inspected shipped
products, precise interaction references, and the proposed Converge screen.
