import datetime as dt

from app.domain.fees import billing_dates

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
