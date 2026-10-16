# Movie Money Tracker: v1 Design Spec

- **Status:** Draft, awaiting review
- **Date:** 2026-10-14
- **Issue:** #1

## 1. Purpose

Movie Money Tracker answers one question: **what does my moviegoing actually cost?**

Today this lives in a Google Sheet with one tab per year and the columns *Item, Net Cost, Number of Tickets, Date*. The sheet has three kinds of row: films, monthly "Movie Club" subscription fees, and gift card purchases. The owner has an unlimited subscription, so most films cost $0.00. Occasionally there's a small booking fee (around $0.50) or tickets bought for friends. Gift cards are bought at a discount and their balance pays the monthly fee.

The sheet has two problems:

1. **It mixes money spent with balance loaded.** "Total Cost" sums every row. When a fee is paid from a gift card that was already counted, the money is counted twice, or the fee is simply never logged. The 2026 tab has no fees after March.
2. **It can't answer the interesting questions:** effective cost per movie after gift card discounts, remaining gift card balance, how much the unlimited plan is saving, and how this year compares to last year.

The app replaces the sheet. It's a local web app with TMDB posters to make the data pleasant to browse.

### Non-goals (v1)

- A film diary: no ratings, reviews, watchlists or social features.
- Hosting, authentication or multiple users. The app runs on localhost. The design keeps hosting possible later (see §7).
- Bank or theatre-account syncing. All data is entered by hand or imported.
- Tracking reimbursements from friends for guest tickets.

## 2. Glossary

| Term | Meaning |
| --- | --- |
| **Chain** | A theatre chain (Regal, Cinemark, …). Gift card balances and subscriptions belong to a chain. |
| **Gift card load** | Buying a gift card: *price paid* (cash out) for a *face value* (balance gained). |
| **Wallet** | The running gift card balance for a chain. |
| **Payment source** | How something was paid: `gift_card` (from the wallet), `bank` (direct cash) or `free` (nothing owed). |
| **Visit** | Me watching one film once. Guest tickets ride along on a visit but are not visits. |
| **Cash out** | Money that left my bank account. |
| **Effective cost** | What something really cost after gift card discounts. |

## 3. Domain model

All money is stored and computed as **integer cents**. Dates are calendar dates (no time of day).

### Chain

| Field | Type | Notes |
| --- | --- | --- |
| id | int | |
| name | str, unique | e.g. "Regal" |
| standard_ticket_price | cents | What a normal adult ticket costs. Used for the "vs full price" savings. |

### GiftCardLoad

| Field | Type | Notes |
| --- | --- | --- |
| id | int | |
| chain_id | FK Chain | |
| date | date | |
| price_paid | cents, > 0 | Cash out. |
| face_value | cents, ≥ price_paid | Balance added to the wallet. |
| note | str? | e.g. "Costco 2×$25" |

### SubscriptionPlan

A plan *period*. A price change ends one period and starts a new one.

| Field | Type | Notes |
| --- | --- | --- |
| id | int | |
| chain_id | FK Chain | |
| amount | cents, > 0 | Monthly fee. |
| billing_day | int 1–28 | Day of month the fee is charged. |
| start_date | date | First month billed is the first billing day on or after this date. |
| end_date | date? | Open-ended if null. |
| payment_source | `gift_card` \| `bank` | Default source for generated charges. |

Plan periods for the same chain must not overlap.

### FeeCharge

One row per billed month.

| Field | Type | Notes |
| --- | --- | --- |
| id | int | |
| plan_id | FK SubscriptionPlan | |
| date | date | The billing date. |
| amount | cents | Copied from the plan on generation. Editable per month (e.g. a one-off $12.99). |
| payment_source | `gift_card` \| `bank` | Copied from the plan. Editable per month. |
| is_overridden | bool | Set when edited, so plan changes don't overwrite it. |

**Generation:** on app start-up and on any plan change, charges are generated idempotently: one per (plan, billing month) up to and including today. Each charge is unique on (plan_id, year-month). Non-overridden charges belonging to a changed plan are recomputed. Deleting a plan is refused while it has overridden charges, and the user must end-date it instead.

### Visit

| Field | Type | Notes |
| --- | --- | --- |
| id | int | |
| date | date | |
| chain_id | FK Chain | |
| film_id | FK Film? | Null if not matched to TMDB. |
| title | str | Always stored, so a visit renders without TMDB. |
| my_cost | cents, ≥ 0 | Usually 0; e.g. 50 for an advance-booking fee. |
| guest_count | int, ≥ 0 | Extra tickets bought for others. |
| guest_cost | cents, ≥ 0 | Total paid for guest tickets. |
| payment_source | `gift_card` \| `bank` \| `free` | Must be `free` if and only if my_cost + guest_cost = 0. |
| note | str? | |

### Credit

Money coming back, e.g. the 2025 "Mission Impossible: Final Reckoning" row of −$7.17.

| Field | Type | Notes |
| --- | --- | --- |
| id | int | |
| date | date | |
| chain_id | FK Chain? | |
| amount | cents, > 0 | Stored positive. It **reduces** cash out. |
| destination | `gift_card` \| `bank` | Where the money went back to. A `gift_card` credit adds to the wallet. |
| note | str? | |

### Film (TMDB cache)

| Field | Type | Notes |
| --- | --- | --- |
| id | int | |
| tmdb_id | int, unique | |
| title | str | |
| release_year | int? | |
| poster_path | str? | TMDB path. The local cached file is derived from it. |
| fetched_at | datetime | |

## 4. Money rules

These rules are implemented as pure functions in `backend/app/domain/` (no database or web imports) and are the most heavily tested code in the project.

Notation: for a chain *c*, `L(c)` is its gift card loads and `G(c)` is everything paid from its wallet (fee charges, plus visits' `my_cost` + `guest_cost`, with `payment_source = gift_card`).

1. **Cash out** (per period) = Σ load `price_paid` + Σ bank-paid fee charges + Σ bank-paid visit (`my_cost` + `guest_cost`) − Σ bank credits. Everything is dated by its own date.
2. **Wallet balance** (per chain, as of a date) = Σ `face_value` of L(c) + Σ gift-card credits − Σ amounts of G(c). A negative balance is allowed (it means a top-up is needed) and is flagged on the dashboard.
3. **Runway** (per chain) = ⌊balance ÷ the active plan's amount⌋ months, shown only when the active plan pays from `gift_card`.
4. **Oldest card first (FIFO).** Each chain's wallet is a queue of *lots*, one per gift card load. Each lot is ordered by date, then id, and has a rate = `price_paid` ÷ `face_value`.
   - Gift-card-paid amounts in G(c) are processed in date order (ties broken by id). Each one draws from the oldest lot with money remaining, spilling into the next lot if needed.
   - A gift-card credit adds a lot with `price_paid` = 0 on its date. Refunded balance was already paid for once.
5. **Effective cost** of a gift-card-paid amount = the sum over its draws of round_half_up(draw × lot rate). Bank-paid amounts count at face.
   - Example: Card A was $35 for $50 (rate 0.70), so a $5.99 fee drawn from it costs **$4.19**. Buying a later card never changes it.
   - Split example: a $5.99 fee with $2.00 left on Card A (0.70) and the rest on Card B ($45 for $50, 0.90) costs $1.40 + $3.59 = **$4.99**.
   - **Exact totals:** the draw that empties a lot is costed at that lot's `price_paid` minus everything already costed from it. A fully used card's draws therefore add up to exactly its `price_paid`, with no rounding drift.
   - **Overdraft:** any part of a charge with no lot left is *uncovered*. It's costed at face (rate 1) and flagged on the dashboard. When a later load arrives, it covers that debt first, and the overdrawn charges are re-costed at the new lot's rate. This is the only way a later card changes an earlier number.
   - History only changes when an entry is added, edited or deleted with a date before the latest draw. Effective costs are recomputed from the full ledger each time, never stored.
6. **Cost per movie** (per period) = (Σ effective fee charges + Σ effective visit `my_cost`) ÷ number of visits. Undefined (shown as "—") when there are no visits.
7. **Guest spend** (per period) = Σ effective `guest_cost`. It's reported on its own and never counted in cost per movie.
8. **Savings**
   - **Gift card discount** = Σ (`face_value` − `price_paid`) over loads.
   - **Unlimited savings** (per period) = Σ over visits of the chain's `standard_ticket_price` − (Σ effective fees + Σ effective visit `my_cost`). This can be negative, which means the plan didn't pay off that period.

### Acceptance fixtures

The real sheet rows (2025 and 2026 tabs, as of 2026-10-14) become test fixtures:

- **Import fidelity:** for each imported tab, the *legacy total* (signed sum of the tab's sheet amounts) equals the sheet's own total: **$228.00** for the 2025 tab and **$268.41** for the 2026 tab. Totals are per tab, not per calendar year, because the 2026 tab includes a gift card bought on 2025-11-27. Total tickets (visits + guest tickets) equal the sheet's **37** and **35**.
- Hand-worked examples for rules 1–8, built from those rows with explicit face values and payment sources, are the expected outputs for the domain tests.

## 5. Features and screens

### 5.1 Dashboard (home)

- **Year filter:** each year present in the data, plus "All time". Defaults to the current year.
- **KPI tiles:** cash out, cost per movie, visits, wallet balance (per chain, with runway), total savings (discount + unlimited).
- **Monthly chart:** bars for cash out and effective cost per month, with a line for visits.
- **Year over year:** a table and chart comparing years by category (subscription fees, gift card loads, my ticket costs, guest spend, credits) and by chain.

### 5.2 Activity

One ledger of every entry (visits, loads, fee charges, credits), newest first.

- Filters: type, chain, month.
- Each row: date, type, description (film title / "Regal gift card" / "Movie Club fee"), amount, payment source.
- Edit and delete in place. Editing a fee charge marks it overridden.

### 5.3 Log a visit

A fast form that works in a phone browser on the local network.

- Film title search via TMDB (debounced). Picking a result fills in the title and poster. Free text is allowed when there's no match.
- Date (defaults to today), chain (defaults to the chain of the most recent visit), my cost (defaults to $0.00), guests (count + cost), payment source (defaults to `free` when costs are 0, otherwise `gift_card`).

### 5.4 Add gift card

Chain, date, price paid and face value, with the discount % shown live as you type.

### 5.5 Add credit

Date, chain, amount, destination and note.

### 5.6 Films

A poster grid of films I've seen. Each card shows the title, year, number of visits, my effective cost and guest tickets. It's a read-only view derived from visits.

### 5.7 Settings

- Chains: name and standard ticket price.
- Subscription plans: create, end-date, change price (which ends the current period and starts a new one).
- TMDB status: whether a key is configured and reachable.

### 5.8 Import (one-time)

1. Upload one CSV per sheet tab (Google Sheets → File → Download → CSV). The format is the first four columns *Item, Net Cost, Number of Tickets, Date*. Other columns are ignored.
2. **Classify** each row:
   - Item contains "Movie Club Fee" → fee charge.
   - Item contains "Gift Card" → gift card load.
   - Otherwise → visit (my ticket = 1, guest_count = tickets − 1).
   - A visit row with a negative net cost becomes a $0 visit **plus** a credit for the absolute amount on the same date (e.g. Mission Impossible, −$7.17).
3. **Review screen** (nothing is saved yet):
   - **Chain rule:** date ranges → chain (e.g. ≤ 2025-10-31 Cinemark, otherwise Regal). The gift card chain is pre-filled from the item text when it names one.
   - **Gift card face value:** required for each load. Pre-filled with price paid and flagged until confirmed.
   - **Visit cost split:** a visit with net cost > 0 and guests defaults to splitting the cost evenly between me and guests. Editable.
   - **Fee rows:** the review proposes subscription plan periods from the imported fees (amount changes start new periods). Imported fees become overridden charges at their real amounts and dates. Plan generation fills the months the sheet never logged.
   - **TMDB matching:** a best match per distinct title with poster thumbnails. Change or clear any match.
   - **Row errors** (unparseable date or amount) are listed and must be fixed or explicitly skipped. Rows are never silently dropped.
4. **Commit** writes everything in one transaction and shows the legacy totals (per uploaded file) for comparison against the sheet.

## 6. TMDB integration

- Uses the TMDB v3 API with a key from `TMDB_API_KEY` in `.env`. Free for non-commercial use.
- Search results and film details are cached in the `Film` table. Poster images are downloaded once to a local cache directory and served by the backend.
- **Graceful degradation:** with no key, no network or no match, the app still works fully. Films show a generated title placeholder instead of a poster.
- TMDB attribution ("This product uses the TMDB API but is not endorsed or certified by TMDB") appears in the app footer, as their terms require.

## 7. Architecture

```text
movie-money-tracker/
├── backend/            FastAPI app (uv project)
│   ├── app/
│   │   ├── domain/     pure money rules (§4), no I/O
│   │   ├── db/         SQLAlchemy models + session
│   │   ├── api/v1/     routers + Pydantic schemas
│   │   ├── services/   orchestration: fee generation, import, TMDB client
│   │   └── main.py
│   ├── migrations/     Alembic
│   └── tests/
├── frontend/           Vite + React + TypeScript
│   └── src/            routes, components, api client (generated types)
└── docs/               specs, ADRs
```

- **Backend:** Python 3.14, FastAPI, SQLAlchemy 2, Alembic, Pydantic v2, httpx.
  - SQLite database at the path in `DATABASE_URL` (default `./data/app.db`).
  - Every endpoint is under `/api/v1`.
- **Frontend:** React, TypeScript, React Router, TanStack Query, Recharts, Tailwind CSS.
  - API types are generated from FastAPI's OpenAPI schema with `openapi-typescript`. CI fails if they're stale.
- **Running it:**
  - Development: `uvicorn` with Vite's dev server proxying `/api`.
  - Everyday local use: `frontend` is built, then FastAPI serves `frontend/dist` alongside the API as one process.
- **Hosting later:** config comes only from env vars, there's a single process, and migrations go through Alembic. Moving to Postgres and adding auth would be a later milestone, not v1.

## 8. Validation and error handling

- **API validation (422 with field errors):**
  - `face_value ≥ price_paid > 0`;
  - non-negative costs;
  - `payment_source` consistent with costs;
  - billing day 1–28;
  - no overlapping plan periods;
  - dates not in the future, except plan end dates.
- TMDB failures (timeouts, 401, 429) are logged and never fail a user action. The UI shows "poster unavailable".
- Import errors are surfaced per row in review (see §5.8).
- The frontend shows API errors inline on forms, and a toast for unexpected failures.

## 9. Testing

- **Domain:** pytest, written test-first.
  - Each rule in §4 has hand-worked cases, including the real-sheet fixtures.
  - Edge cases: no loads, negative wallet, zero visits, rounding.
- **API:** FastAPI `TestClient` against a temporary SQLite database for each test. Covers CRUD, validation errors, fee generation idempotency and the import commit.
- **TMDB:** the client is tested with recorded responses (`respx`). There are no live calls in CI.
- **Frontend:** Vitest + Testing Library for forms and dashboard components.
- **End-to-end:** one Playwright smoke test: start the app, log a visit, see it on the dashboard and in Activity.
- **CI (GitHub Actions, every PR):**
  - backend: `ruff check`, `ruff format --check`, `pyright`, `pytest`;
  - frontend: `eslint`, `tsc --noEmit`, `vitest run`, OpenAPI types up to date.

## 10. Development process

- **Tracking:** GitHub Issues, with labels `type:*` (feature / bug / chore / docs), `area:*` (backend / frontend / infra) and `priority:p1–p3`.
  - Milestones are listed in §11.
  - A GitHub Projects board has the columns Backlog → Ready → In Progress → In Review → Done.
- **Branches:** `<type>/<issue#>-<slug>`, e.g. `feat/14-wallet-balance`. One issue per branch.
- **Pull requests:**
  - use the PR template;
  - include `Closes #n`;
  - need green CI to merge;
  - merge by squash only, with linear history on `main`.
  - `main` is protected (no direct pushes).
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).
- **Decisions:** short ADRs in `docs/adr/` for significant choices. The first one records the stack.

## 11. Milestones

| # | Milestone | Outcome |
| --- | --- | --- |
| M0 | Foundation | Backend and frontend scaffolds, CI, PR/issue templates, ADR-001, branch protection with required checks. |
| M1 | Ledger core | Domain money rules (§4), DB models + migrations, CRUD API for chains, loads, visits and credits. |
| M2 | App shell + logging UI | Layout/navigation, Activity, Log visit (no TMDB yet), Add gift card, Add credit, Settings (chains). |
| M3 | Subscriptions | Plan periods, fee generation, per-month overrides, Settings → plans. |
| M4 | TMDB | Search, film cache, poster cache, Films grid, posters across the UI. |
| M5 | Import | CSV upload, classify, review, commit; verified against the real sheet. |
| M6 | Dashboard | KPIs, monthly chart, year over year, wallet runway, savings. |

v1 is done when M0–M6 are merged, the real sheet history is imported, and the import's per-tab legacy totals match the sheet.
