# M0 Foundation + M1 Ledger Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tested local backend for chains, gift card loads, visits and credits. It computes oldest-card-first effective costs, wallet balances and the spec's money metrics. Alongside it: a frontend scaffold, CI, and the GitHub workflow every later milestone uses.

**Architecture:** Monorepo with `backend/` (FastAPI, SQLAlchemy 2, Alembic, SQLite) and `frontend/` (Vite, React, TypeScript). Money rules live in `backend/app/domain/` as pure functions over frozen dataclasses: no DB, no web. The API loads the DB into a domain `Ledger`, runs the rules, and serialises the results. All money is integer cents.

**Tech Stack:** Python 3.14, uv, FastAPI, SQLAlchemy 2, Alembic, pydantic-settings, pytest, ruff, pyright · Node 24, Vite, React, TypeScript, Tailwind CSS v4, Vitest, Testing Library · GitHub Actions.

**Spec:** [`docs/superpowers/specs/2026-10-14-movie-money-tracker-design.md`](../specs/2026-10-14-movie-money-tracker-design.md). §4 (money rules) is the contract for Tasks 4–6.

## Global Constraints

- All money is stored and computed as **integer cents**. No floats anywhere in money code.
- Python `>=3.14`. Run Python commands from `backend/` via `uv run …`. Node 24.
- Every endpoint lives under `/api/v1`.
- Config comes only from env vars / `.env` at the repo root (`DATABASE_URL`, `TMDB_API_KEY`). Default DB: `<repo>/data/app.db`.
- `backend/app/domain/` must not import `sqlalchemy`, `fastapi` or anything under `app.db` / `app.api`.
- Effective cost is **oldest card first (FIFO)** with cumulative rounding (spec §4 rules 4–5). It is recomputed from the full ledger on every read and never stored.
- Dates may not be in the future (API returns 422). "Today" comes from the `get_today` dependency, so tests can pin it.
- Process: every task is a GitHub issue → branch `<type>/<issue#>-<slug>` → PR containing `Closes #<issue#>` → green CI → squash merge. Conventional commit messages. End every commit message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands are written for Git Bash on Windows. They work unchanged on macOS/Linux.

## Review Focus

1. **A gift card bought the same day as a charge.** The card must cover that day's charge, even if the charge's id is lower. *(Task 5: `test_card_bought_same_day_covers_that_days_charge`)*
2. **Spreadsheet-style dollar text** (`"$1,234.56"`, `"0.5"`, `"-$7.17"`, blank, `"1.234"`). These must parse exactly or raise `ValueError`, never round silently. *(Task 4: `test_parse_dollars*`)*
3. **Deleting a chain that still has entries.** Must return 409 with a clear message, not a 500, and must not orphan rows. *(Task 8: `test_delete_chain_with_entries_conflicts`)*
4. **Logging a visit on today's date vs a typo'd future date.** Today is accepted, tomorrow is a 422 on `date`. *(Task 10: `test_visit_dated_today_ok_tomorrow_rejected`)*
5. **Adding "regal" when "Regal" exists**, or a name with stray spaces. Names are trimmed, and a case-insensitive duplicate returns 409. *(Task 8: `test_chain_name_is_trimmed_and_unique_ignoring_case`)*

## Task → issue map

The **Issue** column is filled in when the issues are created. Branch = `<type>/<issue#>-<slug>`.

| Task | Milestone | Type | Slug | Issue |
| --- | --- | --- | --- | --- |
| 1 Backend scaffold | M0 | chore | backend-scaffold | |
| 2 Frontend scaffold | M0 | chore | frontend-scaffold | |
| 3 CI, templates, ADR | M0 | chore | ci-and-templates | |
| 4 Money primitives | M1 | feat | money-primitives | |
| 5 FIFO allocation + wallet | M1 | feat | fifo-allocation | |
| 6 Metrics | M1 | feat | money-metrics | |
| 7 DB models + migrations | M1 | feat | db-models | |
| 8 Chains API | M1 | feat | chains-api | |
| 9 Gift cards API | M1 | feat | gift-cards-api | |
| 10 Visits + credits API | M1 | feat | visits-credits-api | |
| 11 Activity + wallets API | M1 | feat | activity-wallets-api | |

**Every task starts with:**

```bash
git switch main && git pull --ff-only
git switch -c <type>/<issue#>-<slug>
```

**and ends with:**

```bash
git push -u origin HEAD
gh pr create --fill --body "Closes #<issue#>"   # then edit the body using the PR template
```

Merge only when CI is green (from Task 3 onward CI is required).

## File structure (end state of this plan)

```text
backend/
  pyproject.toml, uv.lock, .python-version, alembic.ini
  app/
    main.py              create_app(settings) factory + SPA static serving
    config.py            Settings (pydantic-settings), get_settings()
    domain/
      money.py           Cents, parse_dollars, format_cents, div_round_half_up
      types.py           PaymentSource, CreditDestination, Chain, GiftCardLoad, FeeCharge, Visit, Credit, Ledger
      allocation.py      allocate(ledger) -> Allocation (FIFO)
      wallet.py          wallet_balance, runway
      metrics.py         Period, cash_out, visit_count, cost_per_movie, guest_spend, gift_card_discount, unlimited_savings
    db/
      base.py            Base (naming convention)
      models.py          ORM: Chain, GiftCardLoad, Visit, Credit
      session.py         make_engine
    api/
      deps.py            SessionDep, TodayDep, get_or_404, require_chain, reject_future
      v1/
        __init__.py      api_router
        health.py, chains.py, gift_cards.py, visits.py, credits.py, activity.py, wallets.py
    services/
      ledger.py          load_ledger(session) -> Ledger
  migrations/            Alembic env + versions
  tests/
    conftest.py
    domain/ test_money.py, test_allocation.py, test_wallet.py, test_metrics.py
    test_health.py, test_spa.py, test_db.py, test_chains_api.py, test_gift_cards_api.py,
    test_visits_api.py, test_credits_api.py, test_activity_api.py
frontend/                Vite react-ts app (Task 2)
.github/workflows/ci.yml, .github/pull_request_template.md, .github/ISSUE_TEMPLATE/*
docs/adr/0001-stack.md
.env.example
```

---

### Task 1: Backend scaffold

Move the root `uv` project into `backend/` and create a FastAPI app factory with a health endpoint. The app also serves a built SPA when one exists.

**Files:**
- Move: `pyproject.toml` → `backend/pyproject.toml`, `.python-version` → `backend/.python-version`
- Delete: `main.py`
- Create: `backend/app/__init__.py`, `backend/app/config.py`, `backend/app/main.py`, `backend/app/api/__init__.py`, `backend/app/api/v1/__init__.py`, `backend/app/api/v1/health.py`
- Test: `backend/tests/__init__.py`, `backend/tests/conftest.py`, `backend/tests/test_health.py`, `backend/tests/test_spa.py`

**Interfaces:**
- Produces: `app.config.Settings` (fields `database_url: str`, `frontend_dist: Path | None`, `tmdb_api_key: str | None`), `app.config.get_settings() -> Settings`, `app.config.REPO_ROOT: Path`, `app.main.create_app(settings: Settings | None = None) -> FastAPI`, `app.api.v1.api_router: APIRouter`. Run with `uv run uvicorn app.main:create_app --factory`.

- [ ] **Step 1: Move the project and add dependencies**

```bash
mkdir -p backend
git mv pyproject.toml backend/pyproject.toml
git mv .python-version backend/.python-version
git rm -q main.py
```

Replace `backend/pyproject.toml` with:

```toml
[project]
name = "movie-money-tracker"
version = "0.1.0"
description = "Track the money spent on moviegoing: subscriptions, gift cards, and tickets"
requires-python = ">=3.14"
dependencies = []

[tool.uv]
package = false

[tool.ruff]
line-length = 100
target-version = "py314"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]
ignore = ["E501"]  # line length is the formatter's job

[tool.pyright]
pythonVersion = "3.14"
typeCheckingMode = "standard"
venvPath = "."
venv = ".venv"

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

Then:

```bash
cd backend
uv add fastapi "uvicorn[standard]" pydantic-settings
uv add --dev pytest httpx ruff pyright
```

Expected: `uv.lock` is created and `.venv/` is populated.

- [ ] **Step 2: Write the failing tests**

`backend/tests/__init__.py`: empty file.

`backend/tests/conftest.py`:

```python
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        frontend_dist=None,
    )


@pytest.fixture
def client(settings: Settings):
    with TestClient(create_app(settings)) as c:
        yield c
```

`backend/tests/test_health.py`:

```python
from fastapi.testclient import TestClient


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

`backend/tests/test_spa.py`:

```python
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def _settings(tmp_path: Path, dist: Path | None) -> Settings:
    return Settings(
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}", frontend_dist=dist
    )


def test_serves_index_for_root_and_deep_links(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>spa</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")

    with TestClient(create_app(_settings(tmp_path, dist))) as client:
        assert "spa" in client.get("/").text
        assert "spa" in client.get("/films/42").text
        assert client.get("/assets/app.js").text == "console.log(1)"
        assert client.get("/api/v1/health").json() == {"status": "ok"}
        assert client.get("/api/v1/does-not-exist").status_code == 404


def test_without_a_build_only_the_api_is_served(tmp_path: Path) -> None:
    with TestClient(create_app(_settings(tmp_path, None))) as client:
        assert client.get("/").status_code == 404
        assert client.get("/api/v1/health").status_code == 200
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `uv run pytest -q`
Expected: collection errors with `ModuleNotFoundError: No module named 'app'`.

- [ ] **Step 4: Implement**

`backend/app/__init__.py`, `backend/app/api/__init__.py`: empty files.

`backend/app/config.py`:

```python
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    database_url: str = f"sqlite:///{(REPO_ROOT / 'data' / 'app.db').as_posix()}"
    frontend_dist: Path | None = REPO_ROOT / "frontend" / "dist"
    tmdb_api_key: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

`backend/app/api/v1/health.py`:

```python
from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

`backend/app/api/v1/__init__.py`:

```python
from fastapi import APIRouter

from app.api.v1 import health

api_router = APIRouter()
api_router.include_router(health.router)
```

`backend/app/main.py`:

```python
from fastapi import FastAPI
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from app.api.v1 import api_router
from app.config import Settings, get_settings


class SPAStaticFiles(StaticFiles):
    """Serve the built frontend; unknown non-API paths fall back to index.html."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and not path.startswith("api"):
                return await super().get_response("index.html", scope)
            raise


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Movie Money Tracker")
    app.include_router(api_router, prefix="/api/v1")

    dist = settings.frontend_dist
    if dist is not None and (dist / "index.html").is_file():
        app.mount("/", SPAStaticFiles(directory=dist, html=True), name="frontend")
    return app
```

- [ ] **Step 5: Run the tests and checks**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run pyright`
Expected: `3 passed`, ruff clean, `0 errors`. If `ruff format --check` complains, run `uv run ruff format .` and re-run.

- [ ] **Step 6: Smoke-run and commit**

Run: `uv run uvicorn app.main:create_app --factory` and open http://127.0.0.1:8000/api/v1/health. Expected: `{"status":"ok"}`. Stop the server with Ctrl+C.

```bash
cd ..
git add -A
git commit -m "chore: scaffold FastAPI backend with health endpoint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Frontend scaffold

A Vite React TS app with Tailwind, a Vitest setup, and a dev proxy to the API. It shows the API health so the wiring is visible.

**Files:**
- Create: `frontend/` (from the Vite template), `frontend/src/test/setup.ts`, `frontend/src/App.test.tsx`
- Modify: `frontend/vite.config.ts`, `frontend/src/App.tsx`, `frontend/src/index.css`, `frontend/src/main.tsx`, `frontend/package.json`
- Delete: `frontend/src/App.css`, `frontend/src/assets/`, `frontend/public/vite.svg`

**Interfaces:**
- Consumes: `GET /api/v1/health` → `{"status": "ok"}` (Task 1).
- Produces: `npm run dev` (port 5173, proxies `/api` to `127.0.0.1:8000`), `npm run build` → `frontend/dist`, `npx vitest run`.

- [ ] **Step 1: Generate the app and install test/styling deps**

```bash
npm create vite@latest frontend -- --template react-ts
```

If prompted "Install with npm and start now?", answer **No**.

```bash
cd frontend
npm install
npm install -D tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
rm -rf src/App.css src/assets public/vite.svg
```

In `package.json` `"scripts"`, add `"test": "vitest"`.

- [ ] **Step 2: Configure Vite, Tailwind and Vitest**

`frontend/vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
```

`frontend/src/index.css` (replace everything):

```css
@import "tailwindcss";
```

`frontend/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())
```

Make sure `frontend/src/main.tsx` imports `./index.css` and renders `<App />` (the template already does). Remove the `<link rel="icon" …vite.svg>` line from `frontend/index.html` and set `<title>Movie Money Tracker</title>`.

- [ ] **Step 3: Write the failing test**

`frontend/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('shows the API as ok when the health check succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'ok' }) }),
    )
    render(<App />)
    expect(await screen.findByText('API: ok')).toBeInTheDocument()
  })

  it('shows the API as down when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<App />)
    expect(await screen.findByText('API: down')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run`
Expected: FAIL. The template App has no "API: ok" text.

- [ ] **Step 5: Implement**

`frontend/src/App.tsx`:

```tsx
import { useEffect, useState } from 'react'

type ApiStatus = 'checking' | 'ok' | 'down'

export default function App() {
  const [status, setStatus] = useState<ApiStatus>('checking')

  useEffect(() => {
    fetch('/api/v1/health')
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
      )
      .then((body: { status: string }) => setStatus(body.status === 'ok' ? 'ok' : 'down'))
      .catch(() => setStatus('down'))
  }, [])

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-neutral-100">
      <h1 className="text-2xl font-semibold">Movie Money Tracker</h1>
      <p className="mt-2 text-sm text-neutral-400">API: {status}</p>
    </main>
  )
}
```

- [ ] **Step 6: Run tests, lint, type-check and build**

Run: `npx vitest run && npm run lint && npx tsc -b && npm run build`
Expected: 2 tests pass, lint clean, no TS errors, `dist/` built.

- [ ] **Step 7: End-to-end check through the backend and commit**

```bash
cd ../backend && uv run uvicorn app.main:create_app --factory
```

Open http://127.0.0.1:8000/. Expected: "Movie Money Tracker" with "API: ok". Stop the server.

```bash
cd ..
git add -A
git commit -m "chore: scaffold React frontend with API health check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: CI, issue/PR templates, ADR-001, README

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/feature.yml`, `.github/ISSUE_TEMPLATE/bug.yml`, `.github/ISSUE_TEMPLATE/chore.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `docs/adr/0001-stack.md`, `.env.example`
- Modify: `README.md`

**Interfaces:**
- Produces: required status checks named **`backend`** and **`frontend`** on `main`.

- [ ] **Step 1: CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  backend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - run: uv sync --locked
      - run: uv run ruff check .
      - run: uv run ruff format --check .
      - run: uv run pyright
      - run: uv run pytest -q

  frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npx tsc -b
      - run: npx vitest run
```

- [ ] **Step 2: Templates**

`.github/pull_request_template.md`:

```markdown
Closes #

## What

## Why

## How I tested

- [ ] `cd backend && uv run pytest`
- [ ] `cd frontend && npx vitest run`
- [ ] Manually checked:

## Checklist

- [ ] Branch is `<type>/<issue#>-<slug>`
- [ ] Spec or ADR updated if behaviour or a decision changed
```

`.github/ISSUE_TEMPLATE/feature.yml`:

```yaml
name: Feature
description: A capability someone using the app will notice
labels: ["type:feature"]
body:
  - type: textarea
    id: goal
    attributes:
      label: Goal
      description: What should be possible once this ships?
    validations:
      required: true
  - type: textarea
    id: acceptance
    attributes:
      label: Acceptance criteria
      value: "- [ ] "
    validations:
      required: true
  - type: input
    id: spec
    attributes:
      label: Spec section
      placeholder: "§5.3"
```

`.github/ISSUE_TEMPLATE/bug.yml`:

```yaml
name: Bug
description: Something behaves differently from the spec or from what you'd expect
labels: ["type:bug"]
body:
  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected vs actual
    validations:
      required: true
```

`.github/ISSUE_TEMPLATE/chore.yml`:

```yaml
name: Chore
description: Tooling, CI, dependencies, refactors with no behaviour change
labels: ["type:chore"]
body:
  - type: textarea
    id: what
    attributes:
      label: What and why
    validations:
      required: true
  - type: textarea
    id: done
    attributes:
      label: Done when
      value: "- [ ] "
```

`.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: false
```

- [ ] **Step 3: ADR, env example, README**

`docs/adr/0001-stack.md`:

```markdown
# ADR-0001: Stack and money representation

- Status: Accepted
- Date: 2026-10-15

## Context

A single-user, local-first app that must be easy to host later. Its core value is correct money arithmetic.

## Decision

- Backend: FastAPI + SQLAlchemy 2 + Alembic on SQLite. One process serves both the API and the built SPA.
- Frontend: React + TypeScript (Vite), Tailwind, TanStack Query, Recharts.
- Money is integer cents end to end. Gift card spending is costed oldest-card-first, with cumulative rounding.
- Money rules are pure functions in `backend/app/domain/`, isolated from I/O.

## Consequences

- Two toolchains (uv, npm) and two test suites, both run in CI.
- Hosting later means swapping `DATABASE_URL` and adding auth. No app restructure.
- Effective costs are recomputed from the whole ledger on each request. That's fine at personal scale (hundreds of rows).
```

`.env.example`:

```dotenv
# Copy to .env (gitignored). All settings are optional.
# DATABASE_URL=sqlite:///C:/dev/movie-money-tracker/data/app.db
# TMDB_API_KEY=
```

Append to `README.md`:

````markdown
## Development

Prerequisites: [uv](https://docs.astral.sh/uv/) and Node 24.

```bash
# API (http://127.0.0.1:8000)
cd backend && uv sync && uv run uvicorn app.main:create_app --factory --reload

# UI with hot reload (http://localhost:5173), in a second terminal
cd frontend && npm install && npm run dev
```

Everyday use: `cd frontend && npm run build`, then start the API and open http://127.0.0.1:8000.

Tests: `cd backend && uv run pytest` · `cd frontend && npx vitest run`

## Workflow

Issue → branch `<type>/<issue#>-<slug>` → PR with `Closes #n` → green CI → squash merge. Decisions live in [`docs/adr/`](docs/adr/).
````

- [ ] **Step 4: Commit, push, open PR, confirm CI**

```bash
git add -A
git commit -m "chore: add CI, issue/PR templates, ADR-0001 and dev docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin HEAD
gh pr create --fill --body "Closes #<issue#>"
gh pr checks --watch
```

Expected: `backend` and `frontend` both pass.

- [ ] **Step 5: Make the checks required on `main`**

```bash
cat > "$TMPDIR/protection.json" <<'EOF'
{"required_status_checks":{"strict":true,"contexts":["backend","frontend"]},
 "enforce_admins":true,
 "required_pull_request_reviews":{"required_approving_review_count":0},
 "restrictions":null,"allow_force_pushes":false,"allow_deletions":false,
 "required_linear_history":true}
EOF
gh api -X PUT repos/trishalmuthan/movie-money-tracker/branches/main/protection --input "$TMPDIR/protection.json" --jq '.required_status_checks.contexts'
```

Expected: `["backend","frontend"]`. (If `$TMPDIR` is unset, use any scratch path.) Then squash-merge the PR.

---

### Task 4: Money primitives

**Files:**
- Create: `backend/app/domain/__init__.py`, `backend/app/domain/money.py`
- Test: `backend/tests/domain/__init__.py`, `backend/tests/domain/test_money.py`

**Interfaces:**
- Produces: `type Cents = int`; `parse_dollars(text: str) -> Cents` (raises `ValueError`); `format_cents(amount: Cents) -> str`; `div_round_half_up(numerator: int, denominator: int) -> int` (numerator ≥ 0, denominator > 0, else `ValueError`).

- [ ] **Step 1: Write the failing tests**

`backend/app/domain/__init__.py`, `backend/tests/domain/__init__.py`: empty files.

`backend/tests/domain/test_money.py`:

```python
import pytest

from app.domain.money import div_round_half_up, format_cents, parse_dollars


@pytest.mark.parametrize(
    ("text", "cents"),
    [
        ("5.99", 599),
        ("$5.99", 599),
        (" 0.50 ", 50),
        ("0.5", 50),
        ("35", 3500),
        ("0.00", 0),
        ("-7.17", -717),
        ("-$7.17", -717),
        ("$1,234.56", 123456),
    ],
)
def test_parse_dollars(text: str, cents: int) -> None:
    assert parse_dollars(text) == cents


@pytest.mark.parametrize("text", ["", "   ", "abc", "1.234", "5.99.1", "$", "1,23.00", "--5"])
def test_parse_dollars_rejects_non_amounts(text: str) -> None:
    with pytest.raises(ValueError):
        parse_dollars(text)


@pytest.mark.parametrize(
    ("cents", "text"),
    [(599, "$5.99"), (0, "$0.00"), (-717, "-$7.17"), (123456, "$1,234.56"), (5, "$0.05")],
)
def test_format_cents(cents: int, text: str) -> None:
    assert format_cents(cents) == text


@pytest.mark.parametrize(
    ("num", "den", "expected"),
    [(4193, 10, 419), (5, 10, 1), (4, 10, 0), (2213, 3, 738), (0, 7, 0), (15, 10, 2)],
)
def test_div_round_half_up(num: int, den: int, expected: int) -> None:
    assert div_round_half_up(num, den) == expected


def test_div_round_half_up_rejects_bad_input() -> None:
    with pytest.raises(ValueError):
        div_round_half_up(-1, 3)
    with pytest.raises(ValueError):
        div_round_half_up(1, 0)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/domain/test_money.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.domain.money'`.

- [ ] **Step 3: Implement**

`backend/app/domain/money.py`:

```python
"""Money primitives. Every amount in the app is an integer number of cents."""

import re

type Cents = int

_DOLLARS = re.compile(r"^(-)?\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$")


def parse_dollars(text: str) -> Cents:
    """Parse "$1,234.56", "0.5", "-7.17" etc. into cents. Raises ValueError otherwise."""
    match = _DOLLARS.match(text.strip())
    if match is None:
        raise ValueError(f"Not a dollar amount: {text!r}")
    sign, whole, fraction = match.groups()
    cents = int(whole.replace(",", "")) * 100 + int((fraction or "0").ljust(2, "0"))
    return -cents if sign else cents


def format_cents(amount: Cents) -> str:
    sign = "-" if amount < 0 else ""
    dollars, cents = divmod(abs(amount), 100)
    return f"{sign}${dollars:,}.{cents:02d}"


def div_round_half_up(numerator: int, denominator: int) -> int:
    """numerator / denominator rounded to the nearest integer, halves rounding up."""
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    if numerator < 0:
        raise ValueError("numerator must be non-negative")
    return (2 * numerator + denominator) // (2 * denominator)
```

- [ ] **Step 4: Run tests and checks**

Run: `uv run pytest tests/domain -q && uv run ruff check . && uv run pyright`
Expected: all pass, `0 errors`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add money primitives (cents parsing, formatting, rounding)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Domain types, FIFO allocation and wallet balance

Implements spec §4 rules 2–5.

**Files:**
- Create: `backend/app/domain/types.py`, `backend/app/domain/allocation.py`, `backend/app/domain/wallet.py`
- Test: `backend/tests/domain/test_allocation.py`, `backend/tests/domain/test_wallet.py`

**Interfaces:**
- Consumes: `Cents`, `div_round_half_up` (Task 4).
- Produces:
  - `PaymentSource` (StrEnum: `GIFT_CARD="gift_card"`, `BANK="bank"`, `FREE="free"`), `CreditDestination` (StrEnum: `GIFT_CARD`, `BANK`).
  - Frozen dataclasses with positional fields in this order:
    - `Chain(id, name, standard_ticket_price)`
    - `GiftCardLoad(id, chain_id, date, price_paid, face_value)`
    - `FeeCharge(id, chain_id, date, amount, payment_source)`
    - `Visit(id, chain_id, date, my_cost, guest_count, guest_cost, payment_source)`
    - `Credit(id, chain_id: int | None, date, amount, destination)`
    - `Ledger(chains=(), loads=(), fees=(), visits=(), credits=())`, all fields tuples.
  - `SpendKey = tuple[Literal["fee", "visit", "guest"], int]`. `"visit"` is a visit's `my_cost`, `"guest"` is its `guest_cost`.
  - `allocate(ledger: Ledger) -> Allocation`. `Allocation` has `effective: dict[SpendKey, Cents]` (gift-card-paid spends only), `uncovered: dict[SpendKey, Cents]` (only keys > 0), `uncovered_by_chain: dict[int, Cents]` and `effective_cost(key, amount, source) -> Cents`.
  - `wallet_balance(ledger, chain_id, as_of: date | None = None) -> Cents`, `runway(balance: Cents, monthly_fee: Cents) -> int | None`.

- [ ] **Step 1: Write the types (no behaviour to test on their own)**

`backend/app/domain/types.py`:

```python
"""Plain, immutable inputs to the money rules (spec §3). No I/O here."""

import datetime as dt
from dataclasses import dataclass
from enum import StrEnum

from app.domain.money import Cents


class PaymentSource(StrEnum):
    GIFT_CARD = "gift_card"
    BANK = "bank"
    FREE = "free"


class CreditDestination(StrEnum):
    GIFT_CARD = "gift_card"
    BANK = "bank"


@dataclass(frozen=True, slots=True)
class Chain:
    id: int
    name: str
    standard_ticket_price: Cents


@dataclass(frozen=True, slots=True)
class GiftCardLoad:
    id: int
    chain_id: int
    date: dt.date
    price_paid: Cents
    face_value: Cents


@dataclass(frozen=True, slots=True)
class FeeCharge:
    id: int
    chain_id: int
    date: dt.date
    amount: Cents
    payment_source: PaymentSource


@dataclass(frozen=True, slots=True)
class Visit:
    id: int
    chain_id: int
    date: dt.date
    my_cost: Cents
    guest_count: int
    guest_cost: Cents
    payment_source: PaymentSource


@dataclass(frozen=True, slots=True)
class Credit:
    id: int
    chain_id: int | None
    date: dt.date
    amount: Cents
    destination: CreditDestination


@dataclass(frozen=True, slots=True)
class Ledger:
    chains: tuple[Chain, ...] = ()
    loads: tuple[GiftCardLoad, ...] = ()
    fees: tuple[FeeCharge, ...] = ()
    visits: tuple[Visit, ...] = ()
    credits: tuple[Credit, ...] = ()
```

- [ ] **Step 2: Write the failing allocation tests**

`backend/tests/domain/test_allocation.py`:

```python
import datetime as dt

from app.domain.allocation import allocate
from app.domain.types import (
    Credit,
    CreditDestination,
    FeeCharge,
    GiftCardLoad,
    Ledger,
    PaymentSource,
    Visit,
)

GC = PaymentSource.GIFT_CARD
REGAL = 1
JAN1, JAN22 = dt.date(2026, 1, 1), dt.date(2026, 1, 22)
FEB1, FEB15, FEB22 = dt.date(2026, 2, 1), dt.date(2026, 2, 15), dt.date(2026, 2, 22)


def load(id: int, day: dt.date, paid: int, face: int, chain: int = REGAL) -> GiftCardLoad:
    return GiftCardLoad(id, chain, day, paid, face)


def fee(
    id: int, day: dt.date, amount: int = 599, source: PaymentSource = GC, chain: int = REGAL
) -> FeeCharge:
    return FeeCharge(id, chain, day, amount, source)


def test_fee_paid_from_discounted_card_costs_its_discounted_value() -> None:
    alloc = allocate(Ledger(loads=(load(1, JAN1, 3500, 5000),), fees=(fee(1, JAN22),)))
    assert alloc.effective[("fee", 1)] == 419  # 599 x 0.70 = 419.3
    assert alloc.uncovered == {}


def test_later_card_never_changes_an_already_covered_charge() -> None:
    first = Ledger(loads=(load(1, JAN1, 3500, 5000),), fees=(fee(1, JAN22),))
    later = Ledger(
        loads=(load(1, JAN1, 3500, 5000), load(2, dt.date(2026, 5, 1), 4500, 5000)),
        fees=(fee(1, JAN22),),
    )
    assert allocate(first).effective[("fee", 1)] == 419
    assert allocate(later).effective[("fee", 1)] == 419


def test_charge_spanning_two_cards_uses_each_cards_rate() -> None:
    ledger = Ledger(
        loads=(load(1, JAN1, 3500, 5000), load(2, FEB1, 4500, 5000)),
        fees=(fee(1, JAN22, amount=4800), fee(2, FEB22, amount=599)),
    )
    alloc = allocate(ledger)
    assert alloc.effective[("fee", 1)] == 3360
    assert alloc.effective[("fee", 2)] == 140 + 359  # $2.00 at 0.70 + $3.99 at 0.90


def test_fully_used_card_costs_exactly_its_price() -> None:
    fees = tuple(fee(i, dt.date(2026, i, 22), amount=1000) for i in (1, 2, 3))
    alloc = allocate(Ledger(loads=(load(1, JAN1, 1000, 3000),), fees=fees))
    costs = [alloc.effective[("fee", i)] for i in (1, 2, 3)]
    assert costs == [333, 334, 333]
    assert sum(costs) == 1000


def test_card_bought_same_day_covers_that_days_charge() -> None:
    # Load id is higher than the fee id: date-then-id ordering alone would get this wrong.
    alloc = allocate(Ledger(loads=(load(7, JAN22, 3500, 5000),), fees=(fee(1, JAN22),)))
    assert alloc.effective[("fee", 1)] == 419
    assert alloc.uncovered == {}


def test_charge_with_no_card_money_is_uncovered_at_face() -> None:
    alloc = allocate(Ledger(fees=(fee(1, JAN22),)))
    assert alloc.effective[("fee", 1)] == 599
    assert alloc.uncovered == {("fee", 1): 599}
    assert alloc.uncovered_by_chain == {REGAL: 599}


def test_later_card_pays_off_overdraft_first() -> None:
    alloc = allocate(
        Ledger(loads=(load(1, FEB1, 3500, 5000),), fees=(fee(1, JAN22), fee(2, FEB22)))
    )
    assert alloc.effective[("fee", 1)] == 419  # re-costed at the new card's rate
    assert alloc.effective[("fee", 2)] == 420  # cumulative: round(838.6) - 419
    assert alloc.uncovered == {}
    assert alloc.uncovered_by_chain == {}


def test_visit_cost_is_split_between_my_ticket_and_guests() -> None:
    visit = Visit(5, REGAL, FEB15, my_cost=650, guest_count=3, guest_cost=1950, payment_source=GC)
    alloc = allocate(Ledger(loads=(load(1, JAN1, 3500, 5000),), visits=(visit,)))
    assert alloc.effective[("visit", 5)] == 455
    assert alloc.effective[("guest", 5)] == 1365


def test_gift_card_credit_is_balance_that_cost_nothing() -> None:
    credit = Credit(1, REGAL, JAN1, 717, CreditDestination.GIFT_CARD)
    alloc = allocate(Ledger(credits=(credit,), fees=(fee(1, JAN22),)))
    assert alloc.effective[("fee", 1)] == 0
    assert alloc.uncovered == {}


def test_bank_and_free_entries_do_not_touch_the_wallet() -> None:
    ledger = Ledger(
        loads=(load(1, JAN1, 3500, 5000),),
        fees=(fee(1, JAN22, source=PaymentSource.BANK),),
        visits=(Visit(1, REGAL, FEB1, 0, 0, 0, PaymentSource.FREE),),
    )
    alloc = allocate(ledger)
    assert alloc.effective == {}
    assert alloc.effective_cost(("fee", 1), 599, PaymentSource.BANK) == 599
    assert alloc.effective_cost(("visit", 1), 0, PaymentSource.FREE) == 0


def test_chains_have_separate_wallets() -> None:
    ledger = Ledger(loads=(load(1, JAN1, 3500, 5000, chain=1),), fees=(fee(1, JAN22, chain=2),))
    alloc = allocate(ledger)
    assert alloc.effective[("fee", 1)] == 599
    assert alloc.uncovered_by_chain == {2: 599}
```

- [ ] **Step 3: Run to verify failure**

Run: `uv run pytest tests/domain/test_allocation.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.domain.allocation'`.

- [ ] **Step 4: Implement allocation**

`backend/app/domain/allocation.py`:

```python
"""Oldest-card-first gift card allocation (spec §4 rules 4-5).

Each chain's wallet is a queue of lots (gift card loads and gift-card credits).
Gift-card-paid spends join a queue of debts in date order and draw from the
oldest lot with money left. A lot's cost is rounded cumulatively, so a fully
used lot's draws add up to exactly its price paid. Debt that no lot covers is
costed at face and reported as uncovered until a later lot pays it off.
"""

import datetime as dt
from collections import deque
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Literal

from app.domain.money import Cents, div_round_half_up
from app.domain.types import CreditDestination, Ledger, PaymentSource

type SpendKind = Literal["fee", "visit", "guest"]
type SpendKey = tuple[SpendKind, int]

_LOAD, _CREDIT, _SPEND = 0, 1, 2  # same-day order: money arrives before it is spent


@dataclass(frozen=True, slots=True)
class Allocation:
    effective: dict[SpendKey, Cents]
    uncovered: dict[SpendKey, Cents]
    uncovered_by_chain: dict[int, Cents]

    def effective_cost(self, key: SpendKey, amount: Cents, source: PaymentSource) -> Cents:
        """Effective cost of any spend: allocated if gift-card-paid, otherwise face."""
        if source is PaymentSource.GIFT_CARD:
            return self.effective.get(key, 0)
        return amount


@dataclass(slots=True)
class _Lot:
    price_paid: Cents
    face_value: Cents
    used: Cents = 0

    @property
    def remaining(self) -> Cents:
        return self.face_value - self.used

    def draw(self, wanted: Cents) -> tuple[Cents, Cents]:
        """Take up to `wanted` face value; return (taken, cost of what was taken)."""
        taken = min(wanted, self.remaining)
        before = self._cost_at(self.used)
        self.used += taken
        return taken, self._cost_at(self.used) - before

    def _cost_at(self, used: Cents) -> Cents:
        return div_round_half_up(used * self.price_paid, self.face_value)


@dataclass(slots=True)
class _Debt:
    key: SpendKey
    remaining: Cents


@dataclass(frozen=True, slots=True)
class _Event:
    date: dt.date
    rank: int
    seq: tuple[int, ...]
    chain_id: int
    lot: _Lot | None = None
    key: SpendKey | None = None
    amount: Cents = 0


def allocate(ledger: Ledger) -> Allocation:
    effective: dict[SpendKey, Cents] = {}
    lots: dict[int, deque[_Lot]] = {}
    debts: dict[int, deque[_Debt]] = {}

    for event in sorted(_events(ledger), key=lambda e: (e.date, e.rank, e.seq)):
        chain_lots = lots.setdefault(event.chain_id, deque())
        chain_debts = debts.setdefault(event.chain_id, deque())
        if event.lot is not None:
            chain_lots.append(event.lot)
        else:
            assert event.key is not None
            effective[event.key] = 0
            chain_debts.append(_Debt(event.key, event.amount))
        _settle(chain_debts, chain_lots, effective)

    uncovered: dict[SpendKey, Cents] = {}
    uncovered_by_chain: dict[int, Cents] = {}
    for chain_id, chain_debts in debts.items():
        for debt in chain_debts:
            effective[debt.key] += debt.remaining
            uncovered[debt.key] = debt.remaining
            uncovered_by_chain[chain_id] = uncovered_by_chain.get(chain_id, 0) + debt.remaining
    return Allocation(effective, uncovered, uncovered_by_chain)


def _settle(debts: deque[_Debt], lots: deque[_Lot], effective: dict[SpendKey, Cents]) -> None:
    while debts and lots:
        debt, lot = debts[0], lots[0]
        taken, cost = lot.draw(debt.remaining)
        effective[debt.key] += cost
        debt.remaining -= taken
        if lot.remaining == 0:
            lots.popleft()
        if debt.remaining == 0:
            debts.popleft()


def _events(ledger: Ledger) -> Iterator[_Event]:
    for load in ledger.loads:
        lot = _Lot(load.price_paid, load.face_value)
        yield _Event(load.date, _LOAD, (load.id,), load.chain_id, lot=lot)
    for credit in ledger.credits:
        if credit.destination is CreditDestination.GIFT_CARD:
            if credit.chain_id is None:
                raise ValueError(f"Gift card credit {credit.id} has no chain")
            lot = _Lot(0, credit.amount)
            yield _Event(credit.date, _CREDIT, (credit.id,), credit.chain_id, lot=lot)
    for fee in ledger.fees:
        if fee.payment_source is PaymentSource.GIFT_CARD and fee.amount > 0:
            yield _Event(
                fee.date, _SPEND, (0, fee.id, 0), fee.chain_id, key=("fee", fee.id), amount=fee.amount
            )
    for visit in ledger.visits:
        if visit.payment_source is not PaymentSource.GIFT_CARD:
            continue
        if visit.my_cost > 0:
            yield _Event(
                visit.date, _SPEND, (1, visit.id, 0), visit.chain_id,
                key=("visit", visit.id), amount=visit.my_cost,
            )
        if visit.guest_cost > 0:
            yield _Event(
                visit.date, _SPEND, (1, visit.id, 1), visit.chain_id,
                key=("guest", visit.id), amount=visit.guest_cost,
            )
```

(After writing, run `uv run ruff format .`. It may reflow the `_Event(...)` calls. Accept its output.)

- [ ] **Step 5: Run allocation tests**

Run: `uv run pytest tests/domain/test_allocation.py -q`
Expected: `11 passed`.

- [ ] **Step 6: Write the failing wallet tests**

`backend/tests/domain/test_wallet.py`:

```python
import datetime as dt

from app.domain.types import (
    Credit,
    CreditDestination,
    FeeCharge,
    GiftCardLoad,
    Ledger,
    PaymentSource,
    Visit,
)
from app.domain.wallet import runway, wallet_balance

GC, BANK = PaymentSource.GIFT_CARD, PaymentSource.BANK
REGAL = 1
JAN1, JAN22, JAN31 = dt.date(2026, 1, 1), dt.date(2026, 1, 22), dt.date(2026, 1, 31)
FEB1, FEB15, FEB22 = dt.date(2026, 2, 1), dt.date(2026, 2, 15), dt.date(2026, 2, 22)

LEDGER = Ledger(
    loads=(GiftCardLoad(1, REGAL, JAN1, 3500, 5000),),
    credits=(
        Credit(1, REGAL, FEB1, 717, CreditDestination.GIFT_CARD),
        Credit(2, REGAL, FEB1, 300, CreditDestination.BANK),
    ),
    fees=(FeeCharge(1, REGAL, JAN22, 599, GC), FeeCharge(2, REGAL, FEB22, 599, BANK)),
    visits=(Visit(1, REGAL, FEB15, 650, 3, 1950, GC),),
)


def test_balance_is_face_value_plus_credits_minus_gift_card_spending() -> None:
    assert wallet_balance(LEDGER, REGAL) == 5000 + 717 - 599 - 650 - 1950


def test_balance_as_of_a_date_ignores_later_entries() -> None:
    assert wallet_balance(LEDGER, REGAL, as_of=JAN31) == 5000 - 599


def test_balance_can_go_negative() -> None:
    ledger = Ledger(fees=(FeeCharge(1, REGAL, JAN22, 599, GC),))
    assert wallet_balance(ledger, REGAL) == -599


def test_other_chains_do_not_count() -> None:
    assert wallet_balance(LEDGER, chain_id=2) == 0


def test_runway_is_whole_months_of_fees_left() -> None:
    assert runway(1200, 599) == 2
    assert runway(-5, 599) == 0
    assert runway(1000, 0) is None
```

- [ ] **Step 7: Run to verify failure**

Run: `uv run pytest tests/domain/test_wallet.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.domain.wallet'`.

- [ ] **Step 8: Implement wallet**

`backend/app/domain/wallet.py`:

```python
"""Wallet balance and runway (spec §4 rules 2-3)."""

import datetime as dt

from app.domain.money import Cents
from app.domain.types import CreditDestination, Ledger, PaymentSource


def wallet_balance(ledger: Ledger, chain_id: int, as_of: dt.date | None = None) -> Cents:
    def counts(day: dt.date, entry_chain: int | None) -> bool:
        return entry_chain == chain_id and (as_of is None or day <= as_of)

    gift = PaymentSource.GIFT_CARD
    loaded = sum(load.face_value for load in ledger.loads if counts(load.date, load.chain_id))
    credited = sum(
        credit.amount
        for credit in ledger.credits
        if credit.destination is CreditDestination.GIFT_CARD
        and counts(credit.date, credit.chain_id)
    )
    spent = sum(
        fee.amount
        for fee in ledger.fees
        if fee.payment_source is gift and counts(fee.date, fee.chain_id)
    ) + sum(
        visit.my_cost + visit.guest_cost
        for visit in ledger.visits
        if visit.payment_source is gift and counts(visit.date, visit.chain_id)
    )
    return loaded + credited - spent


def runway(balance: Cents, monthly_fee: Cents) -> int | None:
    """Whole months of fees the balance covers; None when there is no fee to divide by."""
    if monthly_fee <= 0:
        return None
    return max(balance, 0) // monthly_fee
```

- [ ] **Step 9: Run domain tests and checks**

Run: `uv run pytest tests/domain -q && uv run ruff check . && uv run ruff format --check . && uv run pyright`
Expected: all pass, `0 errors`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add oldest-card-first gift card allocation and wallet balance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Money metrics

Implements spec §4 rules 1 and 6–8.

**Files:**
- Create: `backend/app/domain/metrics.py`
- Test: `backend/tests/domain/test_metrics.py`

**Interfaces:**
- Consumes: `Ledger`, the domain types, `allocate`, `Allocation.effective_cost` (Task 5), `div_round_half_up` (Task 4).
- Produces:
  - `Period(start: date, end: date)` (inclusive; supports `day in period`; `Period.year(y)`, `Period.month(y, m)`);
  - `cash_out(ledger, period) -> Cents`;
  - `visit_count(ledger, period) -> int`;
  - `cost_per_movie(ledger, alloc, period) -> Cents | None`;
  - `guest_spend(ledger, alloc, period) -> Cents`;
  - `gift_card_discount(ledger, period) -> Cents`;
  - `unlimited_savings(ledger, alloc, period) -> Cents`.

- [ ] **Step 1: Write the failing tests**

The scenario below is a hand-worked slice of the real 2026 sheet, assuming the first Regal card was $35 for $50 (rate 0.70).

`backend/tests/domain/test_metrics.py`:

```python
import datetime as dt

from app.domain.allocation import allocate
from app.domain.metrics import (
    Period,
    cash_out,
    cost_per_movie,
    gift_card_discount,
    guest_spend,
    unlimited_savings,
    visit_count,
)
from app.domain.types import (
    Chain,
    Credit,
    CreditDestination,
    FeeCharge,
    GiftCardLoad,
    Ledger,
    PaymentSource,
    Visit,
)

GC, BANK, FREE = PaymentSource.GIFT_CARD, PaymentSource.BANK, PaymentSource.FREE
REGAL = 1
D = dt.date

# Card: $35 for $50. Fees on the 22nd draw 599 each; Project Hail Mary draws 650 + 1950.
# Cumulative costs at 0.70 -> fee1 419, PHM mine 455, PHM guests 1365, fee2 420, fee3 419.
SCENARIO = Ledger(
    chains=(Chain(REGAL, "Regal", 1500),),
    loads=(GiftCardLoad(1, REGAL, D(2026, 1, 1), 3500, 5000),),
    fees=(
        FeeCharge(1, REGAL, D(2026, 1, 22), 599, GC),
        FeeCharge(2, REGAL, D(2026, 2, 22), 599, GC),
        FeeCharge(3, REGAL, D(2026, 3, 22), 599, GC),
    ),
    visits=(
        Visit(1, REGAL, D(2026, 2, 1), 0, 0, 0, FREE),  # No Other Choice
        Visit(2, REGAL, D(2026, 2, 15), 650, 3, 1950, GC),  # Project Hail Mary
        Visit(3, REGAL, D(2026, 2, 16), 500, 0, 0, BANK),  # How to Make a Killing
    ),
)
Q1 = Period(D(2026, 1, 1), D(2026, 3, 31))
ALLOC = allocate(SCENARIO)


def test_period_bounds_are_inclusive() -> None:
    feb = Period.month(2026, 2)
    assert feb == Period(D(2026, 2, 1), D(2026, 2, 28))
    assert D(2026, 2, 28) in feb
    assert D(2026, 3, 1) not in feb
    assert Period.year(2025) == Period(D(2025, 1, 1), D(2025, 12, 31))


def test_cash_out_counts_card_purchases_and_bank_payments_only() -> None:
    assert cash_out(SCENARIO, Q1) == 3500 + 500
    assert cash_out(SCENARIO, Period.month(2026, 2)) == 500


def test_bank_credit_reduces_cash_out_gift_card_credit_does_not() -> None:
    ledger = Ledger(
        credits=(
            Credit(1, REGAL, D(2026, 2, 1), 717, CreditDestination.BANK),
            Credit(2, REGAL, D(2026, 2, 1), 300, CreditDestination.GIFT_CARD),
        )
    )
    assert cash_out(ledger, Q1) == -717


def test_visit_count_counts_my_visits_not_tickets() -> None:
    assert visit_count(SCENARIO, Q1) == 3


def test_cost_per_movie_uses_effective_fees_and_my_ticket_costs() -> None:
    # fees 419 + 420 + 419 = 1258; mine 0 + 455 + 500 = 955; 2213 / 3 = 737.67
    assert cost_per_movie(SCENARIO, ALLOC, Q1) == 738
    # Feb: fee 420 + mine 955 = 1375 / 3 = 458.33
    assert cost_per_movie(SCENARIO, ALLOC, Period.month(2026, 2)) == 458


def test_cost_per_movie_is_undefined_without_visits() -> None:
    assert cost_per_movie(SCENARIO, ALLOC, Period.month(2026, 1)) is None


def test_guest_spend_is_reported_separately() -> None:
    assert guest_spend(SCENARIO, ALLOC, Q1) == 1365


def test_gift_card_discount_is_face_minus_price() -> None:
    assert gift_card_discount(SCENARIO, Q1) == 1500
    assert gift_card_discount(SCENARIO, Period.month(2026, 2)) == 0


def test_unlimited_savings_compares_full_price_with_effective_cost() -> None:
    assert unlimited_savings(SCENARIO, ALLOC, Q1) == 3 * 1500 - 2213


def test_unlimited_savings_can_be_negative() -> None:
    # January: one fee (419 effective), no visits.
    assert unlimited_savings(SCENARIO, ALLOC, Period.month(2026, 1)) == -419
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/domain/test_metrics.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.domain.metrics'`.

- [ ] **Step 3: Implement**

`backend/app/domain/metrics.py`:

```python
"""Period metrics (spec §4 rules 1, 6-8)."""

import calendar
import datetime as dt
from dataclasses import dataclass
from typing import Self

from app.domain.allocation import Allocation
from app.domain.money import Cents, div_round_half_up
from app.domain.types import CreditDestination, Ledger, PaymentSource


@dataclass(frozen=True, slots=True)
class Period:
    start: dt.date
    end: dt.date  # inclusive

    def __contains__(self, day: object) -> bool:
        return isinstance(day, dt.date) and self.start <= day <= self.end

    @classmethod
    def year(cls, year: int) -> Self:
        return cls(dt.date(year, 1, 1), dt.date(year, 12, 31))

    @classmethod
    def month(cls, year: int, month: int) -> Self:
        last_day = calendar.monthrange(year, month)[1]
        return cls(dt.date(year, month, 1), dt.date(year, month, last_day))


def cash_out(ledger: Ledger, period: Period) -> Cents:
    bank = PaymentSource.BANK
    return (
        sum(load.price_paid for load in ledger.loads if load.date in period)
        + sum(f.amount for f in ledger.fees if f.payment_source is bank and f.date in period)
        + sum(
            v.my_cost + v.guest_cost
            for v in ledger.visits
            if v.payment_source is bank and v.date in period
        )
        - sum(
            c.amount
            for c in ledger.credits
            if c.destination is CreditDestination.BANK and c.date in period
        )
    )


def visit_count(ledger: Ledger, period: Period) -> int:
    return sum(1 for v in ledger.visits if v.date in period)


def cost_per_movie(ledger: Ledger, alloc: Allocation, period: Period) -> Cents | None:
    visits = visit_count(ledger, period)
    if visits == 0:
        return None
    return div_round_half_up(_effective_movie_cost(ledger, alloc, period), visits)


def guest_spend(ledger: Ledger, alloc: Allocation, period: Period) -> Cents:
    return sum(
        alloc.effective_cost(("guest", v.id), v.guest_cost, v.payment_source)
        for v in ledger.visits
        if v.date in period
    )


def gift_card_discount(ledger: Ledger, period: Period) -> Cents:
    return sum(load.face_value - load.price_paid for load in ledger.loads if load.date in period)


def unlimited_savings(ledger: Ledger, alloc: Allocation, period: Period) -> Cents:
    prices = {chain.id: chain.standard_ticket_price for chain in ledger.chains}
    full_price = sum(prices[v.chain_id] for v in ledger.visits if v.date in period)
    return full_price - _effective_movie_cost(ledger, alloc, period)


def _effective_movie_cost(ledger: Ledger, alloc: Allocation, period: Period) -> Cents:
    """Effective subscription fees plus my own ticket costs: what my moviegoing cost me."""
    fees = sum(
        alloc.effective_cost(("fee", f.id), f.amount, f.payment_source)
        for f in ledger.fees
        if f.date in period
    )
    mine = sum(
        alloc.effective_cost(("visit", v.id), v.my_cost, v.payment_source)
        for v in ledger.visits
        if v.date in period
    )
    return fees + mine
```

- [ ] **Step 4: Run tests and checks**

Run: `uv run pytest tests/domain -q && uv run ruff check . && uv run ruff format --check . && uv run pyright`
Expected: all pass, `0 errors`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add cash out, cost per movie, guest spend and savings metrics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: DB models, migrations and session wiring

**Files:**
- Create: `backend/app/db/__init__.py`, `backend/app/db/base.py`, `backend/app/db/models.py`, `backend/app/db/session.py`, `backend/app/api/deps.py`, `backend/alembic.ini`, `backend/migrations/` (via `alembic init`)
- Modify: `backend/app/main.py`, `backend/tests/conftest.py`, `README.md` (add the migrate step)
- Test: `backend/tests/test_db.py`

**Interfaces:**
- Consumes: `PaymentSource`, `CreditDestination` (Task 5), `Settings` (Task 1).
- Produces:
  - ORM classes in `app.db.models`:
    - `Chain(id, name, standard_ticket_price)`
    - `GiftCardLoad(id, chain_id, date, price_paid, face_value, note)`
    - `Visit(id, date, chain_id, title, my_cost, guest_count, guest_cost, payment_source, note)`
    - `Credit(id, date, chain_id, amount, destination, note)`
  - `app.db.base.Base`; `app.db.session.make_engine(database_url) -> Engine`.
  - `app.state.engine` and `app.state.session_factory` set in `create_app`.
  - In `app.api.deps`: `get_session` / `SessionDep`, `get_today` / `TodayDep`.
  - Test fixtures `app`, `client`, `db` (a `Session`). Today is pinned to 2026-10-15 in tests.

- [ ] **Step 1: Add dependencies**

```bash
cd backend
uv add sqlalchemy alembic
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/conftest.py` (replace):

```python
import datetime as dt
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_today
from app.config import Settings
from app.db import models  # noqa: F401  (registers tables on Base.metadata)
from app.db.base import Base
from app.main import create_app

TODAY = dt.date(2026, 10, 15)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        frontend_dist=None,
    )


@pytest.fixture
def app(settings: Settings) -> Iterator[FastAPI]:
    application = create_app(settings)
    Base.metadata.create_all(application.state.engine)
    application.dependency_overrides[get_today] = lambda: TODAY
    yield application
    application.state.engine.dispose()


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def db(app: FastAPI) -> Iterator[Session]:
    with app.state.session_factory() as session:
        yield session
```

`backend/tests/test_db.py`:

```python
import datetime as dt
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import models
from app.db.base import Base
from app.db.session import make_engine

BACKEND_DIR = Path(__file__).resolve().parents[1]


def test_face_value_below_price_is_rejected_by_the_database(db: Session) -> None:
    db.add(models.Chain(name="Regal", standard_ticket_price=1500))
    db.flush()
    db.add(models.GiftCardLoad(chain_id=1, date=dt.date(2026, 1, 1), price_paid=5000, face_value=3500))
    with pytest.raises(IntegrityError):
        db.flush()


def test_foreign_keys_are_enforced(db: Session) -> None:
    db.add(models.GiftCardLoad(chain_id=99, date=dt.date(2026, 1, 1), price_paid=3500, face_value=5000))
    with pytest.raises(IntegrityError):
        db.flush()


def test_migrations_match_models(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    url = f"sqlite:///{(tmp_path / 'migrated.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    try:
        config = Config(str(BACKEND_DIR / "alembic.ini"))
        config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
        command.upgrade(config, "head")
        engine = make_engine(url)
        with engine.connect() as connection:
            diff = compare_metadata(MigrationContext.configure(connection), Base.metadata)
        engine.dispose()
        assert diff == []
    finally:
        get_settings.cache_clear()
```

- [ ] **Step 3: Run to verify failure**

Run: `uv run pytest -q`
Expected: collection errors with `ModuleNotFoundError: No module named 'app.api.deps'`.

- [ ] **Step 4: Implement the DB layer**

`backend/app/db/__init__.py`: empty file.

`backend/app/db/base.py`:

```python
from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
```

`backend/app/db/models.py`:

```python
import datetime as dt
from enum import StrEnum

from sqlalchemy import CheckConstraint, Date, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.domain.types import CreditDestination, PaymentSource


def _enum[E: StrEnum](enum_cls: type[E]) -> Enum:
    return Enum(
        enum_cls,
        # The CHECK constraint needs a name under our naming convention.
        name=enum_cls.__name__.lower(),
        native_enum=False,
        create_constraint=True,
        length=20,
        values_callable=lambda members: [member.value for member in members],
    )


class Chain(Base):
    __tablename__ = "chains"
    __table_args__ = (CheckConstraint("standard_ticket_price >= 0", name="price_nonneg"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    standard_ticket_price: Mapped[int]


class GiftCardLoad(Base):
    __tablename__ = "gift_card_loads"
    __table_args__ = (
        CheckConstraint("price_paid > 0", name="price_positive"),
        CheckConstraint("face_value >= price_paid", name="face_covers_price"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    chain_id: Mapped[int] = mapped_column(ForeignKey("chains.id", ondelete="RESTRICT"), index=True)
    date: Mapped[dt.date] = mapped_column(Date)
    price_paid: Mapped[int]
    face_value: Mapped[int]
    note: Mapped[str | None] = mapped_column(String(200))


class Visit(Base):
    __tablename__ = "visits"
    __table_args__ = (
        CheckConstraint("my_cost >= 0", name="my_cost_nonneg"),
        CheckConstraint("guest_count >= 0", name="guest_count_nonneg"),
        CheckConstraint("guest_cost >= 0", name="guest_cost_nonneg"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, index=True)
    chain_id: Mapped[int] = mapped_column(ForeignKey("chains.id", ondelete="RESTRICT"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    my_cost: Mapped[int]
    guest_count: Mapped[int]
    guest_cost: Mapped[int]
    payment_source: Mapped[PaymentSource] = mapped_column(_enum(PaymentSource))
    note: Mapped[str | None] = mapped_column(String(200))


class Credit(Base):
    __tablename__ = "credits"
    __table_args__ = (CheckConstraint("amount > 0", name="amount_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date)
    chain_id: Mapped[int | None] = mapped_column(
        ForeignKey("chains.id", ondelete="RESTRICT"), index=True
    )
    amount: Mapped[int]
    destination: Mapped[CreditDestination] = mapped_column(_enum(CreditDestination))
    note: Mapped[str | None] = mapped_column(String(200))
```

`backend/app/db/session.py`:

```python
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import make_url


def make_engine(database_url: str) -> Engine:
    url = make_url(database_url)
    is_sqlite = url.get_backend_name() == "sqlite"
    if is_sqlite and url.database not in (None, "", ":memory:"):
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)

    engine = create_engine(database_url)
    if is_sqlite:

        @event.listens_for(engine, "connect")
        def _enable_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine
```

`backend/app/api/deps.py`:

```python
import datetime as dt
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session, sessionmaker


def get_session(request: Request) -> Iterator[Session]:
    factory: sessionmaker[Session] = request.app.state.session_factory
    with factory() as session:
        yield session


def get_today() -> dt.date:
    return dt.date.today()


SessionDep = Annotated[Session, Depends(get_session)]
TodayDep = Annotated[dt.date, Depends(get_today)]
```

`backend/app/main.py`: in `create_app`, after `settings = settings or get_settings()`, add the engine wiring. The full function becomes:

```python
def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Movie Money Tracker")

    engine = make_engine(settings.database_url)
    app.state.engine = engine
    app.state.session_factory = sessionmaker(engine, expire_on_commit=False)

    app.include_router(api_router, prefix="/api/v1")

    dist = settings.frontend_dist
    if dist is not None and (dist / "index.html").is_file():
        app.mount("/", SPAStaticFiles(directory=dist, html=True), name="frontend")
    return app
```

with these imports added at the top:

```python
from sqlalchemy.orm import sessionmaker

from app.db.session import make_engine
```

- [ ] **Step 5: Set up Alembic and generate the first migration**

```bash
uv run alembic init migrations
```

Replace `backend/migrations/env.py` with:

```python
from logging.config import fileConfig

from alembic import context

from app.config import get_settings
from app.db import models  # noqa: F401  (registers tables)
from app.db.base import Base
from app.db.session import make_engine

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=get_settings().database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = make_engine(get_settings().database_url)
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata, render_as_batch=True
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

In `backend/alembic.ini`, delete the `sqlalchemy.url = …` line (the URL comes from settings). Then generate the migration against a scratch DB:

```bash
DATABASE_URL="sqlite:///$(pwd)/scratch.db" uv run alembic revision --autogenerate -m "initial ledger tables"
rm -f scratch.db
```

Expected: a new file in `backend/migrations/versions/` that creates `chains`, `gift_card_loads`, `visits` and `credits`. Open it and check that the check constraints and foreign keys appear. If autogenerate missed a `CheckConstraint`, add it to the `op.create_table(...)` call by hand, using `sa.CheckConstraint("<sql>", name=op.f("ck_<table>_<name>"))`.

- [ ] **Step 6: Run tests and checks**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run pyright`
Expected: all pass. If ruff flags the generated migration's formatting, run `uv run ruff format .`.

- [ ] **Step 7: Create the real local DB and document it**

Run: `uv run alembic upgrade head`
Expected: `<repo>/data/app.db` exists (and is gitignored: `git status` shows no `data/`).

In `README.md` "Development", change the API line to:

```bash
cd backend && uv sync && uv run alembic upgrade head && uv run uvicorn app.main:create_app --factory --reload
```

- [ ] **Step 8: Commit**

```bash
cd ..
git add -A
git commit -m "feat: add ledger database models and initial migration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Chains API

**Files:**
- Create: `backend/app/api/v1/chains.py`
- Modify: `backend/app/api/deps.py` (add `get_or_404`), `backend/app/api/v1/__init__.py`
- Test: `backend/tests/test_chains_api.py`

**Interfaces:**
- Consumes: `SessionDep` (Task 7), `models.Chain`.
- Produces:
  - `GET/POST /api/v1/chains`, `PUT/DELETE /api/v1/chains/{id}`. Bodies are `{"name": str, "standard_ticket_price": int}`; responses add `id`.
  - `app.api.deps.get_or_404(session, model, id) -> instance`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_chains_api.py`:

```python
import datetime as dt

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import models

REGAL = {"name": "Regal", "standard_ticket_price": 1500}


def test_create_and_list_chains(client: TestClient) -> None:
    created = client.post("/api/v1/chains", json=REGAL)
    assert created.status_code == 201
    assert created.json() == {"id": 1, "name": "Regal", "standard_ticket_price": 1500}
    assert client.get("/api/v1/chains").json() == [created.json()]


def test_chain_name_is_trimmed_and_unique_ignoring_case(client: TestClient) -> None:
    created = client.post("/api/v1/chains", json={**REGAL, "name": "  Regal "})
    assert created.json()["name"] == "Regal"
    duplicate = client.post("/api/v1/chains", json={**REGAL, "name": "regal"})
    assert duplicate.status_code == 409


def test_blank_name_and_negative_price_are_rejected(client: TestClient) -> None:
    assert client.post("/api/v1/chains", json={**REGAL, "name": "   "}).status_code == 422
    assert client.post("/api/v1/chains", json={**REGAL, "standard_ticket_price": -1}).status_code == 422


def test_update_chain(client: TestClient) -> None:
    client.post("/api/v1/chains", json=REGAL)
    updated = client.put("/api/v1/chains/1", json={"name": "Regal", "standard_ticket_price": 1650})
    assert updated.status_code == 200
    assert updated.json()["standard_ticket_price"] == 1650


def test_rename_to_an_existing_name_conflicts(client: TestClient) -> None:
    client.post("/api/v1/chains", json=REGAL)
    client.post("/api/v1/chains", json={**REGAL, "name": "Cinemark"})
    assert client.put("/api/v1/chains/2", json={**REGAL, "name": "REGAL"}).status_code == 409
    # renaming a chain to its own name (different case) is fine
    assert client.put("/api/v1/chains/1", json={**REGAL, "name": "REGAL"}).status_code == 200


def test_missing_chain_is_404(client: TestClient) -> None:
    assert client.put("/api/v1/chains/9", json=REGAL).status_code == 404
    assert client.delete("/api/v1/chains/9").status_code == 404


def test_delete_unused_chain(client: TestClient) -> None:
    client.post("/api/v1/chains", json=REGAL)
    assert client.delete("/api/v1/chains/1").status_code == 204
    assert client.get("/api/v1/chains").json() == []


def test_delete_chain_with_entries_conflicts(client: TestClient, db: Session) -> None:
    client.post("/api/v1/chains", json=REGAL)
    db.add(models.GiftCardLoad(chain_id=1, date=dt.date(2026, 1, 1), price_paid=3500, face_value=5000))
    db.commit()
    response = client.delete("/api/v1/chains/1")
    assert response.status_code == 409
    assert "entries" in response.json()["detail"]
    assert len(client.get("/api/v1/chains").json()) == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_chains_api.py -q`
Expected: FAIL (404s, because the routes don't exist yet).

- [ ] **Step 3: Implement**

Append to `backend/app/api/deps.py`:

```python
from fastapi import HTTPException


def get_or_404[M](session: Session, model: type[M], id_: int) -> M:
    instance = session.get(model, id_)
    if instance is None:
        raise HTTPException(status_code=404, detail=f"{model.__name__} {id_} not found")
    return instance
```

(Move the `HTTPException` import up into the existing `from fastapi import …` line so ruff's import sorting passes.)

`backend/app/api/v1/chains.py`:

```python
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import SessionDep, get_or_404
from app.db import models

router = APIRouter(prefix="/chains", tags=["chains"])

ChainName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class ChainIn(BaseModel):
    name: ChainName
    standard_ticket_price: int = Field(ge=0)


class ChainOut(ChainIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


@router.get("", response_model=list[ChainOut])
def list_chains(session: SessionDep) -> list[models.Chain]:
    return list(session.scalars(select(models.Chain).order_by(models.Chain.name)))


@router.post("", response_model=ChainOut, status_code=201)
def create_chain(body: ChainIn, session: SessionDep) -> models.Chain:
    _ensure_unique_name(session, body.name)
    chain = models.Chain(**body.model_dump())
    session.add(chain)
    session.commit()
    session.refresh(chain)
    return chain


@router.put("/{chain_id}", response_model=ChainOut)
def update_chain(chain_id: int, body: ChainIn, session: SessionDep) -> models.Chain:
    chain = get_or_404(session, models.Chain, chain_id)
    _ensure_unique_name(session, body.name, exclude_id=chain_id)
    chain.name = body.name
    chain.standard_ticket_price = body.standard_ticket_price
    session.commit()
    session.refresh(chain)
    return chain


@router.delete("/{chain_id}", status_code=204)
def delete_chain(chain_id: int, session: SessionDep) -> None:
    session.delete(get_or_404(session, models.Chain, chain_id))
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="This chain still has entries. Delete or move them first.",
        ) from None


def _ensure_unique_name(session: Session, name: str, exclude_id: int | None = None) -> None:
    stmt = select(models.Chain.id).where(func.lower(models.Chain.name) == name.lower())
    if exclude_id is not None:
        stmt = stmt.where(models.Chain.id != exclude_id)
    if session.scalar(stmt) is not None:
        raise HTTPException(status_code=409, detail=f"A chain named {name!r} already exists")
```

`backend/app/api/v1/__init__.py`:

```python
from fastapi import APIRouter

from app.api.v1 import chains, health

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(chains.router)
```

- [ ] **Step 4: Run tests and checks**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run pyright`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add chains API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Gift cards API

**Files:**
- Create: `backend/app/api/v1/gift_cards.py`
- Modify: `backend/app/api/deps.py` (add `require_chain`, `reject_future`), `backend/app/api/v1/__init__.py`
- Test: `backend/tests/test_gift_cards_api.py`

**Interfaces:**
- Consumes: `SessionDep`, `TodayDep`, `get_or_404`, `models.GiftCardLoad`.
- Produces:
  - `GET /api/v1/gift-cards?chain_id=`, `POST /api/v1/gift-cards`, `PUT/DELETE /api/v1/gift-cards/{id}`. The body is `{"chain_id", "date", "price_paid", "face_value", "note"?}`; responses add `id`. List order is date desc, then id desc.
  - `require_chain(session, chain_id) -> None`, which raises a 422 on `["body", "chain_id"]`.
  - `reject_future(day, today, field="date") -> None`, which raises a 422 on `["body", field]`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_gift_cards_api.py`:

```python
from fastapi.testclient import TestClient

CARD = {"chain_id": 1, "date": "2026-01-01", "price_paid": 3500, "face_value": 5000}


def _chain(client: TestClient, name: str = "Regal") -> None:
    client.post("/api/v1/chains", json={"name": name, "standard_ticket_price": 1500})


def test_create_and_list_gift_cards(client: TestClient) -> None:
    _chain(client)
    created = client.post("/api/v1/gift-cards", json={**CARD, "note": "Costco"})
    assert created.status_code == 201
    assert created.json() == {**CARD, "id": 1, "note": "Costco"}
    later = client.post("/api/v1/gift-cards", json={**CARD, "date": "2026-04-26"}).json()
    assert [c["id"] for c in client.get("/api/v1/gift-cards").json()] == [later["id"], 1]


def test_filter_by_chain(client: TestClient) -> None:
    _chain(client)
    _chain(client, "Cinemark")
    client.post("/api/v1/gift-cards", json=CARD)
    client.post("/api/v1/gift-cards", json={**CARD, "chain_id": 2})
    assert [c["chain_id"] for c in client.get("/api/v1/gift-cards?chain_id=2").json()] == [2]


def test_face_value_must_cover_price(client: TestClient) -> None:
    _chain(client)
    response = client.post("/api/v1/gift-cards", json={**CARD, "face_value": 3000})
    assert response.status_code == 422


def test_price_must_be_positive(client: TestClient) -> None:
    _chain(client)
    assert client.post("/api/v1/gift-cards", json={**CARD, "price_paid": 0}).status_code == 422


def test_unknown_chain_is_a_field_error(client: TestClient) -> None:
    response = client.post("/api/v1/gift-cards", json=CARD)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "chain_id"]


def test_future_date_is_rejected(client: TestClient) -> None:
    _chain(client)
    response = client.post("/api/v1/gift-cards", json={**CARD, "date": "2026-10-16"})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "date"]


def test_update_and_delete(client: TestClient) -> None:
    _chain(client)
    client.post("/api/v1/gift-cards", json=CARD)
    updated = client.put("/api/v1/gift-cards/1", json={**CARD, "face_value": 5500})
    assert updated.status_code == 200
    assert updated.json()["face_value"] == 5500
    assert client.delete("/api/v1/gift-cards/1").status_code == 204
    assert client.get("/api/v1/gift-cards").json() == []
    assert client.delete("/api/v1/gift-cards/1").status_code == 404
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_gift_cards_api.py -q`
Expected: FAIL (404s).

- [ ] **Step 3: Implement**

Append to `backend/app/api/deps.py` (merge the imports into the top-of-file import block):

```python
from app.db import models


def require_chain(session: Session, chain_id: int) -> None:
    if session.get(models.Chain, chain_id) is None:
        raise HTTPException(
            status_code=422,
            detail=[
                {
                    "type": "value_error",
                    "loc": ["body", "chain_id"],
                    "msg": f"Unknown chain {chain_id}",
                    "input": chain_id,
                }
            ],
        )


def reject_future(day: dt.date, today: dt.date, field: str = "date") -> None:
    if day > today:
        raise HTTPException(
            status_code=422,
            detail=[
                {
                    "type": "value_error",
                    "loc": ["body", field],
                    "msg": "Date cannot be in the future",
                    "input": day.isoformat(),
                }
            ],
        )
```

`backend/app/api/v1/gift_cards.py`:

```python
import datetime as dt
from typing import Annotated, Self

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import select

from app.api.deps import SessionDep, TodayDep, get_or_404, reject_future, require_chain
from app.db import models

router = APIRouter(prefix="/gift-cards", tags=["gift-cards"])

Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


class GiftCardIn(BaseModel):
    chain_id: int
    date: dt.date
    price_paid: int = Field(gt=0)
    face_value: int = Field(gt=0)
    note: Note | None = None

    @model_validator(mode="after")
    def _face_covers_price(self) -> Self:
        if self.face_value < self.price_paid:
            raise ValueError("face_value must be at least price_paid")
        return self


class GiftCardOut(GiftCardIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


@router.get("", response_model=list[GiftCardOut])
def list_gift_cards(session: SessionDep, chain_id: int | None = None) -> list[models.GiftCardLoad]:
    stmt = select(models.GiftCardLoad).order_by(
        models.GiftCardLoad.date.desc(), models.GiftCardLoad.id.desc()
    )
    if chain_id is not None:
        stmt = stmt.where(models.GiftCardLoad.chain_id == chain_id)
    return list(session.scalars(stmt))


@router.post("", response_model=GiftCardOut, status_code=201)
def create_gift_card(body: GiftCardIn, session: SessionDep, today: TodayDep) -> models.GiftCardLoad:
    reject_future(body.date, today)
    require_chain(session, body.chain_id)
    load = models.GiftCardLoad(**body.model_dump())
    session.add(load)
    session.commit()
    session.refresh(load)
    return load


@router.put("/{load_id}", response_model=GiftCardOut)
def update_gift_card(
    load_id: int, body: GiftCardIn, session: SessionDep, today: TodayDep
) -> models.GiftCardLoad:
    load = get_or_404(session, models.GiftCardLoad, load_id)
    reject_future(body.date, today)
    require_chain(session, body.chain_id)
    for field, value in body.model_dump().items():
        setattr(load, field, value)
    session.commit()
    session.refresh(load)
    return load


@router.delete("/{load_id}", status_code=204)
def delete_gift_card(load_id: int, session: SessionDep) -> None:
    session.delete(get_or_404(session, models.GiftCardLoad, load_id))
    session.commit()
```

In `backend/app/api/v1/__init__.py`, import `gift_cards` and add `api_router.include_router(gift_cards.router)`.

- [ ] **Step 4: Run tests and checks**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run pyright`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add gift cards API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Visits and credits API

**Files:**
- Create: `backend/app/api/v1/visits.py`, `backend/app/api/v1/credits.py`
- Modify: `backend/app/api/v1/__init__.py`
- Test: `backend/tests/test_visits_api.py`, `backend/tests/test_credits_api.py`

**Interfaces:**
- Consumes: `SessionDep`, `TodayDep`, `get_today`, `get_or_404`, `require_chain`, `reject_future`, `models.Visit`, `models.Credit`, `PaymentSource`, `CreditDestination`.
- Produces:
  - `GET /api/v1/visits?chain_id=`, `POST`, `PUT/DELETE /api/v1/visits/{id}`. The body is `{"date", "chain_id", "title", "my_cost"=0, "guest_count"=0, "guest_cost"=0, "payment_source", "note"?}`.
  - `GET /api/v1/credits`, `POST`, `PUT/DELETE /api/v1/credits/{id}`. The body is `{"date", "chain_id"?, "amount", "destination", "note"?}`.
  - Responses add `id`. Lists are date desc, then id desc.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_visits_api.py`:

```python
import datetime as dt

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_today

VISIT = {
    "date": "2026-02-15",
    "chain_id": 1,
    "title": "Project Hail Mary",
    "my_cost": 650,
    "guest_count": 3,
    "guest_cost": 1950,
    "payment_source": "gift_card",
}


def _chain(client: TestClient) -> None:
    client.post("/api/v1/chains", json={"name": "Regal", "standard_ticket_price": 1500})


def test_create_and_list_visits(client: TestClient) -> None:
    _chain(client)
    created = client.post("/api/v1/visits", json=VISIT)
    assert created.status_code == 201
    assert created.json() == {**VISIT, "id": 1, "note": None}
    assert client.get("/api/v1/visits").json() == [created.json()]


def test_free_visit_defaults(client: TestClient) -> None:
    _chain(client)
    body = {"date": "2026-02-01", "chain_id": 1, "title": "No Other Choice", "payment_source": "free"}
    created = client.post("/api/v1/visits", json=body).json()
    assert (created["my_cost"], created["guest_count"], created["guest_cost"]) == (0, 0, 0)


def test_payment_source_must_match_costs(client: TestClient) -> None:
    _chain(client)
    paid_but_free = {**VISIT, "payment_source": "free"}
    free_but_paid = {**VISIT, "my_cost": 0, "guest_count": 0, "guest_cost": 0}
    assert client.post("/api/v1/visits", json=paid_but_free).status_code == 422
    assert client.post("/api/v1/visits", json=free_but_paid).status_code == 422


def test_guest_cost_needs_guests(client: TestClient) -> None:
    _chain(client)
    assert client.post("/api/v1/visits", json={**VISIT, "guest_count": 0}).status_code == 422


def test_blank_title_rejected(client: TestClient) -> None:
    _chain(client)
    assert client.post("/api/v1/visits", json={**VISIT, "title": "  "}).status_code == 422


def test_visit_dated_today_ok_tomorrow_rejected(app: FastAPI, client: TestClient) -> None:
    app.dependency_overrides[get_today] = lambda: dt.date(2026, 10, 15)
    _chain(client)
    assert client.post("/api/v1/visits", json={**VISIT, "date": "2026-10-15"}).status_code == 201
    tomorrow = client.post("/api/v1/visits", json={**VISIT, "date": "2026-10-16"})
    assert tomorrow.status_code == 422
    assert tomorrow.json()["detail"][0]["loc"] == ["body", "date"]


def test_unknown_chain_rejected(client: TestClient) -> None:
    response = client.post("/api/v1/visits", json=VISIT)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "chain_id"]


def test_update_and_delete(client: TestClient) -> None:
    _chain(client)
    client.post("/api/v1/visits", json=VISIT)
    updated = client.put("/api/v1/visits/1", json={**VISIT, "title": "Project Hail Mary (IMAX)"})
    assert updated.json()["title"] == "Project Hail Mary (IMAX)"
    assert client.delete("/api/v1/visits/1").status_code == 204
    assert client.put("/api/v1/visits/1", json=VISIT).status_code == 404
```

`backend/tests/test_credits_api.py`:

```python
from fastapi.testclient import TestClient

CREDIT = {"date": "2025-05-27", "chain_id": 1, "amount": 717, "destination": "bank", "note": "Refund"}


def _chain(client: TestClient) -> None:
    client.post("/api/v1/chains", json={"name": "Cinemark", "standard_ticket_price": 1400})


def test_create_and_list_credits(client: TestClient) -> None:
    _chain(client)
    created = client.post("/api/v1/credits", json=CREDIT)
    assert created.status_code == 201
    assert created.json() == {**CREDIT, "id": 1}
    assert client.get("/api/v1/credits").json() == [created.json()]


def test_bank_credit_may_have_no_chain(client: TestClient) -> None:
    created = client.post("/api/v1/credits", json={**CREDIT, "chain_id": None})
    assert created.status_code == 201


def test_gift_card_credit_needs_a_chain(client: TestClient) -> None:
    body = {**CREDIT, "chain_id": None, "destination": "gift_card"}
    assert client.post("/api/v1/credits", json=body).status_code == 422


def test_amount_must_be_positive(client: TestClient) -> None:
    _chain(client)
    assert client.post("/api/v1/credits", json={**CREDIT, "amount": -717}).status_code == 422


def test_future_date_rejected(client: TestClient) -> None:
    _chain(client)
    assert client.post("/api/v1/credits", json={**CREDIT, "date": "2026-10-16"}).status_code == 422


def test_update_and_delete(client: TestClient) -> None:
    _chain(client)
    client.post("/api/v1/credits", json=CREDIT)
    assert client.put("/api/v1/credits/1", json={**CREDIT, "amount": 700}).json()["amount"] == 700
    assert client.delete("/api/v1/credits/1").status_code == 204
    assert client.get("/api/v1/credits").json() == []
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_visits_api.py tests/test_credits_api.py -q`
Expected: FAIL (404s).

- [ ] **Step 3: Implement visits**

`backend/app/api/v1/visits.py`:

```python
import datetime as dt
from typing import Annotated, Self

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import select

from app.api.deps import SessionDep, TodayDep, get_or_404, reject_future, require_chain
from app.db import models
from app.domain.types import PaymentSource

router = APIRouter(prefix="/visits", tags=["visits"])

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


class VisitIn(BaseModel):
    date: dt.date
    chain_id: int
    title: Title
    my_cost: int = Field(default=0, ge=0)
    guest_count: int = Field(default=0, ge=0)
    guest_cost: int = Field(default=0, ge=0)
    payment_source: PaymentSource
    note: Note | None = None

    @model_validator(mode="after")
    def _payment_matches_costs(self) -> Self:
        is_free = self.my_cost + self.guest_cost == 0
        if (self.payment_source is PaymentSource.FREE) != is_free:
            raise ValueError("payment_source must be 'free' exactly when my_cost + guest_cost is 0")
        if self.guest_cost > 0 and self.guest_count == 0:
            raise ValueError("guest_cost needs guest_count of at least 1")
        return self


class VisitOut(VisitIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


@router.get("", response_model=list[VisitOut])
def list_visits(session: SessionDep, chain_id: int | None = None) -> list[models.Visit]:
    stmt = select(models.Visit).order_by(models.Visit.date.desc(), models.Visit.id.desc())
    if chain_id is not None:
        stmt = stmt.where(models.Visit.chain_id == chain_id)
    return list(session.scalars(stmt))


@router.post("", response_model=VisitOut, status_code=201)
def create_visit(body: VisitIn, session: SessionDep, today: TodayDep) -> models.Visit:
    reject_future(body.date, today)
    require_chain(session, body.chain_id)
    visit = models.Visit(**body.model_dump())
    session.add(visit)
    session.commit()
    session.refresh(visit)
    return visit


@router.put("/{visit_id}", response_model=VisitOut)
def update_visit(
    visit_id: int, body: VisitIn, session: SessionDep, today: TodayDep
) -> models.Visit:
    visit = get_or_404(session, models.Visit, visit_id)
    reject_future(body.date, today)
    require_chain(session, body.chain_id)
    for field, value in body.model_dump().items():
        setattr(visit, field, value)
    session.commit()
    session.refresh(visit)
    return visit


@router.delete("/{visit_id}", status_code=204)
def delete_visit(visit_id: int, session: SessionDep) -> None:
    session.delete(get_or_404(session, models.Visit, visit_id))
    session.commit()
```

- [ ] **Step 4: Implement credits**

`backend/app/api/v1/credits.py`:

```python
import datetime as dt
from typing import Annotated, Self

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import select

from app.api.deps import SessionDep, TodayDep, get_or_404, reject_future, require_chain
from app.db import models
from app.domain.types import CreditDestination

router = APIRouter(prefix="/credits", tags=["credits"])

Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


class CreditIn(BaseModel):
    date: dt.date
    chain_id: int | None = None
    amount: int = Field(gt=0)
    destination: CreditDestination
    note: Note | None = None

    @model_validator(mode="after")
    def _gift_card_credit_has_chain(self) -> Self:
        if self.destination is CreditDestination.GIFT_CARD and self.chain_id is None:
            raise ValueError("a gift_card credit needs a chain_id")
        return self


class CreditOut(CreditIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


@router.get("", response_model=list[CreditOut])
def list_credits(session: SessionDep) -> list[models.Credit]:
    stmt = select(models.Credit).order_by(models.Credit.date.desc(), models.Credit.id.desc())
    return list(session.scalars(stmt))


@router.post("", response_model=CreditOut, status_code=201)
def create_credit(body: CreditIn, session: SessionDep, today: TodayDep) -> models.Credit:
    reject_future(body.date, today)
    if body.chain_id is not None:
        require_chain(session, body.chain_id)
    credit = models.Credit(**body.model_dump())
    session.add(credit)
    session.commit()
    session.refresh(credit)
    return credit


@router.put("/{credit_id}", response_model=CreditOut)
def update_credit(
    credit_id: int, body: CreditIn, session: SessionDep, today: TodayDep
) -> models.Credit:
    credit = get_or_404(session, models.Credit, credit_id)
    reject_future(body.date, today)
    if body.chain_id is not None:
        require_chain(session, body.chain_id)
    for field, value in body.model_dump().items():
        setattr(credit, field, value)
    session.commit()
    session.refresh(credit)
    return credit


@router.delete("/{credit_id}", status_code=204)
def delete_credit(credit_id: int, session: SessionDep) -> None:
    session.delete(get_or_404(session, models.Credit, credit_id))
    session.commit()
```

In `backend/app/api/v1/__init__.py`, import `credits, visits` and include both routers.

- [ ] **Step 5: Run tests and checks**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run pyright`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add visits and credits API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Ledger service, activity feed and wallets API

This connects the domain rules to the DB.

**Files:**
- Create: `backend/app/services/__init__.py`, `backend/app/services/ledger.py`, `backend/app/api/v1/activity.py`, `backend/app/api/v1/wallets.py`
- Modify: `backend/app/api/v1/__init__.py`
- Test: `backend/tests/test_activity_api.py`

**Interfaces:**
- Consumes: ORM models (Task 7), the domain types and `allocate` (Task 5), `wallet_balance` (Task 5), `format_cents` (Task 4).
- Produces:
  - `load_ledger(session) -> Ledger`.
  - `GET /api/v1/activity?kind=visit|gift_card|credit&chain_id=&month=YYYY-MM` → list of `{kind, id, date, chain_id, description, amount, payment_source, effective_cost}`, newest first.
    - `amount` is signed cents (credits are negative).
    - `payment_source` is the visit's source, a credit's destination, or `null` for gift cards.
    - `effective_cost` is visits: my + guest effective; gift cards: price paid; credits: `null`.
  - `GET /api/v1/wallets` → list of `{chain_id, chain_name, balance, uncovered}`, ordered by chain name, with balance as of today.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_activity_api.py`:

```python
from fastapi.testclient import TestClient


def _seed(client: TestClient) -> None:
    client.post("/api/v1/chains", json={"name": "Regal", "standard_ticket_price": 1500})
    client.post(
        "/api/v1/gift-cards",
        json={"chain_id": 1, "date": "2026-01-01", "price_paid": 3500, "face_value": 5000},
    )
    client.post(
        "/api/v1/visits",
        json={
            "date": "2026-02-15",
            "chain_id": 1,
            "title": "Project Hail Mary",
            "my_cost": 650,
            "guest_count": 3,
            "guest_cost": 1950,
            "payment_source": "gift_card",
        },
    )
    client.post(
        "/api/v1/visits",
        json={
            "date": "2026-02-16",
            "chain_id": 1,
            "title": "How to Make a Killing",
            "my_cost": 500,
            "payment_source": "bank",
        },
    )
    client.post(
        "/api/v1/credits",
        json={"date": "2026-02-20", "chain_id": 1, "amount": 717, "destination": "bank", "note": "Refund"},
    )


def test_activity_lists_everything_newest_first_with_effective_costs(client: TestClient) -> None:
    _seed(client)
    assert client.get("/api/v1/activity").json() == [
        {
            "kind": "credit", "id": 1, "date": "2026-02-20", "chain_id": 1,
            "description": "Refund", "amount": -717, "payment_source": "bank",
            "effective_cost": None,
        },
        {
            "kind": "visit", "id": 2, "date": "2026-02-16", "chain_id": 1,
            "description": "How to Make a Killing", "amount": 500, "payment_source": "bank",
            "effective_cost": 500,
        },
        {
            "kind": "visit", "id": 1, "date": "2026-02-15", "chain_id": 1,
            "description": "Project Hail Mary (+3 guests)", "amount": 2600,
            "payment_source": "gift_card", "effective_cost": 1820,
        },
        {
            "kind": "gift_card", "id": 1, "date": "2026-01-01", "chain_id": 1,
            "description": "Regal gift card ($50.00 value)", "amount": 3500,
            "payment_source": None, "effective_cost": 3500,
        },
    ]


def test_activity_filters(client: TestClient) -> None:
    _seed(client)
    assert len(client.get("/api/v1/activity?month=2026-02").json()) == 3
    assert [e["kind"] for e in client.get("/api/v1/activity?kind=visit").json()] == ["visit", "visit"]
    assert client.get("/api/v1/activity?chain_id=2").json() == []
    assert client.get("/api/v1/activity?month=2026-13").status_code == 422


def test_wallets_show_balance_per_chain(client: TestClient) -> None:
    _seed(client)
    assert client.get("/api/v1/wallets").json() == [
        {"chain_id": 1, "chain_name": "Regal", "balance": 5000 - 2600, "uncovered": 0}
    ]


def test_spending_without_card_money_shows_as_uncovered(client: TestClient) -> None:
    client.post("/api/v1/chains", json={"name": "Cinemark", "standard_ticket_price": 1400})
    client.post(
        "/api/v1/visits",
        json={
            "date": "2025-06-02", "chain_id": 1, "title": "The Life of Chuck",
            "my_cost": 500, "payment_source": "gift_card",
        },
    )
    assert client.get("/api/v1/wallets").json() == [
        {"chain_id": 1, "chain_name": "Cinemark", "balance": -500, "uncovered": 500}
    ]
    assert client.get("/api/v1/activity").json()[0]["effective_cost"] == 500
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_activity_api.py -q`
Expected: FAIL (404 on `/api/v1/activity`).

- [ ] **Step 3: Implement the ledger service**

`backend/app/services/__init__.py`: empty file.

`backend/app/services/ledger.py`:

```python
"""Load the database into the pure domain Ledger."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import models
from app.domain import types as domain


def load_ledger(session: Session) -> domain.Ledger:
    return domain.Ledger(
        chains=tuple(
            domain.Chain(c.id, c.name, c.standard_ticket_price)
            for c in session.scalars(select(models.Chain))
        ),
        loads=tuple(
            domain.GiftCardLoad(g.id, g.chain_id, g.date, g.price_paid, g.face_value)
            for g in session.scalars(select(models.GiftCardLoad))
        ),
        # Fee charges join the ledger in M3 (subscriptions).
        fees=(),
        visits=tuple(
            domain.Visit(
                v.id, v.chain_id, v.date, v.my_cost, v.guest_count, v.guest_cost, v.payment_source
            )
            for v in session.scalars(select(models.Visit))
        ),
        credits=tuple(
            domain.Credit(c.id, c.chain_id, c.date, c.amount, c.destination)
            for c in session.scalars(select(models.Credit))
        ),
    )
```

- [ ] **Step 4: Implement activity and wallets**

`backend/app/api/v1/activity.py`:

```python
import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import SessionDep
from app.db import models
from app.domain.allocation import allocate
from app.domain.money import format_cents
from app.services.ledger import load_ledger

router = APIRouter(tags=["activity"])

type EntryKind = Literal["visit", "gift_card", "credit"]
_KIND_ORDER: dict[str, int] = {"credit": 0, "visit": 1, "gift_card": 2}


class ActivityEntry(BaseModel):
    kind: EntryKind
    id: int
    date: dt.date
    chain_id: int | None
    description: str
    amount: int
    payment_source: str | None
    effective_cost: int | None


@router.get("/activity", response_model=list[ActivityEntry])
def list_activity(
    session: SessionDep,
    kind: EntryKind | None = None,
    chain_id: int | None = None,
    month: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
) -> list[ActivityEntry]:
    ledger = load_ledger(session)
    alloc = allocate(ledger)
    chain_names = {chain.id: chain.name for chain in ledger.chains}
    entries: list[ActivityEntry] = []

    for v in session.scalars(select(models.Visit)):
        guests = f" (+{v.guest_count} guest{'' if v.guest_count == 1 else 's'})"
        entries.append(
            ActivityEntry(
                kind="visit",
                id=v.id,
                date=v.date,
                chain_id=v.chain_id,
                description=v.title + (guests if v.guest_count else ""),
                amount=v.my_cost + v.guest_cost,
                payment_source=v.payment_source.value,
                effective_cost=alloc.effective_cost(("visit", v.id), v.my_cost, v.payment_source)
                + alloc.effective_cost(("guest", v.id), v.guest_cost, v.payment_source),
            )
        )
    for g in session.scalars(select(models.GiftCardLoad)):
        entries.append(
            ActivityEntry(
                kind="gift_card",
                id=g.id,
                date=g.date,
                chain_id=g.chain_id,
                description=f"{chain_names[g.chain_id]} gift card ({format_cents(g.face_value)} value)",
                amount=g.price_paid,
                payment_source=None,
                effective_cost=g.price_paid,
            )
        )
    for c in session.scalars(select(models.Credit)):
        entries.append(
            ActivityEntry(
                kind="credit",
                id=c.id,
                date=c.date,
                chain_id=c.chain_id,
                description=c.note or "Credit",
                amount=-c.amount,
                payment_source=c.destination.value,
                effective_cost=None,
            )
        )

    entries = [
        e
        for e in entries
        if (kind is None or e.kind == kind)
        and (chain_id is None or e.chain_id == chain_id)
        and (month is None or e.date.strftime("%Y-%m") == month)
    ]
    entries.sort(key=lambda e: (e.date, -_KIND_ORDER[e.kind], e.id), reverse=True)
    return entries
```

On the sort: with `reverse=True`, the newest date comes first. Within a day, the order is credit, then visit, then gift card, and within a kind the higher id comes first.

`backend/app/api/v1/wallets.py`:

```python
from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import SessionDep, TodayDep
from app.domain.allocation import allocate
from app.domain.wallet import wallet_balance
from app.services.ledger import load_ledger

router = APIRouter(tags=["wallets"])


class WalletOut(BaseModel):
    chain_id: int
    chain_name: str
    balance: int
    uncovered: int


@router.get("/wallets", response_model=list[WalletOut])
def list_wallets(session: SessionDep, today: TodayDep) -> list[WalletOut]:
    ledger = load_ledger(session)
    alloc = allocate(ledger)
    return [
        WalletOut(
            chain_id=chain.id,
            chain_name=chain.name,
            balance=wallet_balance(ledger, chain.id, as_of=today),
            uncovered=alloc.uncovered_by_chain.get(chain.id, 0),
        )
        for chain in sorted(ledger.chains, key=lambda c: c.name.lower())
    ]
```

`backend/app/api/v1/__init__.py` (final form for this plan):

```python
from fastapi import APIRouter

from app.api.v1 import activity, chains, credits, gift_cards, health, visits, wallets

api_router = APIRouter()
for module in (health, chains, gift_cards, visits, credits, activity, wallets):
    api_router.include_router(module.router)
```

- [ ] **Step 5: Run the full suite and checks**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run pyright`
Expected: all pass. (`ruff format` may reflow the dict literals in `test_activity_api.py`. Accept its output.)

- [ ] **Step 6: Manual smoke test**

```bash
uv run alembic upgrade head
uv run uvicorn app.main:create_app --factory
```

Open http://127.0.0.1:8000/docs, create a chain, a gift card and a gift-card-paid visit, then call `GET /api/v1/activity` and `GET /api/v1/wallets`. Expected: the same numbers as the tests. Delete the test rows afterwards, or delete `data/app.db` and re-run the migration.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add activity feed and wallet balances

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Deferred to later plans (by milestone)

- **M2:** React Router + TanStack Query shell, the Activity / Log visit / Add gift card / Add credit / Settings (chains) screens, OpenAPI → TypeScript type generation with a CI staleness check.
- **M3:** `subscription_plans` + `fee_charges` tables, idempotent fee generation, overrides, `load_ledger` fees, runway in `/wallets`.
- **M4:** TMDB client (`respx`-tested), `films` table + `visits.film_id`, poster cache, Films grid.
- **M5:** CSV import with the review flow and legacy-total checks ($228.00 / $268.41; 37 / 35 tickets).
- **M6:** dashboard endpoints (built on `app.domain.metrics`) and UI; Playwright smoke test.
