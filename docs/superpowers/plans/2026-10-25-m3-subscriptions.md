# M3 Subscriptions: Implementation Plan

**Goal:** Stop logging the monthly fee by hand. You describe your subscription once (chain, amount, billing day, paid from gift card or bank) and the app creates each month's fee by itself. The fees then flow into wallet balances, effective costs and Activity. You can still correct any single month.

**Spec:** [`docs/superpowers/specs/2026-10-14-movie-money-tracker-design.md`](../specs/2026-10-14-movie-money-tracker-design.md), §3 (SubscriptionPlan, FeeCharge), §4 rules 2–5 (fees spend from the wallet), §5.7 (Settings → plans). The domain layer already handles fees (`FeeCharge` in `allocate` / `wallet_balance` / metrics since #20–#21). M3 stores them and generates them.

**Workflow:** same as M1/M2. Each task becomes an issue and a branch, then a PR that Trishal reviews.

## Decisions for this milestone

- **A fee the wallet can't cover is flagged, not guessed** (confirmed with Trishal). It shows as "not covered by gift card balance". If your bank card was actually charged, you edit that month to *Bank*.
- **Price changes are new plan periods.** "Change price from <month>" ends the current period and starts a new one, so past months keep their old price.
- **A skipped month is an override to $0.00.** It stays visible in Activity and moves no money. There's no separate "pause" concept.
- **Generation is lazy and idempotent.** Due charges are created whenever the ledger is read and after any plan change. That covers spec §3's "on start-up and on plan change", plus a running app crossing a billing day.
- **Billing day is 1–28**, so every month has it.

## Global constraints

- Everything from the M1/M2 plans still applies: integer cents, `/api/v1`, typed client regenerated (`npm run gen:api`), the quality gates, and the real-backend contract check plus screenshots for UI PRs.
- Fee generation is a **pure domain function** (`app/domain/`), tested without a database.
- An overridden charge (`is_overridden`) is never changed or deleted by generation.

## Review focus

1. **Generating twice** (two reads, a restart, a plan edit) never duplicates a month. *(Tasks 1–2)*
2. **A plan starting mid-month** bills from the first billing day on or after the start: a plan starting Jan 25 with billing day 22 first bills Feb 22. *(Task 1)*
3. **Changing the price** doesn't touch months before the change, or months you overrode. *(Task 2)*
4. **Ending a plan or moving its end earlier** removes generated charges after the end, and is refused (409) if any of those months were overridden. *(Task 2)*
5. **A fee with no card money behind it** shows as uncovered on the wallet and in Activity, until you add a card or switch that month to Bank. *(Tasks 3, 6)*

## Reference scenario (Tasks 1–3, 6)

Regal, **$5.99 on the 22nd from 2026-01-01, paid from gift card**, then the price changes to **$12.99 from June 2026**. Today is **2026-10-15**.

- **Charges:** Jan 22 – May 22 at $5.99 (5 months), then Jun 22 – Sep 22 at $12.99 (4 months), for **9 charges** in total. Oct 22 isn't due yet.
- **March overridden to $0.00 (skipped):** 8 charges move money, totalling 4 × 599 + 4 × 1299 = **$75.92**.
- **With the M1 reference card ($35 → $50)** as the only card, and no other gift-card spending: $50.00 − $75.92 leaves **$25.92 uncovered**.
- **Runway:** with a balance of $24.00 and a current fee of $12.99, runway = ⌊2400 / 1299⌋ = **1 month**.

---

### Task 1: Plan and fee tables + the fee schedule · `feat/…-fee-schedule`

- **Scope:**
  - Tables `subscription_plans` (chain, amount, billing_day 1–28, start_date, end_date?, payment_source) and `fee_charges` (plan, date, amount ≥ 0, payment_source, is_overridden), unique on (plan, year-month), with a migration.
  - A pure `billing_dates(start, end, billing_day, today) -> list[date]` in `app/domain/fees.py`.
- **Acceptance:**
  - For the reference plan, `billing_dates` gives Jan 22 … Sep 22 (9 dates) on 2026-10-15, and 10 dates on 2026-10-22.
  - A start of Jan 25 gives Feb 22 first. An end of May 31 stops at May 22. An end before the first billing day gives `[]`.
  - The migration matches the models (existing test), and the DB rejects billing day 29 and a duplicate (plan, month).

### Task 2: Plans API + fee generation · `feat/…-plans-api`

- **Scope:**
  - `ensure_fee_charges(session, today)`:
    - creates the missing due charges;
    - updates the amount and source of non-overridden charges from their plan;
    - deletes non-overridden charges outside their plan's dates.
  - Endpoints:
    - `GET/POST /plans`;
    - `POST /plans/{id}/change-price {amount, from_month}`, which ends the current period at the end of the month before and creates the new one;
    - `PUT /plans/{id}` (edit or end-date);
    - `DELETE /plans/{id}`.
  - Every plan write runs generation.
- **Acceptance:**
  - The reference plan creates 9 charges. Calling generation again creates 0 new ones. *(Review focus 1)*
  - Changing the price from 2026-06 gives May at 599 and June at 1299. An overridden April stays as it was. *(Review focus 3)*
  - Two periods for the same chain can't overlap (409).
  - Ending a plan at 2026-07-31 removes the Aug and Sep charges. If August was overridden, that's refused with a 409 naming the month. *(Review focus 4)*
  - Deleting a plan with overridden charges is refused with a 409; otherwise it removes the plan and its charges.

### Task 3: Fees in the ledger, Activity and wallets · `feat/…-fees-in-ledger`

- **Scope:**
  - `load_ledger` includes fee charges, after running `ensure_fee_charges(today)`.
  - `/activity` gains `kind=fee` ("Regal subscription").
  - `GET /fees/{id}`, `PUT /fees/{id} {amount ≥ 0, payment_source}` (sets `is_overridden`), and `POST /fees/{id}/reset` (back to the plan's values).
  - `/wallets` gains `runway_months`: whole months covered by the active gift-card-paid plan, or null.
- **Acceptance:**
  - In the reference scenario plus the M1 card, the activity rows for fees show the effective costs from FIFO: Jan's $5.99 → **$4.19**.
  - Overriding March to 0 drops it from the wallet maths and flags it as overridden.
  - The wallet reports uncovered **2592** when the card runs out. *(Review focus 5)*
  - Reset restores the plan's amount and clears the override.
  - Runway is **1** for a balance of 2400 and a fee of 1299, and **null** for a bank-paid plan.

### Task 4: Settings → subscriptions · `feat/…-settings-plans`

- **Scope:** a Subscriptions section under the theatre chains in Settings.
  - Each plan shows its chain, amount, billing day, how it's paid, and its date range.
  - **Add a plan**, **Change price from** a month, **End** a plan, and **Delete** a plan, each with the same inline-confirm and error patterns as chains.
- **Acceptance:**
  - Adding Regal "5.99", day 22, from 2026-01-01, paid with gift card creates the plan, and Activity shows 9 fees afterwards (no reload).
  - "Change price from June 2026 to 12.99" shows two periods.
  - A 409 (overlap, or overridden months) appears inline on the action that caused it.
  - With no chains, the section links to adding one first.

### Task 5: Edit a month's fee · `feat/…-fee-form`

- **Scope:** `/fees/:id/edit`, with:
  - amount (dollars) and paid with (Gift card / Bank);
  - **Reset to plan** (shown only when overridden);
  - a line explaining that $0.00 means a skipped month.
- **Acceptance:**
  - Editing March to "0" saves `{amount: 0}` and returns to Activity, where March shows as skipped.
  - Switching a month to Bank removes it from the wallet and adds it to that month's cash out.
  - Reset restores $5.99 / gift card.

### Task 6: Fees on the Activity screen · `feat/…-activity-fees`

- **Scope:**
  - Fee rows ("Regal subscription, Paid with gift card") with an Edit link to Task 5's form.
  - A "Skipped" label for $0 months and an "edited" marker for overridden months.
  - A **Fees** option in the type filter.
  - The wallet strip shows **runway**, e.g. "covers about 4 more months".
  - Month cash out includes bank-paid fees.
- **Acceptance:**
  - In the reference scenario, March shows "Skipped".
  - A bank-paid fee adds to that month's cash out. A gift-card fee doesn't.
  - The wallet shows "covers about 1 more month" in the singular.
  - An uncovered fee shows "not covered by gift card balance" on the wallet, and its row shows the full price. *(Review focus 5)*

---

## Later milestones

- **M4** TMDB.
- **M5** Import: the sheet's fees become plan periods plus overridden months, as described in spec §5.8.
- **M6** Dashboard.
