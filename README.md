# Movie Money Tracker

A local web app for tracking what moviegoing actually costs: unlimited-subscription fees, discounted gift card loads, the occasional booking fee, and tickets bought for friends. It's money-first, not a film diary: you get monthly spend, effective cost per movie, gift card wallet balance and savings, plus movie posters via TMDB to make it pleasant to look at.

See [`docs/superpowers/specs/`](docs/superpowers/specs/) for the design spec.

## Development

Prerequisites: [uv](https://docs.astral.sh/uv/) and Node 24.

```bash
# API at http://127.0.0.1:8000
cd backend && uv sync && uv run uvicorn app.main:create_app --factory --reload

# UI with hot reload at http://localhost:5173 (second terminal)
cd frontend && npm install && npm run dev
```

For everyday use, run `cd frontend && npm run build`, then start the API and open <http://127.0.0.1:8000>.

The database is created and migrated automatically when the API starts.

Tests: `cd backend && uv run pytest` · `cd frontend && npx vitest run`

## Workflow

Issue → branch `<type>/<issue#>-<slug>` → PR with `Closes #n` → green CI → squash merge. Decisions are recorded in [`docs/adr/`](docs/adr/).
