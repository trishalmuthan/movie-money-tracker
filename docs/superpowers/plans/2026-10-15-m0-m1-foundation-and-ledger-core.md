# M0 Foundation + M1 Ledger Core: Implementation Plan

**Goal:** A tested local backend for chains, gift card loads, visits and credits. It computes oldest-card-first effective costs, wallet balances and the spec's money metrics. Alongside it: a frontend scaffold, CI, and the GitHub workflow every later milestone uses.

**Spec:** [`docs/superpowers/specs/2026-10-14-movie-money-tracker-design.md`](../specs/2026-10-14-movie-money-tracker-design.md). §4 (money rules) is the contract for Tasks 4–6.

**Workflow:** each task below becomes a GitHub issue, and its text is the issue body. Claude implements each one on `<type>/<issue#>-<slug>` and opens a PR with `Closes #n`. Trishal reviews and merges once CI is green. Tests are written first.

## Global constraints

- All money is **integer cents**. No floats anywhere in money code.
- Python ≥ 3.14 via `uv` (in `backend/`). Node 24 (in `frontend/`).
- Every endpoint lives under `/api/v1`.
- Config comes only from env vars / a repo-root `.env` (`DATABASE_URL`, `TMDB_API_KEY`). Default DB: `<repo>/data/app.db` (gitignored).
- `backend/app/domain/` is pure: no SQLAlchemy, FastAPI or DB/API imports.
- Effective cost is **oldest card first** with cumulative rounding (spec §4 rules 4–5). It's recomputed from the full ledger on every read and never stored.
- Dates can't be in the future (422). "Today" comes from an injectable dependency so tests can pin it.
- Quality gates on every PR: `ruff check`, `ruff format --check`, `pyright`, `pytest` · `eslint`, `tsc`, `vitest`.

## Review focus

These are the cases most likely to bite in real use, each pinned by a test in the task that owns it:

1. **A gift card bought the same day as a charge** covers that charge, even if the charge was entered first. *(Task 5)*
2. **Spreadsheet-style dollar text** (`"$1,234.56"`, `"0.5"`, `"-$7.17"`) parses exactly. Junk (`""`, `"1.234"`) raises an error and is never rounded silently. *(Task 4)*
3. **Deleting a chain that still has entries** returns a 409 with a clear message, not a 500 or orphaned rows. *(Task 8)*
4. **A visit dated today** is accepted, and **tomorrow** is a 422 on `date`. *(Task 10)*
5. **Adding "regal" when "Regal" exists**, or a name with stray spaces: names are trimmed, and a case-insensitive duplicate returns 409. *(Task 8)*

## Reference scenario (used by Tasks 5, 6 and 11)

A slice of the real 2026 sheet, assuming the first Regal card was **$35 for $50** (rate 0.70) and Regal's standard ticket price is **$15.00**:

| Date | Entry | Paid from | Amount | Effective cost |
| --- | --- | --- | --- | --- |
| Jan 1 | Gift card $35 → $50 | bank | 3500 | |
| Jan 22 | Fee | gift card | 599 | **419** |
| Feb 1 | No Other Choice | free | 0 | 0 |
| Feb 15 | Project Hail Mary: mine 650 + 3 guests 1950 | gift card | 2600 | **455 + 1365** |
| Feb 16 | How to Make a Killing | bank | 500 | 500 |
| Feb 22 | Fee | gift card | 599 | **420** |
| Mar 22 | Fee | gift card | 599 | **419** |

Costs are rounded cumulatively per card: each draw costs round(total drawn so far × rate) − round(total before × rate). For Jan–Mar this gives:

- **cash out:** $40.00;
- **visits:** 3;
- **cost per movie:** (1258 + 955) ÷ 3 = **$7.38**;
- **guest spend:** $13.65;
- **gift card discount:** $15.00;
- **unlimited savings:** 4500 − 2213 = **$22.87**;
- **wallet balance** at the end: **$6.03**.

---

## M0: Foundation

### Task 1: Backend scaffold · `chore/…-backend-scaffold`

Move the root `uv` project into `backend/`. Add a FastAPI app factory with a health endpoint, and serve the built SPA when one exists.

- **Scope:**
  - `backend/` with `pyproject.toml` (deps + ruff/pyright/pytest config);
  - `app/config.py` (`Settings`, `get_settings`);
  - `app/main.py` (`create_app(settings)`, run with `uvicorn app.main:create_app --factory`);
  - `app/api/v1/health.py`.
  - Delete the root `main.py`.
- **Acceptance:**
  - `GET /api/v1/health` → `{"status": "ok"}`.
  - With `frontend/dist` present, `/` and deep links like `/films/42` return `index.html` and assets are served. Unknown `/api/...` paths still 404.
  - With no build present, only the API is served.

### Task 2: Frontend scaffold · `chore/…-frontend-scaffold`

A Vite React TypeScript app in `frontend/` with Tailwind v4, Vitest + Testing Library, and a dev proxy from `/api` to `127.0.0.1:8000`.

- **Acceptance:**
  - The page shows "Movie Money Tracker" and "API: ok", or "API: down" when the health call fails. Both states are tested with a mocked `fetch`.
  - `npm run build` output is served by the backend at <http://127.0.0.1:8000>.
  - Template boilerplate is removed.

### Task 3: CI, templates, ADR · `chore/…-ci-and-templates`

- **Scope:**
  - `.github/workflows/ci.yml` with jobs **`backend`** and **`frontend`** running the quality gates above;
  - a PR template (Closes #, What/Why/How tested, checklist);
  - issue forms for feature/bug/chore (blank issues disabled);
  - `docs/adr/0001-stack.md`;
  - `.env.example`;
  - a README section on development and workflow.
- **Acceptance:**
  - CI is green on this PR.
  - `backend` and `frontend` are then made **required checks** on `main`.

## M1: Ledger core

### Task 4: Money primitives · `feat/…-money-primitives`

`app/domain/money.py`:

- `Cents` type;
- `parse_dollars(text) -> Cents`;
- `format_cents(cents) -> str`;
- `div_round_half_up(n, d) -> int`.

- **Acceptance:**
  - Parsing: `"5.99"`→599, `"$5.99"`→599, `" 0.50 "`→50, `"0.5"`→50, `"35"`→3500, `"-$7.17"`→−717, `"$1,234.56"`→123456.
  - These raise `ValueError`: `""`, `"abc"`, `"1.234"`, `"5.99.1"`, `"$"`, `"1,23.00"`, `"--5"`.
  - Formatting: 599→`$5.99`, −717→`-$7.17`, 123456→`$1,234.56`.
  - Rounding: 4193/10→419, 5/10→1, 2213/3→738. A negative numerator or a zero denominator raises.

### Task 5: FIFO allocation + wallet balance · `feat/…-fifo-allocation`

Implements spec §4 rules 2–5.

- **Domain types** (`app/domain/types.py`): `PaymentSource`, `CreditDestination`, `Chain`, `GiftCardLoad`, `FeeCharge`, `Visit`, `Credit`, and `Ledger` (tuples of each). All frozen dataclasses.
- **`allocate(ledger) -> Allocation`**, which gives:
  - effective cost per gift-card-paid spend, keyed by `("fee"|"visit"|"guest", id)`;
  - uncovered amounts per spend and per chain;
  - an `effective_cost(key, amount, source)` helper (bank and free entries count at face).
- **`wallet_balance(ledger, chain_id, as_of=None)`** and **`runway(balance, monthly_fee)`**.

- **Acceptance:**
  - A $5.99 fee from a $35/$50 card costs **419**. Adding a later card leaves it at 419.
  - A charge split across cards uses each card's rate: $2.00 at 0.70 + $3.99 at 0.90 = **140 + 359**.
  - A fully used card's draws add up to exactly its price: a $10/$30 card with three $10 fees costs **333, 334, 333**.
  - A card bought the same day as a fee covers it, even when the card's id is higher. *(Review focus 1)*
  - A fee with no card money is **uncovered** and counted at face. A later card pays that debt first and re-costs it at the new card's rate (419, then 420).
  - Visit costs are split into my ticket and guests (455 / 1365 in the reference scenario).
  - A gift-card credit adds balance that cost $0. Each chain has its own wallet.
  - Wallet balance = face value + gift-card credits − gift-card spending. It can be negative and supports `as_of`.
  - Runway is whole months covered: (1200, 599)→2, (−5, 599)→0, a fee of 0→None.

### Task 6: Money metrics · `feat/…-money-metrics`

Implements spec §4 rules 1 and 6–8 in `app/domain/metrics.py`:

- `Period` (inclusive, with `Period.year`, `Period.month`);
- `cash_out`, `visit_count`, `cost_per_movie`, `guest_spend`, `gift_card_discount`, `unlimited_savings`.

- **Acceptance:**
  - Every Jan–Mar figure in the reference scenario matches.
  - February alone: cash out **500**, cost per movie **458**.
  - January: cost per movie is `None` (no visits), and unlimited savings is **−419**.
  - A bank credit reduces cash out. A gift-card credit doesn't.

### Task 7: DB models + migrations · `feat/…-db-models`

- **Scope:**
  - SQLAlchemy 2 models for `chains`, `gift_card_loads`, `visits` and `credits`, mirroring spec §3. Fee and plan tables come in M3, films in M4.
  - Check constraints:
    - prices ≥ 0;
    - `face_value ≥ price_paid > 0`;
    - non-negative visit costs;
    - credit amount > 0.
  - Foreign keys with `RESTRICT`. SQLite foreign keys turned on.
  - Alembic with an initial migration.
  - The engine and session factory are wired into `create_app`. `SessionDep` and `TodayDep` dependencies are added.
- **Acceptance:**
  - The database itself rejects face value below price, and an unknown chain id.
  - Migrating to the latest version produces exactly the models' schema (test compares them).
  - `uv run alembic upgrade head` creates `data/app.db`.

### Task 8: Chains API · `feat/…-chains-api`

`GET`/`POST /chains` and `PUT`/`DELETE /chains/{id}`. The body is `{name, standard_ticket_price}`.

- **Acceptance:**
  - Create returns 201 with `id`. The list is sorted by name.
  - Names are trimmed, and a case-insensitive duplicate returns 409. A chain can be renamed to a different case of its own name. *(Review focus 5)*
  - A blank name or a negative price returns 422. A missing id returns 404.
  - Deleting a chain that has entries returns **409** ("still has entries"), and the chain is kept. *(Review focus 3)*

### Task 9: Gift cards API · `feat/…-gift-cards-api`

`GET /gift-cards?chain_id=`, `POST`, `PUT`/`DELETE /gift-cards/{id}`. The body is `{chain_id, date, price_paid, face_value, note?}`.

- **Acceptance:**
  - The list is newest first and filterable by chain.
  - Face value below price → 422. A price of 0 → 422.
  - An unknown chain → 422 on `["body","chain_id"]`. A future date → 422 on `["body","date"]`.
  - Update and delete work. A missing id returns 404.

### Task 10: Visits + credits API · `feat/…-visits-credits-api`

- **Visits:** `GET /visits?chain_id=`, `POST`, `PUT`/`DELETE /visits/{id}`. The body is `{date, chain_id, title, my_cost=0, guest_count=0, guest_cost=0, payment_source, note?}`.
- **Credits:** `GET /credits`, `POST`, `PUT`/`DELETE /credits/{id}`. The body is `{date, chain_id?, amount, destination, note?}`.

- **Acceptance:**
  - `payment_source` is `free` exactly when my_cost + guest_cost is 0. Otherwise → 422.
  - A guest cost with 0 guests → 422. A blank title → 422.
  - A visit dated today → 201, and tomorrow → 422 on `date`. *(Review focus 4)*
  - A credit amount must be > 0. A `gift_card` credit needs a chain, while a bank credit may have none.
  - Both lists are newest first. Update and delete work.

### Task 11: Activity feed + wallets API · `feat/…-activity-wallets-api`

- **`load_ledger(session) -> Ledger`** in `app/services/ledger.py`. Fees stay empty until M3.
- **`GET /activity?kind=&chain_id=&month=YYYY-MM`** returns one newest-first list of visits, gift cards and credits. Each item is `{kind, id, date, chain_id, description, amount, payment_source, effective_cost}`.
- **`GET /wallets`** returns `{chain_id, chain_name, balance, uncovered}` for each chain, with balance as of today.

- **Acceptance:** the reference scenario entered through the API, plus a $7.17 bank refund, returns:
  - "Project Hail Mary (+3 guests)" with amount 2600 and effective cost **1820**;
  - "Regal gift card ($50.00 value)" with amount 3500;
  - the refund with amount **−717**;
  - filters that work, and an invalid month (`2026-13`) → 422;
  - a Regal wallet balance of **2400** with nothing uncovered.

  Separately, a gift-card-paid visit at a chain with no cards shows a balance of −500 and 500 uncovered.

---

## Later milestones (planned when we get there)

- **M2** App shell + logging UI, including OpenAPI → TypeScript types.
- **M3** Subscription plans and auto-generated fees, which also add runway to `/wallets`.
- **M4** TMDB.
- **M5** Sheet import (legacy totals $228.00 / $268.41; 37 / 35 tickets).
- **M6** Dashboard plus the Playwright smoke test.
