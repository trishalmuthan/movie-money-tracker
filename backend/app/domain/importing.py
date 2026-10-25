"""Read the Google Sheet's CSV export and classify its rows (spec §5.8). Pure; no I/O."""

import csv
import datetime as dt
import io
import re
from dataclasses import dataclass

from app.domain.money import Cents, parse_dollars

COLUMNS = ("Item", "Net Cost", "Number of Tickets", "Date")

_US_DATE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")
_GIFT_CARD = re.compile(r"gift card", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class SheetRow:
    line: int  # 1-based line in the CSV, header included, so it matches the spreadsheet row
    item: str
    net_cost: Cents
    tickets: int | None
    date: dt.date


@dataclass(frozen=True, slots=True)
class RowError:
    line: int
    item: str
    column: str
    value: str
    message: str


@dataclass(frozen=True, slots=True)
class ParsedFile:
    rows: tuple[SheetRow, ...]
    errors: tuple[RowError, ...]


@dataclass(frozen=True, slots=True)
class FeeRow:
    line: int
    date: dt.date
    amount: Cents


@dataclass(frozen=True, slots=True)
class GiftCardRow:
    line: int
    date: dt.date
    price_paid: Cents
    chain_hint: str | None  # the item text before "Gift Card", e.g. "Regal"


@dataclass(frozen=True, slots=True)
class VisitRow:
    line: int
    date: dt.date
    title: str
    my_cost: Cents
    guest_count: int
    guest_cost: Cents
    refund: Cents  # > 0 when the sheet logged a negative cost: a $0 visit plus this refund


type Classified = FeeRow | GiftCardRow | VisitRow


def parse_sheet_csv(text: str) -> ParsedFile:
    """Rows from the first four columns. A row with any unreadable value becomes errors instead."""
    rows: list[SheetRow] = []
    errors: list[RowError] = []
    reader = csv.reader(io.StringIO(text.removeprefix("\ufeff")))
    for line, record in enumerate(reader, start=1):
        cells = [cell.strip() for cell in (record + [""] * 4)[:4]]
        if not any(cells):
            continue
        if line == 1 and cells[0].lower() == "item":
            continue
        result = _parse_record(line, *cells)
        if isinstance(result, SheetRow):
            rows.append(result)
        else:
            errors.extend(result)
    return ParsedFile(tuple(rows), tuple(errors))


def _parse_record(
    line: int, item: str, cost_text: str, tickets_text: str, date_text: str
) -> SheetRow | list[RowError]:
    """One CSV record as a row, or every problem with it (so all of them can be fixed at once)."""
    problems: list[RowError] = []
    if not item:
        problems.append(RowError(line, item, "Item", item, "The item is empty"))
    cost: Cents | None = None
    try:
        cost = parse_dollars(cost_text)
    except ValueError:
        problems.append(
            RowError(line, item, "Net Cost", cost_text, "Not an amount, like 5.00 or -7.17")
        )
    tickets: int | None = None
    if tickets_text.isdigit():
        tickets = int(tickets_text)
    elif tickets_text:
        problems.append(
            RowError(line, item, "Number of Tickets", tickets_text, "Not a whole number of tickets")
        )
    date = _parse_date(date_text)
    if date is None:
        problems.append(RowError(line, item, "Date", date_text, "Not a date, like 5/22/2025"))
    if problems or cost is None or date is None:
        return problems
    return SheetRow(line, item, cost, tickets, date)


def _parse_date(text: str) -> dt.date | None:
    """The sheet's M/D/YYYY, or ISO YYYY-MM-DD."""
    try:
        if match := _US_DATE.match(text):
            month, day, year = (int(part) for part in match.groups())
            return dt.date(year, month, day)
        return dt.date.fromisoformat(text)
    except ValueError:
        return None


def classify(row: SheetRow) -> Classified | RowError:
    """Fee, gift card or visit, by the item text (spec §5.8)."""
    if "movie club fee" in row.item.lower():
        return FeeRow(row.line, row.date, row.net_cost)
    if card := _GIFT_CARD.search(row.item):
        hint = row.item[: card.start()].strip() or None
        return GiftCardRow(row.line, row.date, row.net_cost, chain_hint=hint)
    if not row.tickets:
        return RowError(
            row.line,
            row.item,
            "Number of Tickets",
            "",
            "A visit needs a ticket count of at least 1",
        )
    guests = row.tickets - 1
    if row.net_cost < 0:
        return VisitRow(row.line, row.date, row.item, 0, guests, 0, refund=-row.net_cost)
    mine, guest_cost = split_cost(row.net_cost, row.tickets)
    return VisitRow(row.line, row.date, row.item, mine, guests, guest_cost, refund=0)


def split_cost(cost: Cents, tickets: int) -> tuple[Cents, Cents]:
    """(my ticket, guest tickets) for an even split; the odd cent goes to my ticket."""
    per_ticket = cost // tickets
    guests = per_ticket * (tickets - 1)
    return cost - guests, guests


def legacy_total(parsed: ParsedFile) -> Cents:
    """The signed sum of the file's amounts: what the sheet's own total shows."""
    return sum(row.net_cost for row in parsed.rows)


def ticket_total(parsed: ParsedFile) -> int:
    return sum(row.tickets or 0 for row in parsed.rows)
