# Converge

A Swiss-first planning workspace for two people: explore life decisions together
while keeping personal cash, shared commitments, and each partner's boundaries visible.

## Run locally

Requires Node.js 20+ (tested here with Node 20.12.2).

```powershell
npm install
npm run dev
```

Open the printed local URL, normally http://127.0.0.1:5173.

```powershell
npm test
npm run build
npm run preview
```

`npm run dev` also provides `/api/observations`, a bounded World Bank data
retrieval endpoint. The static production preview runs the planner and rules
library; it does not provide that development-only endpoint. The source page
reports an unavailable refresh without changing the plan. A production service
can mount `backend/observations.ts` behind its own authenticated API.

## Working features

- Personal and shared timeline lanes; drag events or edit their dates with fields.
- Eight event types: cohabitation, study, sabbatical, home purchase, reduced work,
  business runway, family support, and child-related expenses.
- Six preset combinations, editable profiles and financial assumptions, undo,
  local persistence, and validated JSON import/export.
- Monthly cash engine with integer-centime ledger entries, explicit contributions,
  semester tuition, income changes, home equity, interest and principal repayment.
- Baseline comparison, per-person reserve breaches, and exact-engine date search
  over the following 36 months without relaxing either personal reserve.
- Worker-based, seeded Monte Carlo with correlated GP spending paths and shared
  stress environments for competing plans.
- Ten dated official-source records, contextual education checks, source filters,
  current/scheduled/proposed distinctions, and live historical Swiss macro context.

## Boundaries that matter

All demo people, incomes, costs, investment assumptions and stress probabilities
are fictional inputs. The project does not claim the UBS data is representative.
The GP is actually fitted, but to 24 explicitly generated spending residuals:
its fit is a model demonstration, not validation on real households. No model
accuracy or real-world risk probability is claimed.

Income means take-home pay **after payroll deductions and income tax**. Income
tax is not calculated again. Swiss property taxes, subsidies, pension entitlements,
benefit eligibility and mortgage lending eligibility are not calculated. Scheduled
housing-tax reform is shown as context, without invented tax savings. EPFL
semester invoices and entered age-tier insurance premiums affect cash flow;
unconfirmed scholarships contribute zero. User-entered awards must be explicitly
marked confirmed to affect cash. Fee and premium amounts remain editable inputs.

Investment growth is consolidated across both partners' initial holdings; no
automatic investment liquidation, borrowing, cross-partner transfer, property
appreciation or house sale is invented. Property equity is shown at household
level; this version does not model legal ownership shares or joint liability.
Personal reserves refer to personal cash only. Shared savings do not silently
rescue a personal shortfall. Home-cost and mortgage assumptions are illustrative.
For work/study conflicts, the engine rejects overlapping interventions for the
same person. Persistent housing costs continue after move/purchase milestones.

Local review markers demonstrate two-party decision states; they are not
authenticated consent. There is no account system, bank connection, LLM endpoint,
or multi-device synchronization. Nothing is sent to an LLM. The source catalogue
was reviewed on 22 November 2026; it does not automatically monitor legislation.

## Structure

| Path | Responsibility |
|---|---|
| `frontend/` | React planning workspace, accessible forms, SVG chart and timeline |
| `backend/types.ts` | Shared typed interfaces |
| `backend/engine.ts` | Exact monthly accounting and validation |
| `backend/search.ts` | Feasible timing search with exact re-evaluation |
| `backend/uncertainty.ts` | GP fit, joint sampling, reproducible Monte Carlo |
| `backend/policy.ts` | Official-source registry and evidence-based education checks |
| `backend/observations.ts` | Live historical indicators, timeouts and 24-hour cache |
| `tests/engine.test.ts` | Accounting, boundary, policy and reproducibility checks |
| `docs/` | Research, interface references, Swiss rules and modelling details |

Downloaded observations are cached under ignored `data/raw/`; local datasets and
secrets are not committed. The browser stores the fictional plan on this device.

## Sources and modelling notes

- [Project and supplied-data audit](docs/project-research.md)
- [Interface references](docs/interface-references.md)
- [Swiss rule evidence and limits](docs/swiss-rules.md)
- [Financial and uncertainty model](docs/model.md)
