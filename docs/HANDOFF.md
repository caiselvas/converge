# Converge — handoff

Branch `main`. The decision planners build on `b32c31f`. Shared agent instructions are in `AGENTS.md`; project context is in `.agents/PROJECT.md`.

## Navigation and child

- Overview (`/`), Goals (`/goals`) and Expenses (`/expenses`) share the URL-backed scope, draft, viewer and Ask panel. Goals and Expenses show a live outcome strip; the decision planners do not, because they preview their own result.
- **Goals** has two sections. *Plan a life decision* opens a guided planner per decision (`/goals/move-in`, `/goals/buy-home`, `/goals/have-child`, `/goals/career-break`). *Financial goals* holds each partner's safety buffer and savings goals.
- Plan living together, the home, children, career breaks and the cost split in the planners. Overview links into the planners and sends conflicts to the relevant comparison. Together Expenses shows the resulting shared costs read-only, with links back to the planner.
- Decision modules live in `app/backend/converge/decisions.py` (questions, prefill, validation, mapping to `Change` objects). Interview answers are stored per decision in `workspace.json` (`decisions`), separate from the agreed plan and from personal drafts, and reach the plan only through a `decision` proposal. See `docs/model.md` §5.
- Child costs, allowance, parental leave and the **Child born** event come from the engine. The standalone child replay in `scripts/demo_check.py` follows the main demo and uses the assumptions documented in `docs/model.md`.

## 1. Product and UX decisions

Converge is a financial planner for couples: **two personal financial twins and one shared plan**. A plan can be fine for the household and still risky for one partner, so every result is shown per partner and constraints are personal.

**Overview** (`app/frontend/src/components/Plan.tsx`) shows the verdict, planner links and cash projection.

The comparison combines the two partners' answers with the deterministic engine. It shows one chart, up to three distinct alternatives and separate safety for each partner. Stress changes only the comparison. Use **Choose this option** to send a proposal and switch **Viewing as** to approve it. The header menu can load the prepared demo home or reset to the original UBS state.

## 2. Architecture and key files

```text
app/backend/converge/
  config.py            paths and env (UBS data dir, state dir, partners, LLM key/model)
  data/ubs.py          CSV loaders; transactions read from the ZIP; ledger reconciliation; disk cache
  data/profiles.py     UBS records -> Person (income, categories, floor, goals, investments)
  seed.py              default workspace (Nina P00918 + Emil P00809, nothing shared yet)
  models.py            Pydantic Plan / Person / Shared / Assumptions / Change (validated)
  engine/simulate.py   monthly simulation + runtime accounting checks
  engine/evaluate.py   constraints, goals (priority-funded), drivers, events, API payload
  engine/changes.py    LEVERS whitelist, apply_changes (re-validates), describe/format, approvers
  engine/recommend.py  bounded search, strategies, diversity, explanation payload
  store.py             proposals, approvals, versions, restore (JSON in app/backend/.state/)
  ai.py                Claude interpret/explain + offline parser + numeric grounding check
  assumptions.py       assumptions & sources registry
  api.py               FastAPI routes
app/frontend/src/
  lib/store.tsx        client state: workspace, viewer, per-viewer drafts (localStorage),
                       debounced /simulate, recommendations, preview, proposals, sheet
  lib/plan.ts          local optimistic applyChanges / upsert (server re-validates)
  components/          AppShell, Plan, Decisions, Recommendations, PersonSheet, SharedSheet,
                       Sheet, DraftBar, Inbox, Sources, ChecksBadge, charts/CashChart, ui/
tests/backend/         pytest (48 tests)
docs/                  model.md (financial model), demo.md (script), HANDOFF.md
```

**Contract.** Every modification, whether from the UI, a recommendation or the LLM, is `Change(path, value)` on a whitelisted lever (`engine/changes.py`). The backend re-validates the whole plan. The frontend applies drafts locally for instant input, but every displayed number comes from `/api/simulate`. To add a new editable field, add a lever, then a UI control.

## 3. Data dependencies

- `external/ubs/Data/` (git-ignored; import with `scripts/import_ubs.sh`; override with `CONVERGE_UBS_DATA_DIR`).
- Files used: `synthetic-profiles.csv`, `synthetic-transactions.zip` (one CSV inside, plus a `__MACOSX` entry that is ignored), `synthetic-cash-balances.csv`, `synthetic-assets.csv`, `synthetic-liabilities.csv`, `synthetic-goals.csv`, `life-events.csv` (provenance only).
- The ledger covers Jan 2025 – Dec 2026, and the plan starts Jan 2027. The first load takes about 2 s; per-profile aggregates are cached in `app/backend/.cache/`.
- The demo partners are configurable via `CONVERGE_PARTNERS=P00918,P00809`. The relationship is a scenario assumption.

## 4. Commands

```bash
make install   # uv sync + npm install
make dev       # backend :8000 (FastAPI, --reload) + frontend :3000 (proxies /api)
make test      # backend pytest
make lint      # tsc + eslint
make build     # next build
curl -X POST localhost:8000/api/reset   # reset demo state (also in the ··· menu)
```

If `make dev` reports `EADDRINUSE`, an old server is still running. Stop it with `ss -ltnp | grep -E ':(3000|8000) '` and `kill <pid>`.

## 5. Model: main assumptions and limitations

Full detail is in `docs/model.md`. In brief:

- Monthly steps over 120 months by default. Separate partner cash accounts. Shared costs go through a joint account whose transfers cancel out.
- Moving in replaces each partner's rent, utilities and groceries, so housing is never double-counted.
- Home purchase: the deposit turns cash into equity; fees, interest and maintenance are expenses; amortisation reduces cash and debt.
- Ownership, deposit and property costs all follow the same share.
- Assumptions: tax 13% of net income (illustrative — the ledger has no tax payments); inflation 0.8% and cash interest 0% (SNB); mortgage rate 1.8%.
- Affordability is indicative: 5% imputed rate, 1% maintenance, at most ⅓ of **net** income. Gross income is unavailable, so this is stricter than a bank's test and is not a lender decision.
- Safety buffer (hard constraint): 6 months of current spending by default. Goals (soft) are funded in priority order.
- Limitations:
  - flat tax rate, with no pillar 2/3a and no marriage or imputed-rental-value effects
  - a single deterministic path (no Monte Carlo)
  - investments are a 2025 snapshot that is never sold
  - bonuses are not extrapolated

## 6. Recommendations and approvals

- **Recommendations** (`engine/recommend.py`). Single-lever and pairwise candidates (about 890 for the demo conflict) over these levers: delay purchase, lower price, deposit/ownership share, deposit %, household split, partner covers costs during a break, trimming flexible spending, shortening/delaying/part-time career breaks, and postponing goals (an explicit concession). **Each candidate is fully re-simulated**, and only candidates with no hard violation and passing accounting checks are shown. Three strategies — keep lifestyle, stay on schedule, strongest safety net — each pick one option, and the picks use disjoint levers. It takes about 1.4 s.
- **Approvals** (`store.py`). Personal changes need their owner; shared or assumption changes need both partners. The author's approval is implicit. On final approval the changes are re-applied to the *latest* plan; if they no longer validate, the proposal becomes `superseded`. Versions are kept, and "Return to this" is itself a proposal both partners must approve.

## 7. LLM integration

- Located in `app/backend/converge/ai.py`. Enabled by `ANTHROPIC_API_KEY` in `.env` (see `.env.example`). The model defaults to `claude-opus-5-5` (`CONVERGE_LLM_MODEL`). It uses `client.beta.messages.create` with `fallbacks="default"`, `output_config.effort="low"` and a JSON-schema output format.
- **Interpret:** text → `Change` list restricted to the plan's lever catalogue → validated one by one; invalid items are dropped and reported.
- **Explain:** summary of engine facts. Every number in the text must match a fact, or the engine's deterministic summary is used instead.
- With no key, or on any API error: a rule-based parser and deterministic summaries, clearly labelled in the UI. **The live path has not been run with a valid key.** The SDK parameters were checked against `anthropic` 2.12, and the 401 fallback path was tested.

## 8. Three-minute demo

See `docs/demo.md`. In short:

1. Two futures.
2. **Buy a home**, then propose and approve.
3. **Career break** for Emil, Jan 2028, 6 months → conflict, Emil CHF 17,183 short.
4. Three verified fixes → Preview → Accept.
5. Propose → Nina approves.
6. **Stress test**, mortgage 4% → breaks again (CHF 376 short) and new fixes appear.

## 9. Verification performed (at `31ec27d`)

- `make test` — **48 passed**. Covers ledger reconciliation, profile initialisation, cash-flow identity, transfers cancelling out, no double-counted housing, mortgage principal and interest, career breaks and overlap rejection, constraints, goal priority, recommendation feasibility through independent re-simulation, no-mutation/scenario isolation, approval workflow (including goal add/remove), API validation (422s), and LLM output validation and grounding.
- `make lint` and `make build` pass.
- Browser walkthrough with headless Chrome via Playwright (scripts are not committed). The whole demo path was clicked through at 1440×900: edit a budget, add a goal, buy a home → propose → approve, career break → conflict → Why? → Preview → Accept → propose → approve, stress test, free-text input. It also ran at 390×844 (mobile) with no horizontal overflow. **No console errors.**

## 10. Known weaknesses and next priorities

1. **No committed end-to-end test.** Add Playwright (`@playwright/test`) under `tests/e2e/` that replays `docs/demo.md`. Frontend logic currently has no unit tests.
2. **The LLM path was not exercised live.** Run it once with a real key and check the interpret and explain quality.
3. **Personal changes can break the shared plan unilaterally.** "Save to my plan" applies immediately (a warning is shown in Review). Consider notifying or flagging the partner.
4. **Drafts are not rebased.** Drafts live in localStorage per viewer and are relative to the agreed plan at the time. After the partner approves something else they still apply, but may conflict; only `superseded` catches invalid ones.
5. **The recommendation search is bounded** (pairs only). Combined titles can be long. The "strongest safety net" option sometimes changes two levers.
6. **Goals UI:** new goals default to medium priority, measured on cash. Priority and measure cannot be edited in the UI.
7. **Mobile:** the draft bar takes about 3 lines and covers part of the content; it could collapse to a single row.
8. **Model realism** (see section 5): tax, pensions, uncertainty bands and selling investments are the obvious extensions — but only if needed for judging.
9. Single JSON workspace with no concurrency control. Fine for a demo, not for real multi-user use.
