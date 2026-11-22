.PHONY: install backend frontend dev test lint build check

install:            ## Install backend (uv) and frontend (npm) dependencies
	cd app/backend && uv sync
	cd app/frontend && npm install

backend:            ## Run the FastAPI engine on :8000
	cd app/backend && uv run uvicorn converge.api:app --port 8000 --reload

frontend:           ## Run the Next.js app on :3000 (proxies /api to :8000)
	cd app/frontend && npm run dev -- -p 3000

dev:                ## Run both (Ctrl-C stops both)
	$(MAKE) -j2 backend frontend

test:               ## Backend test suite
	cd app/backend && uv run pytest -q

lint:               ## Frontend type-check and lint
	cd app/frontend && npx tsc --noEmit && npm run lint

build:              ## Frontend production build
	cd app/frontend && npm run build

check: test lint build
