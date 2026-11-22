# Converge

AI-powered financial planning for couples, built for the UBS AI Financial Twin challenge at LauzHack 2026.

**MVP 1** is a navigable dashboard over the challenge's synthetic data: pick any of the 1,200 fictional profiles and explore their overview, transactions, full financial profile and the 120 scenarios. There is no AI or simulation engine yet; the Scenarios view is the seam where one will plug in.

## Run it

Requires Python 3.10+ and Node 20+.

```bash
# 1. Put the challenge data in external/ubs/ (git-ignored; never committed)
./scripts/import_ubs.sh path/to/ai-financial-twin-lauzhack-2026-main.zip

# 2. Generate the static JSON the frontend reads (git-ignored)
python scripts/build_data.py

# 3. Start the app
cd frontend
npm install
npm run dev          # http://localhost:5173
npm run build        # production build

# Verify the generated data
python -m unittest discover -s tests
```

## Architecture

```
external/ubs/Data/*.csv, *.zip      raw challenge data, unchanged
        │  scripts/build_data.py    stdlib only; joins everything by profile_id
        ▼
frontend/public/data/
  index.json                        1,200 profiles (name, age, city, ...) for search
  scenarios.json                    the 120-scenario catalog
  profiles/P00001.json …            one file per profile: records, balances, assets,
                                    liabilities, goals, events, assumptions, transactions
        │  fetched on demand
        ▼
frontend/src
  App.tsx                           shell, profile selector, navigation, data loading
  lib/data.ts                       types, loaders, formatting, the few derived calculations
  components/kit.tsx                panel, animated number, disclosure, shared primitives
  views/{Overview,Activity,Profile,Scenarios}.tsx
```

Only the selected profile's JSON (about 90 KB) is loaded, never all 552,295 transactions. React, Vite, TypeScript, Tailwind CSS v4, shadcn/ui (`components/ui`), Motion, Recharts and Lucide; no backend, router or state library.

## Financial semantics

Every figure is derived from the records; nothing is hardcoded or generated.

- Transaction amounts are signed. Income and expenses are the positive and negative sums.
- Cash balances come from `synthetic-cash-balances.csv` (month-end closes, Jan 2025 – Dec 2026) and reconcile with the transactions. They are dataset dates, not today's balance.
- Opening assets and debts are snapshots at 1 Jan 2025, shown as such. Opening net position is assets less debt. Cash is in both the account and asset records and is counted once.
- Life events are proposed, not executed. Scenario assumptions are illustrative. Goals have no allocated funds, so no progress is shown.
- Simulation results are labelled "Not yet available"; no projection is displayed.

## Current limitations

- No simulation, recommendations, AI, or couple-level (shared vs individual) modelling yet.
- `npm run build` copies the 57 MB of generated data into `dist/`; deploy only after deciding whether to ship it.
- Light theme only.
