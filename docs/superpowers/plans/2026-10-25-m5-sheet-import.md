# M5 Sheet Import: Implementation Plan

**Goal:** Bring the Google Sheet's history into the app once. You download each tab as CSV, upload the files, and check what the app proposes on a review screen: chains, card values, guest splits, how things were paid, and subscription periods. Then you commit it in one go. After that the sheet is retired.

**Spec:** [`docs/superpowers/specs/2026-10-14-movie-money-tracker-design.md`](../specs/2026-10-14-movie-money-tracker-design.md), §5.8 (import), §4 (import fidelity), §3 (the tables it writes). The spec is updated in this PR for the decisions below.

**Workflow:** same as M1–M3. Each task becomes an issue and a branch, then a PR that Trishal reviews.

## Decisions for this milestone

- **Import before TMDB** (confirmed with Trishal). M5 ships before M4, so the import doesn't match posters. M4 matches posters for every existing visit instead.
- **A cutoff date splits ownership** (confirmed with Trishal). Rows dated on or after the cutoff are listed but not imported, so you can start logging in the app today without anything being entered twice.
- **The import runs once.** Committing records the import. A second commit is refused.
- **Preview is stateless.** The browser keeps the uploaded files and your review choices and sends them with every preview and with the commit. The server stores nothing until commit.
- **Chains must already exist.** The review picks from your chains and links to Settings if one is missing. The import never creates chains.
- **Your real sheet never goes in the repo**, because the repo is public. Tests use a made-up CSV shaped like the sheet. The real tabs are checked locally on a throwaway database, and PRs report only the totals.

## Global constraints

- Everything from the earlier plans still applies: integer cents, `/api/v1`, the typed client regenerated, the quality gates, the real-backend check, and screenshots for UI PRs.
- Parsing, classifying and building the proposal are **pure domain functions** (`app/domain/`), tested without a database.
- Rows are never silently dropped. Every row is imported, listed as after the cutoff, or skipped by you.

## Review focus

1. **Totals match the sheet.** Each file's legacy total (the signed sum of every row, including those after the cutoff) equals the tab's own total: **$228.00** and **$268.41**. Ticket counts are **37** and **35**. *(Tasks 1, 5)*
2. **Nothing is entered twice.** Rows on or after the cutoff aren't imported, and a second import is refused. *(Tasks 2, 3)*
3. **Fee history turns into plan periods** that reproduce the sheet's fees exactly. The months the sheet never logged get filled by the plan. *(Task 2)*
4. **Nothing is guessed silently.** Card values start unconfirmed and must be confirmed. Bad dates or amounts must be fixed or explicitly skipped. *(Tasks 1, 4, 5)*

## Reference scenario (made-up, sheet-shaped)

Two files, `2025.csv` and `2026.csv`, with columns *Item, Net Cost, Number of Tickets, Date* and dates like `5/22/2025`, in no particular order. Chains: Cinemark and Regal. Default chain rule: ≤ 2025-10-31 → Cinemark, otherwise Regal.

| Row | Becomes |
| --- | --- |
| `May 2025 Movie Club Fee, 11.99, , 5/22/2025` | Cinemark fee, $11.99, paid by bank (no card yet) |
| `Mission Impossible, -7.17, 1, 5/27/2025` | a $0 Cinemark visit **plus** a $7.17 refund to bank, same day |
| `The Life of Chuck, 5.00, 1, 6/2/2025` | Cinemark visit, $5.00, paid by bank |
| `Cinemark Gift Card, 40.00, , 7/6/2025` | Cinemark card, paid $40.00, value **unconfirmed** |
| `Superman, 0.00, 4, 7/15/2025` | free visit with 3 guests |
| `Bugonia, 1.75, 2, 11/4/2025` | Regal visit with 1 guest: mine $0.88, guest $0.87 |
| `Regal Gift Card Purchase, 35.00, , 11/27/2025` | Regal card, paid $35.00 |
| `Mystery row, abc, 1, 13/40/2025` | row error: must be fixed or skipped |

---

### Task 1: Parse and classify sheet CSVs · `feat/…-import-parse`

- **Scope:** pure functions in `app/domain/importing.py`:
  - `parse_sheet_csv(text) -> ParsedFile`: rows with line numbers, plus row errors (an unreadable date or amount, or a ticket count that isn't a whole number). Blank rows are ignored.
  - `classify(row)` follows spec §5.8:
    - "Movie Club Fee" → fee;
    - "Gift Card" → card (with its chain when the item text names one);
    - otherwise a visit (guests = tickets − 1), and a negative visit becomes a $0 visit plus a refund.
  - `legacy_total(file)` (the signed sum of every parseable row) and `ticket_total(file)`.
  - Visit cost split: an even split, with any odd cent going to my ticket.
- **Acceptance:**
  - The reference rows classify as in the table above, and the mystery row is an error naming line and column.
  - Bugonia splits 88/87, Superman has 3 guests, and Mission Impossible gives a visit plus a 717 refund.
  - The legacy total of the reference files equals the hand sum. "1,234.50", "$5.00" and "-7.17" parse correctly.

### Task 2: Build the import proposal · `feat/…-import-proposal`

- **Scope:** a pure `build_proposal(files, choices, existing) -> Proposal`, where:
  - `choices`: cutoff, chain rule (date ranges → chain), plus per-row overrides for chain, card value, split, payment and skip;
  - `existing`: chains, plus any plans already in the app.

  It produces the visits, cards, refunds and fees to write, plus:
  - rows after the cutoff (listed, not imported);
  - **proposed plan periods**: consecutive fees grouped by (chain, amount). Each period's billing day is its fees' most common day. Its start is the first of its first month and its end is the last day of its last month. The newest period is open-ended;
  - imported fees, as **overridden charges** at their real dates and amounts;
  - payment defaults (spec §5.8): gift card when a card for that chain was bought on or before the date, otherwise bank. Refunds go to bank;
  - the problems that block commit: row errors not fixed or skipped, card values not confirmed, a period overlapping a plan already in the app;
  - per file: the legacy total, the imported total, and ticket totals.
- **Acceptance:**
  - In the reference scenario, May 2025 has no card yet, so its fee and The Life of Chuck default to bank.
  - With a cutoff of 2025-11-01, Bugonia and the Regal card are listed as after the cutoff, and the legacy totals still include them. *(Review focus 1, 2)*
  - Fees of $11.99 for May–September, then $5.99, become two periods. A fee dated the 23rd in a period that bills on the 22nd stays the 23rd. *(Review focus 3)*
  - An open-ended Regal plan already in the app that overlaps a proposed period is reported as a blocking problem.

### Task 3: Import API · `feat/…-import-api`

- **Scope:**
  - A new `imports` table (committed_at, cutoff, per-file name, legacy total and ticket total), plus its migration.
  - `POST /import/preview {files: [{name, text}], choices}` → the proposal, with defaults filled in.
  - `POST /import/commit` (same body) writes everything in one transaction, including the plan periods. Generation then fills the months without fees. It returns the per-file totals.
  - `GET /import` reports whether an import has been committed, and its totals.
- **Acceptance:**
  - The reference files can be previewed any number of times without writing anything.
  - Committing writes the expected counts. A second commit returns 409 and changes nothing. *(Review focus 2)*
  - Commit with an unconfirmed card value or an unresolved row error returns 422 naming it. *(Review focus 4)*
  - After commit, `/activity` shows the imported rows. The months between the last imported fee and today appear as generated fees.

### Task 4: Import screen, part 1: upload and rules · `feat/…-import-upload`

- **Scope:**
  - An `/import` page, linked from Settings. It's hidden once an import has been committed, and shows its totals instead.
  - **Upload:** drop or pick one or more CSVs. Each file shows its row count and legacy total.
  - **Cutoff:** a date that defaults to today.
  - **Chain rule:** date ranges → chain, picked from your chains. Links to Settings when a chain is missing.
  - **Row errors:** fix the date or amount inline, or skip the row. Rows after the cutoff are listed in a collapsed group.
  - Every change re-runs preview.
- **Acceptance:**
  - Uploading the reference files shows "2025.csv, 7 rows" (the mystery row counted as an error) with its legacy total.
  - Moving the chain boundary to 2025-10-15 updates the visits' chains.
  - Fixing the mystery row's date clears its error, and skipping it removes it from the totals of what's imported.

### Task 5: Import screen, part 2: review and commit · `feat/…-import-review`

- **Scope:** the rest of the review, then commit:
  - **Gift cards:** a value field for each card, prefilled with the price paid and marked unconfirmed until you confirm it.
  - **Visits with a cost:** the split between you and guests, and how it was paid.
  - **Refunds:** where the money went (bank or card).
  - **Subscription periods:** edit chain, amount, billing day, dates and how it's paid.
  - **Blocking problems:** a summary that keeps Commit disabled until it's empty.
  - **Commit**, then a result screen with each file's legacy total next to the sheet's, and the imported totals.
- **Acceptance:**
  - Confirming the Cinemark card at $50.00 enables Commit. Committing lands on the result screen, and Activity shows the history (no reload).
  - **The real sheet**, checked locally on a throwaway database before this PR opens:
    - 2025 tab: legacy total $228.00, 37 tickets;
    - 2026 tab: legacy total $268.41, 35 tickets;
    - after commit, the fee months match the sheet, and the plan fills April 2026 onward.

    *(Review focus 1)*

---

## Later milestones

- **M4** TMDB, including matching posters for existing visits.
- **M6** Dashboard.
