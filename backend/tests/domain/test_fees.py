import datetime as dt

from app.domain.fees import (
    ChargeSync,
    DueCharge,
    PlanTerms,
    StoredCharge,
    billing_dates,
    sync_charges,
)
from app.domain.types import PaymentSource

D = dt.date
REFERENCE_START = D(2026, 1, 1)


def test_bills_on_the_billing_day_up_to_today() -> None:
    dates = billing_dates(REFERENCE_START, None, 22, today=D(2026, 10, 15))
    assert dates == [D(2026, m, 22) for m in range(1, 10)]  # Jan 22 … Sep 22


def test_billing_day_itself_counts_as_due() -> None:
    assert len(billing_dates(REFERENCE_START, None, 22, today=D(2026, 10, 22))) == 10


def test_starting_after_the_billing_day_bills_from_next_month() -> None:
    dates = billing_dates(D(2026, 1, 25), None, 22, today=D(2026, 3, 31))
    assert dates == [D(2026, 2, 22), D(2026, 3, 22)]


def test_starting_on_the_billing_day_bills_that_day() -> None:
    assert billing_dates(D(2026, 1, 22), None, 22, today=D(2026, 1, 22)) == [D(2026, 1, 22)]


def test_end_date_stops_billing() -> None:
    dates = billing_dates(REFERENCE_START, D(2026, 5, 31), 22, today=D(2026, 10, 15))
    assert dates[-1] == D(2026, 5, 22)
    assert len(dates) == 5


def test_ending_before_the_first_billing_day_bills_nothing() -> None:
    assert billing_dates(D(2026, 1, 1), D(2026, 1, 21), 22, today=D(2026, 10, 15)) == []


def test_future_start_bills_nothing_yet() -> None:
    assert billing_dates(D(2026, 11, 1), None, 22, today=D(2026, 10, 15)) == []


def test_crosses_year_boundaries() -> None:
    dates = billing_dates(D(2025, 11, 1), None, 1, today=D(2026, 2, 1))
    assert dates == [D(2025, 11, 1), D(2025, 12, 1), D(2026, 1, 1), D(2026, 2, 1)]


# --- sync_charges: what generation does to one plan's stored charges ---

GIFT = PaymentSource.GIFT_CARD
REFERENCE = PlanTerms(REFERENCE_START, None, 22, 599, GIFT)
TODAY = D(2026, 10, 15)


def _stored(month: int, *, id_: int | None = None, amount: int = 599, overridden: bool = False):
    return StoredCharge(
        id_ or month, f"2026-{month:02d}", D(2026, month, 22), amount, GIFT, overridden
    )


def test_creates_every_due_month_for_a_new_plan() -> None:
    sync = sync_charges(REFERENCE, [], TODAY)
    assert [c.month for c in sync.create] == [f"2026-{m:02d}" for m in range(1, 10)]
    assert sync.create[0] == DueCharge("2026-01", D(2026, 1, 22), 599, GIFT)
    assert (sync.update, sync.delete, sync.stranded) == ((), (), ())


def test_running_again_changes_nothing() -> None:
    first = sync_charges(REFERENCE, [], TODAY)
    stored = [
        StoredCharge(i, c.month, c.date, c.amount, c.payment_source, False)
        for i, c in enumerate(first.create)
    ]
    assert sync_charges(REFERENCE, stored, TODAY) == ChargeSync((), (), (), ())


def test_plan_edits_flow_into_generated_charges_but_not_overridden_ones() -> None:
    edited = PlanTerms(REFERENCE_START, None, 15, 699, PaymentSource.BANK)
    sync = sync_charges(edited, [_stored(1), _stored(2, overridden=True, amount=0)], TODAY)
    assert sync.update == ((1, DueCharge("2026-01", D(2026, 1, 15), 699, PaymentSource.BANK)),)
    assert [c.month for c in sync.create] == [
        f"2026-{m:02d}" for m in range(3, 11)
    ]  # Oct 15 now due


def test_charges_outside_the_dates_are_deleted_and_overridden_ones_reported() -> None:
    ended = PlanTerms(REFERENCE_START, D(2026, 7, 31), 22, 599, GIFT)
    stored = [_stored(m) for m in range(1, 8)] + [_stored(8, overridden=True), _stored(9)]
    sync = sync_charges(ended, stored, TODAY)
    assert sync.delete == (9,)
    assert sync.stranded == ("2026-08",)
    assert sync.create == sync.update == ()
