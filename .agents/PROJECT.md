# Converge

## Goal
Help couples make major financial decisions together while preserving
each partner's financial security and future opportunities.

## Core features
1. Two independent financial profiles.
2. Shared couple finances, goals, and commitments.
3. Monthly cash-flow simulation.
4. Personal and shared financial constraints.
5. Optimised recommendations with visual before/after comparisons.
6. Approval workflow for shared decisions.
7. AI-assisted natural-language inputs and grounded explanations.

## Data
UBS synthetic Financial Twin challenge datasets.
Local reference data: `external/ubs/`

## Architecture
- `app/frontend/`: User interface
- `app/backend/`: APIs, financial simulation, optimisation, AI
- `tests/`: Automated tests
- `docs/`: Documentation
- `.agents/`: Shared context for coding agents

## Important
Financial calculations must be reproducible and explainable.
LLMs handle language and assistance, not financial arithmetic.

## Running and checking
- `make install`, `make dev` (backend :8000, frontend :3000), `make test`, `make lint`, `make build`.
- Every plan modification goes through `Change(path, value)` on the lever whitelist in
  `app/backend/converge/engine/changes.py`; add new levers there (and to `docs/model.md`).
- Model and assumptions: `docs/model.md`; demo script: `docs/demo.md`.
