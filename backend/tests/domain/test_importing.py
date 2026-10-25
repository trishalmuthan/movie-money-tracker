"""Parsing and classifying sheet CSVs (M5 Task 1). The rows are made up, shaped like the real sheet."""

import datetime as dt

import pytest

from app.domain.importing import (
    COLUMNS,
    FeeRow,
    GiftCardRow,
    RowError,
    VisitRow,
    classify,
    legacy_total,
    parse_sheet_csv,
    split_cost,
    ticket_total,
)

D = dt.date

# The plan's reference 2025.csv: unordered, with one unreadable row.
REFERENCE_2025 = """Item,Net Cost,Number of Tickets,Date
May 2025 Movie Club Fee,11.99,,5/22/2025
Mission Impossible,-7.17,1,5/27/2025
The Life of Chuck,5.00,1,6/2/2025
Superman,0.00,4,7/15/2025
Cinemark Gift Card,40.00,,7/6/2025
Bugonia,1.75,2,11/4/2025
Mystery row,abc,1,13/40/2025
"""


def _rows(text: str = REFERENCE_2025):
    return parse_sheet_csv(text)


def test_parses_rows_with_their_line_numbers() -> None:
    parsed = _rows()
    assert [r.line for r in parsed.rows] == [2, 3, 4, 5, 6, 7]
    first = parsed.rows[0]
    assert (first.item, first.net_cost, first.tickets, first.date) == (
        "May 2025 Movie Club Fee",
        1199,
        None,
        D(2025, 5, 22),
    )


def test_unreadable_values_are_row_errors_naming_line_and_column() -> None:
    errors = _rows().errors
    assert [(e.line, e.column) for e in errors] == [(8, "Net Cost"), (8, "Date")]
    assert errors[0].item == "Mystery row"
    assert errors[0].value == "abc"


def test_reads_dollar_formats_and_iso_dates() -> None:
    text = 'Item,Net Cost,Number of Tickets,Date\nBig night,"1,234.50",2,2025-06-01\nSmall,$5.00,1,6/2/2025\n'
    assert [(r.net_cost, r.date) for r in parse_sheet_csv(text).rows] == [
        (123450, D(2025, 6, 1)),
        (500, D(2025, 6, 2)),
    ]


def test_ignores_blank_rows_extra_columns_and_a_byte_order_mark() -> None:
    text = "﻿Item,Net Cost,Number of Tickets,Date,Notes\n,,,\nSuperman,0.00,4,7/15/2025,with friends\n\n"
    parsed = parse_sheet_csv(text)
    assert [r.item for r in parsed.rows] == ["Superman"]
    assert parsed.errors == ()


def test_a_ticket_count_must_be_a_whole_number() -> None:
    parsed = parse_sheet_csv("Item,Net Cost,Number of Tickets,Date\nOdd,0.00,1.5,7/15/2025\n")
    assert [(e.line, e.column) for e in parsed.errors] == [(2, "Number of Tickets")]


def test_a_row_without_an_item_is_an_error() -> None:
    parsed = parse_sheet_csv("Item,Net Cost,Number of Tickets,Date\n,5.00,1,7/15/2025\n")
    assert [(e.line, e.column) for e in parsed.errors] == [(2, "Item")]


def test_classifies_fees_cards_and_visits() -> None:
    kinds = {r.line: classify(r) for r in _rows().rows}
    assert kinds[2] == FeeRow(2, D(2025, 5, 22), 1199)
    assert kinds[4] == VisitRow(4, D(2025, 6, 2), "The Life of Chuck", 500, 0, 0, refund=0)
    assert kinds[5] == VisitRow(5, D(2025, 7, 15), "Superman", 0, 3, 0, refund=0)
    assert kinds[6] == GiftCardRow(6, D(2025, 7, 6), 4000, chain_hint="Cinemark")


def test_a_negative_visit_is_a_free_visit_plus_a_refund() -> None:
    mission = classify(_rows().rows[1])
    assert mission == VisitRow(3, D(2025, 5, 27), "Mission Impossible", 0, 0, 0, refund=717)


def test_a_paid_visit_with_guests_splits_the_cost() -> None:
    bugonia = classify(_rows().rows[5])
    assert bugonia == VisitRow(7, D(2025, 11, 4), "Bugonia", 88, 1, 87, refund=0)


@pytest.mark.parametrize(
    ("item", "hint"),
    [
        ("Regal Gift Card Purchase", "Regal"),
        ("cinemark gift card", "cinemark"),
        ("Gift Card", None),
    ],
)
def test_gift_card_chain_hint_is_the_text_before_gift_card(item: str, hint: str | None) -> None:
    row = parse_sheet_csv(f"Item,Net Cost,Number of Tickets,Date\n{item},35.00,,11/27/2025\n").rows[
        0
    ]
    assert classify(row) == GiftCardRow(2, D(2025, 11, 27), 3500, chain_hint=hint)


def test_fee_detection_ignores_case() -> None:
    row = parse_sheet_csv(
        "Item,Net Cost,Number of Tickets,Date\nJune movie club fee,11.99,,6/22/2025\n"
    ).rows[0]
    assert isinstance(classify(row), FeeRow)


def test_a_visit_needs_a_ticket_count() -> None:
    row = parse_sheet_csv("Item,Net Cost,Number of Tickets,Date\nSomething,0.00,,6/22/2025\n").rows[
        0
    ]
    assert classify(row) == RowError(
        2, "Something", "Number of Tickets", "", "A visit needs a ticket count of at least 1"
    )


@pytest.mark.parametrize(
    ("cost", "tickets", "mine", "guests"),
    [(2600, 4, 650, 1950), (175, 2, 88, 87), (500, 1, 500, 0), (100, 3, 34, 66), (0, 4, 0, 0)],
)
def test_split_cost_gives_the_odd_cent_to_my_ticket(
    cost: int, tickets: int, mine: int, guests: int
) -> None:
    assert split_cost(cost, tickets) == (mine, guests)


def test_totals_cover_every_readable_row() -> None:
    parsed = _rows()
    # 11.99 − 7.17 + 5.00 + 0 + 40.00 + 1.75 (the mystery row can't be read).
    assert legacy_total(parsed) == 1199 - 717 + 500 + 0 + 4000 + 175
    assert ticket_total(parsed) == 1 + 1 + 4 + 2


def test_fixes_replace_cells_before_parsing() -> None:
    parsed = parse_sheet_csv(
        REFERENCE_2025, fixes={(8, "Net Cost"): "2.50", (8, "Date"): "8/1/2025"}
    )
    assert parsed.errors == ()
    assert (parsed.rows[-1].net_cost, parsed.rows[-1].date) == (250, D(2025, 8, 1))


def test_columns_match_the_import_api() -> None:
    from typing import get_args

    from app.api.v1.imports import Column

    assert get_args(Column) == COLUMNS
