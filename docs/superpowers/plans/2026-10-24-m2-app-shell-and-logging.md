# M2 App Shell + Logging UI: Implementation Plan

**Goal:** Use the app instead of the sheet for day-to-day logging. You can add chains, gift cards, visits and refunds in the browser, see everything in one Activity list with real effective costs and wallet balances, and fix or delete any entry.

**Spec:** [`docs/superpowers/specs/2026-10-14-movie-money-tracker-design.md`](../specs/2026-10-14-movie-money-tracker-design.md), §5.2–5.5 and §5.7 (chains only). Builds on the M1 API: `/chains`, `/gift-cards`, `/visits`, `/credits`, `/activity`, `/wallets`.

**Workflow:** same as M1. Each task becomes a GitHub issue, and its text is the issue body. Claude implements each one on `<type>/<issue#>-<slug>` and opens a PR. Trishal reviews and merges once CI is green.

## Decisions for this milestone

- **Look:** *cinema dark*. A near-black theatre background, light text, and one warm accent colour for money figures. Posters arrive in M4 and should stand out against it. Light mode isn't in scope.
- **Access:** localhost only (spec §5.3 updated in this PR). Layouts are still mobile-friendly, because a narrow browser window is a real use case.
- **Home:** until the dashboard exists (M6), `/` shows Activity.
- **Not in M2:** TMDB search and posters (M4), subscription fees (M3), import (M5), dashboard charts (M6). The visit title is free text for now.

## Global constraints

- Money is integer cents everywhere. The UI takes dollar text ("5.99", "$35") and converts it with a TypeScript `parseDollars` that matches the backend's cases exactly. It never uses floats for arithmetic.
- The frontend talks to the API only through one typed client, whose types are generated from FastAPI's OpenAPI schema. CI fails if the generated types are stale.
- API field errors (422 `detail[].loc`) appear next to the matching form field. Any other error shows as one inline message. Errors are never silently swallowed.
- Every screen works at 360 px wide with no horizontal scrolling.
- Quality gates are unchanged from M1, plus the types-up-to-date check.

## Review focus

1. **A dollar text that doesn't parse** (`"1.234"`, `"abc"`) shows a field error and blocks submit. It's never rounded or sent as `NaN`. *(Task 2 helpers, used by Tasks 5–6)*
2. **A server-side 422** (future date, unknown chain, face below price) lands on the right field, even when the client couldn't catch it first. *(Tasks 5–6)*
3. **Deleting a chain that has entries** shows the API's "still has entries" message, and the chain stays in the list. *(Task 4)*
4. **After any create, edit or delete,** the Activity list and wallet balances refresh without a page reload. *(Task 7)*
5. **Starting the app on a fresh database** works with no manual migration step. *(Task 1)*

---

### Task 1: Migrate on startup · `chore/…-migrate-on-startup`

This is the follow-up from PR #26. Today, starting the app before running `alembic upgrade head` makes every data endpoint return a bare 500.

- **Scope:**
  - `create_app` runs Alembic migrations to head on startup.
  - Tests keep building their own schema and skip the startup migration, so they stay fast.
  - The README run command drops the manual migrate step.
- **Acceptance:**
  - With an empty `DATABASE_URL` file, starting the app and calling `GET /api/v1/chains` returns `[]`, not a 500.
  - Starting the app twice is harmless.
  - The existing test suite is unchanged and green.

### Task 2: Typed API client + money helpers · `chore/…-api-client`

- **Scope:**
  - `npm run gen:api` exports FastAPI's OpenAPI schema and generates `frontend/src/api/schema.d.ts` with `openapi-typescript`. The generated file is committed.
  - A small client (`openapi-fetch`) wrapped for TanStack Query, with a `QueryClientProvider` at the root.
  - `src/lib/money.ts` with `parseDollars` and `formatCents`.
  - A CI step that regenerates the types and fails on any diff.
- **Acceptance:**
  - `parseDollars` / `formatCents` pass exactly the backend's cases from #8: `"$1,234.56"`→123456, `"0.5"`→50, `"-$7.17"`→−717, and `""`, `"1.234"`, `"1,23.00"` rejected.
  - Changing a backend schema without regenerating fails CI.
  - The health check on the existing page goes through the new client.

### Task 3: App shell + cinema-dark layout · `feat/…-app-shell`

- **Scope:**
  - React Router routes:
    - `/` (Activity)
    - `/visits/new`, `/visits/:id/edit`
    - `/gift-cards/new`, `/gift-cards/:id/edit`
    - `/credits/new`, `/credits/:id/edit`
    - `/settings`
    - a not-found page
  - Layout: top navigation on wide screens, a bottom tab bar on narrow ones, and a prominent "Log visit" action.
  - Design tokens: colours, type scale, and a money style for amounts.
  - Each route shows a placeholder page until its task lands.
- **Acceptance:**
  - Each route renders, unknown paths show the not-found page, and deep links work through the backend (`/settings` reloads fine at :8000).
  - The navigation highlights the current page.
  - At 360 px there's no horizontal scroll, and the tab bar is reachable.

### Task 4: Settings → chains · `feat/…-settings-chains`

- **Scope:** list chains with their standard ticket price, add a chain, edit name and price inline, delete.
- **Acceptance:**
  - Adding "Regal" at "15.00" stores 1500, and the list shows "$15.00".
  - Adding "regal" again shows the API's "already exists" message on the name field.
  - Deleting a chain that has entries shows "still has entries", and the chain stays. *(Review focus 3)*
  - An empty state invites you to add your first chain.

### Task 5: Log a visit · `feat/…-log-visit`

- **Scope:**
  - A form for date, chain, title, my cost, guest count, guest cost, payment source and note.
  - The same form edits an existing visit.
  - Adds `GET /api/v1/visits/{id}` to the backend.
- **Defaults:**
  - date: today;
  - chain: the most recent visit's chain (or the only chain);
  - costs: $0.00;
  - payment source: follows the costs (`free` at $0, otherwise `gift_card`) until you change it yourself.
- **Acceptance:**
  - Saving "Send Help" with the defaults creates a free $0 visit.
  - Setting my cost to "0.50" switches the payment source to gift card.
  - A guest cost with 0 guests shows the field error.
  - A future date or bad dollar text shows a field error. *(Review focus 1–2)*
  - On success you return to Activity and the new row is at the top.
  - Editing loads the saved values, and saving updates them.
  - Typing in the form doesn't trigger any request until you submit.

### Task 6: Add gift card + add credit · `feat/…-gift-card-credit-forms`

- **Scope:**
  - A gift card form (chain, date, price paid, face value, note) with a **live discount %**.
  - A credit form (date, amount, destination, chain, note).
  - Both forms also edit.
  - Adds `GET /api/v1/gift-cards/{id}` and `GET /api/v1/credits/{id}` to the backend.
- **Acceptance:**
  - Price "35" with face "50" shows **"30% off"** as you type.
  - Face below price shows an error before submit, and the server's 422 shows on `face_value` too.
  - A gift-card credit with no chain is blocked. A bank credit without a chain saves.
  - The credit amount is entered as a positive number (the form explains that credits reduce spending).

### Task 7: Activity screen · `feat/…-activity-screen`

- **Scope:**
  - A **wallet strip** at the top: each chain's balance, with a warning when uncovered > 0.
  - The ledger from `/activity`: date, type icon, description, amount, effective cost (shown only when it differs from the amount), and payment source.
  - Filters for type, chain and month, kept in the URL.
  - Edit opens the matching form. Delete asks for confirmation and then calls the right endpoint.
  - Grouped by month, with a month subtotal of amounts.
- **Acceptance (with the reference scenario from the M1 plan entered):**
  - "Project Hail Mary (+3 guests)" shows **$26.00**, with an effective **$18.20**.
  - The refund shows as **−$7.17**.
  - The Regal wallet shows **$24.00**.
  - Filtering `type=visit` hides the gift card and the credit. A reload keeps the filter.
  - Deleting a visit removes it, and the wallet updates without a reload. *(Review focus 4)*
  - A visit paid from a chain with no gift cards shows a "not covered by gift card balance" warning on that chain's wallet.
  - Empty state: "Nothing logged yet", with links to log a visit or add a gift card.

---

## Later milestones

- **M3** Subscriptions and auto-generated fees (fees then appear in Activity).
- **M4** TMDB: title search in the visit form, posters, Films grid.
- **M5** Sheet import.
- **M6** Dashboard (which takes over `/`).
