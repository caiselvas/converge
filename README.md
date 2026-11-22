# Converge

**Two personal financial twins, one shared plan.**
Converge helps couples make big financial decisions together — buying a home, moving in, taking a career break — without quietly sacrificing either partner's financial security.

Built for the UBS **AI Financial Twin** challenge at LauzHack 2026.

A household can afford a plan that is still personally risky for one partner. Converge keeps each partner's accounts, goals and safety buffer separate, links them through an explicit shared plan, and shows how every decision affects *each* person. When a plan breaks a constraint, a deterministic optimiser searches for realistic alternatives, re-simulates every one, and presents them as proposals both partners can preview, accept and approve.

- **Personal twins** — initialised from UBS synthetic profiles, 24 months of transactions (read straight from the ZIP and reconciled to the cash-balance file), assets and goals.
- **Couple workspace** — living together without double-counting rent, cost-sharing rules, a home purchase with deposit, mortgage, interest, maintenance and amortisation, and ownership that follows the deposit.
- **Scenarios & recommendations** — life events and stress tests are simulated instantly. A bounded search over about 900 candidate adjustments finds verified fixes, and each one shows its impact on both partners, its trade-offs and a "why".
- **Mutual approval** — personal changes need their owner; shared changes need both partners. Every agreed state is versioned and can be restored.
- **Optional AI** — Claude turns plain language into *validated, structured* plan changes and writes summaries whose numbers are checked against the engine. The app is fully functional without an API key.

> Projections are conditional on stated assumptions. They are not forecasts, and they are not financial advice. All people and records are fictional (UBS synthetic data); Nina and Emil are unrelated profiles paired for the demo.

## Quick start

Requirements: Python ≥ 3.11 with [uv](https://docs.astral.sh/uv/), Node ≥ 20, and the UBS challenge resources in `external/ubs/` (git-ignored; import with `./scripts/import_ubs.sh path/to/ubs.zip`).

```bash
make install        # uv sync + npm install
make dev            # backend on :8000 and frontend on :3000
# or, in two terminals:
make backend
make frontend
```

Open <http://localhost:3000>. The first start reads the transaction ZIP, which takes about 2 seconds, and caches per-profile aggregates in `app/backend/.cache/`.

**Optional AI:** `cp .env.example .env`, then set `ANTHROPIC_API_KEY`. Without a key, natural-language input uses a clearly labelled rule-based parser, and summaries come from the engine.

**Reset the demo:** use the `···` menu → *Reset demo to UBS starting point*, or `curl -X POST localhost:8000/api/reset`.

## Tests and checks

```bash
make test     # 47 backend tests: data reconciliation, cash-flow identities, transfers, housing,
              # mortgage, career breaks, constraints, recommendation feasibility,
              # scenario isolation, approval workflow, API validation, AI grounding
make lint     # TypeScript + ESLint
make build    # Next.js production build
```

Every simulation also checks its own accounting identities at runtime and returns them (`checks` in the API, and "All accounting checks pass" in the UI). The checks are: opening cash plus flows equals closing cash, transfers cancel at household level, net worth equals assets minus liabilities, and property/mortgage shares sum to the totals.

## Demo (3 minutes)

See [docs/demo.md](docs/demo.md) for the step-by-step script: two independent futures → buy a home together → Emil's career break creates a conflict → verified alternatives → mutual approval → mortgage-rate stress test.

## Architecture

```text
app/backend/          FastAPI + Pydantic, deterministic engine (no LLM in any calculation)
  converge/data/      UBS loaders (ZIP), ledger reconciliation, profile builder
  converge/engine/    simulate.py (monthly model), evaluate.py (constraints, goals, "why")
                      recommend.py (bounded search + re-simulation), changes.py (lever registry)
  converge/store.py   proposals, approvals, versions (JSON file in app/backend/.state/)
  converge/ai.py      Claude: NL -> validated changes; grounded summaries; offline fallback
  converge/assumptions.py   assumptions & sources registry
app/frontend/         Next.js 16 + React 19 + Tailwind 4 + Recharts
tests/backend/        pytest suite
docs/                 model and demo documentation
```

All modifications, whether from a user, the optimiser or the language model, are `Change(path, value)` objects. They are checked against a whitelist of supported levers, and the resulting plan is fully re-validated before it is simulated. The frontend applies drafts optimistically for instant feedback, but every number it displays comes from the backend.

Key endpoints: `GET /api/workspace`, `POST /api/simulate`, `POST /api/recommendations`, `POST /api/proposals`, `POST /api/proposals/{id}/approve|reject`, `GET /api/assumptions`, `GET /api/provenance/{profile}`, `POST /api/assistant/interpret|explain`. Interactive docs are at <http://localhost:8000/docs>.

## Documentation

- [docs/model.md](docs/model.md) — financial model, accounting rules, constraints, recommendation algorithm, data handling and limitations.
- [docs/demo.md](docs/demo.md) — demo script.
- In-app: `···` → *Assumptions & sources* lists every assumption with its value, kind (UBS data / published source / modelling choice) and citation.
