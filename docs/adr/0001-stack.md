# ADR-0001: Stack and money representation

- Status: Accepted
- Date: 2026-10-24

## Context

A single-user, local-first app that must be easy to host later. Its core value is correct money arithmetic.

## Decision

- **Backend:** FastAPI, SQLAlchemy 2 and Alembic on SQLite, with Python 3.14 managed by uv. One process serves the API under `/api/v1` and the built SPA.
- **Frontend:** React, TypeScript, Vite and Tailwind CSS v4, with TanStack Query and Recharts added as features need them. Tested with Vitest and Testing Library.
- **Linting:** ruff and pyright for Python. oxlint for TypeScript: it's the current Vite template default, so we use it in place of ESLint.
- **Money:** integer cents end to end. Gift card spending is costed oldest-card-first with cumulative rounding (spec §4).
- **Money rules:** pure functions in `backend/app/domain/`, isolated from I/O.

## Consequences

- There are two toolchains (uv, npm) and two test suites, and CI runs both.
- Hosting later means swapping `DATABASE_URL` and adding auth. The app doesn't need restructuring.
- Effective costs are recomputed from the whole ledger on every request. That's fine at personal scale (hundreds of rows).
