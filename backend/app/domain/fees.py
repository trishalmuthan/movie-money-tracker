"""When a subscription bills (spec §3 SubscriptionPlan / FeeCharge). Pure; no I/O."""

import datetime as dt


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
