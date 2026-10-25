"""When a subscription bills (spec §3 SubscriptionPlan / FeeCharge). Pure; no I/O."""

import datetime as dt
from collections.abc import Sequence
from dataclasses import dataclass

from app.domain.money import Cents
from app.domain.types import PaymentSource


def billing_dates(
    start: dt.date, end: dt.date | None, billing_day: int, today: dt.date
) -> list[dt.date]:
    """Every billing date in [start, end] that is due by `today` (inclusive), oldest first.

    `billing_day` is 1-28, so every month has it. The first bill is the first
    billing day on or after `start`.
    """
    if not 1 <= billing_day <= 28:
        raise ValueError(f"billing_day must be 1-28, got {billing_day}")
    last = today if end is None else min(end, today)
    dates: list[dt.date] = []
    year, month = start.year, start.month
    while (candidate := dt.date(year, month, billing_day)) <= last:
        if candidate >= start:
            dates.append(candidate)
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return dates


def month_key(day: dt.date) -> str:
    """The "YYYY-MM" a charge is filed under."""
    return f"{day.year:04d}-{day.month:02d}"


@dataclass(frozen=True, slots=True)
class PlanTerms:
    start_date: dt.date
    end_date: dt.date | None
    billing_day: int
    amount: Cents
    payment_source: PaymentSource


@dataclass(frozen=True, slots=True)
class DueCharge:
    month: str
    date: dt.date
    amount: Cents
    payment_source: PaymentSource


@dataclass(frozen=True, slots=True)
class StoredCharge:
    id: int
    month: str
    date: dt.date
    amount: Cents
    payment_source: PaymentSource
    is_overridden: bool


@dataclass(frozen=True, slots=True)
class ChargeSync:
    create: tuple[DueCharge, ...]
    update: tuple[tuple[int, DueCharge], ...]  # (stored id, new values)
    delete: tuple[int, ...]
    stranded: tuple[str, ...]  # overridden months outside the plan's dates; left alone


def sync_charges(plan: PlanTerms, stored: Sequence[StoredCharge], today: dt.date) -> ChargeSync:
    """Bring one plan's stored charges in line with its terms. Overridden charges are never touched."""
    due = {
        month_key(day): DueCharge(month_key(day), day, plan.amount, plan.payment_source)
        for day in billing_dates(plan.start_date, plan.end_date, plan.billing_day, today)
    }
    by_month = {charge.month: charge for charge in stored}
    update: list[tuple[int, DueCharge]] = []
    delete: list[int] = []
    stranded: list[str] = []
    for charge in sorted(stored, key=lambda c: c.month):
        wanted = due.get(charge.month)
        if charge.is_overridden:
            if wanted is None:
                stranded.append(charge.month)
        elif wanted is None:
            delete.append(charge.id)
        elif (charge.date, charge.amount, charge.payment_source) != (
            wanted.date,
            wanted.amount,
            wanted.payment_source,
        ):
            update.append((charge.id, wanted))
    create = tuple(charge for month, charge in due.items() if month not in by_month)
    return ChargeSync(create, tuple(update), tuple(delete), tuple(stranded))
