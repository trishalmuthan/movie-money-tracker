"""What a sheet import would write, given the files and the review screen's choices (spec §5.8).

Pure; no I/O. The API previews this as often as the review changes and commits it once.
"""

import calendar
import datetime as dt
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Literal

from app.domain.importing import (
    FeeRow,
    GiftCardRow,
    RowError,
    SheetRow,
    VisitRow,
    classify,
    legacy_total,
    parse_sheet_csv,
    ticket_total,
)
from app.domain.money import Cents, format_cents
from app.domain.types import Chain, CreditDestination, PaymentSource

type RowKey = tuple[int, int]  # (file index, CSV line)


@dataclass(frozen=True, slots=True)
class SheetFile:
    name: str
    text: str


@dataclass(frozen=True, slots=True)
class ChainSpan:
    """Rows dated up to and including `until` belong to `chain_id`; None covers every later date."""

    until: dt.date | None
    chain_id: int


@dataclass(frozen=True, slots=True)
class RowChoice:
    skip: bool = False
    chain_id: int | None = None
    face_value: Cents | None = None  # giving a value confirms the card
    my_cost: Cents | None = None
    guest_cost: Cents | None = None
    payment_source: PaymentSource | None = None
    refund_destination: CreditDestination | None = None


@dataclass(frozen=True, slots=True)
class PlanPeriod:
    chain_id: int
    amount: Cents
    billing_day: int
    start_date: dt.date
    end_date: dt.date | None
    payment_source: PaymentSource


@dataclass(frozen=True, slots=True)
class Choices:
    cutoff: dt.date  # rows on or after it are the app's, not the sheet's
    chain_rule: tuple[ChainSpan, ...]
    rows: Mapping[RowKey, RowChoice] = field(default_factory=dict)
    fixes: Mapping[tuple[int, int, str], str] = field(default_factory=dict)  # (file, line, column)
    periods: tuple[PlanPeriod, ...] | None = None  # None: use the proposed periods


@dataclass(frozen=True, slots=True)
class ExistingPlan:
    chain_id: int
    start_date: dt.date
    end_date: dt.date | None


@dataclass(frozen=True, slots=True)
class Existing:
    chains: tuple[Chain, ...]
    plans: tuple[ExistingPlan, ...] = ()


@dataclass(frozen=True, slots=True)
class ProposedVisit:
    key: RowKey
    date: dt.date
    chain_id: int | None
    title: str
    my_cost: Cents
    guest_count: int
    guest_cost: Cents
    payment_source: PaymentSource


@dataclass(frozen=True, slots=True)
class ProposedCredit:
    key: RowKey
    date: dt.date
    chain_id: int | None
    amount: Cents
    destination: CreditDestination


@dataclass(frozen=True, slots=True)
class ProposedCard:
    key: RowKey
    date: dt.date
    chain_id: int | None
    price_paid: Cents
    face_value: Cents
    confirmed: bool


@dataclass(frozen=True, slots=True)
class ProposedFee:
    key: RowKey
    date: dt.date
    chain_id: int | None
    amount: Cents
    payment_source: PaymentSource
    period_index: int | None  # into Proposal.periods


@dataclass(frozen=True, slots=True)
class LeftOut:
    key: RowKey
    item: str
    date: dt.date | None
    reason: Literal["after_cutoff", "skipped"]


@dataclass(frozen=True, slots=True)
class Blocker:
    key: RowKey | None
    message: str


@dataclass(frozen=True, slots=True)
class FileTotals:
    name: str
    legacy_total: Cents  # every readable row, cutoff or not: compare with the sheet's own total
    tickets: int
    imported_total: Cents
    imported_tickets: int


@dataclass(frozen=True, slots=True)
class Proposal:
    visits: tuple[ProposedVisit, ...]
    credits: tuple[ProposedCredit, ...]
    cards: tuple[ProposedCard, ...]
    fees: tuple[ProposedFee, ...]
    periods: tuple[PlanPeriod, ...]
    left_out: tuple[LeftOut, ...]
    errors: tuple[tuple[int, RowError], ...]  # (file index, error), not fixed or skipped
    blockers: tuple[Blocker, ...]
    totals: tuple[FileTotals, ...]

    @property
    def ready(self) -> bool:
        return not self.errors and not self.blockers


def build_proposal(files: Sequence[SheetFile], choices: Choices, existing: Existing) -> Proposal:
    chain_names = {chain.id: chain.name for chain in existing.chains}
    blockers: list[Blocker] = []
    errors: list[tuple[int, RowError]] = []
    left_out: list[LeftOut] = []
    imported: list[tuple[RowKey, SheetRow, FeeRow | GiftCardRow | VisitRow]] = []
    totals: list[FileTotals] = []

    for index, file in enumerate(files):
        fixes = {(line, col): v for (f, line, col), v in choices.fixes.items() if f == index}
        parsed = parse_sheet_csv(file.text, fixes)
        skipped = {line for (f, line), c in choices.rows.items() if f == index and c.skip}
        for error in parsed.errors:
            if error.line in skipped:
                if not any(o.key == (index, error.line) for o in left_out):
                    left_out.append(LeftOut((index, error.line), error.item, None, "skipped"))
            else:
                errors.append((index, error))
        kept: list[SheetRow] = []
        for row in parsed.rows:
            key = (index, row.line)
            if row.line in skipped:
                left_out.append(LeftOut(key, row.item, row.date, "skipped"))
            elif row.date >= choices.cutoff:
                left_out.append(LeftOut(key, row.item, row.date, "after_cutoff"))
            else:
                classified = classify(row)
                if isinstance(classified, RowError):
                    errors.append((index, classified))
                else:
                    imported.append((key, row, classified))
                    kept.append(row)
        totals.append(
            FileTotals(
                file.name,
                legacy_total(parsed),
                ticket_total(parsed),
                sum(r.net_cost for r in kept),
                sum(r.tickets or 0 for r in kept),
            )
        )

    def choice(key: RowKey) -> RowChoice:
        return choices.rows.get(key, RowChoice())

    def by_rule(day: dt.date) -> int | None:
        for span in choices.chain_rule:
            if span.until is None or day <= span.until:
                return span.chain_id
        return None

    def need_chain(key: RowKey, chain_id: int | None, what: str, day: dt.date) -> None:
        if chain_id is None:
            blockers.append(Blocker(key, f"Pick a chain for the {what} on {_day(day)}"))

    # Cards first: they decide whether later spending defaults to the card or the bank.
    cards: list[ProposedCard] = []
    for key, _, row in imported:
        if not isinstance(row, GiftCardRow):
            continue
        chosen = choice(key)
        chain_id = chosen.chain_id
        if chain_id is None and row.chain_hint is not None:
            chain_id = next(
                (c.id for c in existing.chains if c.name.lower() == row.chain_hint.lower()), None
            )
            if chain_id is None:
                blockers.append(
                    Blocker(
                        key, f"No chain named '{row.chain_hint}'. Add it in Settings or pick one"
                    )
                )
        elif chain_id is None:
            chain_id = by_rule(row.date)
            need_chain(key, chain_id, "gift card", row.date)
        face = chosen.face_value if chosen.face_value is not None else row.price_paid
        card = ProposedCard(
            key, row.date, chain_id, row.price_paid, face, chosen.face_value is not None
        )
        name = chain_names.get(chain_id, "gift") if chain_id is not None else "gift"
        if not card.confirmed:
            blockers.append(
                Blocker(
                    key,
                    f"Confirm the value of the {format_cents(row.price_paid)} {name} card "
                    f"from {_day(row.date)}",
                )
            )
        elif face < row.price_paid:
            blockers.append(Blocker(key, "A card's value can't be less than what you paid"))
        cards.append(card)

    first_card: dict[int, dt.date] = {}
    for card in cards:
        if card.chain_id is not None:
            first_card[card.chain_id] = min(card.date, first_card.get(card.chain_id, card.date))

    def default_payment(chain_id: int | None, day: dt.date) -> PaymentSource:
        bought = first_card.get(chain_id) if chain_id is not None else None
        return (
            PaymentSource.GIFT_CARD if bought is not None and bought <= day else PaymentSource.BANK
        )

    visits: list[ProposedVisit] = []
    credits: list[ProposedCredit] = []
    fees: list[ProposedFee] = []
    for key, sheet_row, row in imported:
        chosen = choice(key)
        if isinstance(row, GiftCardRow):
            continue
        chain_id = chosen.chain_id if chosen.chain_id is not None else by_rule(row.date)
        if isinstance(row, FeeRow):
            need_chain(key, chain_id, "fee", row.date)
            source = chosen.payment_source or default_payment(chain_id, row.date)
            if source is PaymentSource.FREE:
                blockers.append(Blocker(key, "A fee is paid by gift card or bank, not free"))
            fees.append(ProposedFee(key, row.date, chain_id, row.amount, source, None))
            continue

        need_chain(key, chain_id, "visit", row.date)
        mine = chosen.my_cost if chosen.my_cost is not None else row.my_cost
        guests = chosen.guest_cost if chosen.guest_cost is not None else row.guest_cost
        cost = max(sheet_row.net_cost, 0)
        if mine + guests != cost or mine < 0 or guests < 0:
            blockers.append(Blocker(key, f"The split must add up to {format_cents(cost)}"))
        if guests > 0 and row.guest_count == 0:
            blockers.append(Blocker(key, "There are no guest tickets to put a cost on"))
        free_by_default = PaymentSource.FREE if cost == 0 else default_payment(chain_id, row.date)
        source = chosen.payment_source or free_by_default
        if (source is PaymentSource.FREE) != (mine + guests == 0):
            blockers.append(
                Blocker(key, "Free means $0.00; a visit with a cost is paid by gift card or bank")
            )
        visits.append(
            ProposedVisit(key, row.date, chain_id, row.title, mine, row.guest_count, guests, source)
        )
        if row.refund:
            destination = chosen.refund_destination or CreditDestination.BANK
            credits.append(ProposedCredit(key, row.date, chain_id, row.refund, destination))

    periods = choices.periods if choices.periods is not None else _propose_periods(fees)
    blockers.extend(_period_problems(periods, existing, chain_names))
    fees = _assign_periods(fees, periods, chain_names, blockers)

    return Proposal(
        visits=tuple(visits),
        credits=tuple(credits),
        cards=tuple(cards),
        fees=tuple(fees),
        periods=tuple(periods),
        left_out=tuple(sorted(left_out, key=lambda o: o.key)),
        errors=tuple(errors),
        blockers=tuple(sorted(blockers, key=lambda b: (b.key is None, b.key or (0, 0)))),
        totals=tuple(totals),
    )


def _propose_periods(fees: Sequence[ProposedFee]) -> tuple[PlanPeriod, ...]:
    """Consecutive fees with the same chain and amount form a period; the newest stays open."""
    groups: list[tuple[int, list[ProposedFee]]] = []  # (chain, its consecutive fees)
    for fee in sorted(fees, key=lambda f: f.date):
        if fee.chain_id is None:
            continue
        last = groups[-1][1][-1] if groups else None
        if last is not None and (last.chain_id, last.amount) == (fee.chain_id, fee.amount):
            groups[-1][1].append(fee)
        else:
            groups.append((fee.chain_id, [fee]))
    periods: list[PlanPeriod] = []
    for number, (chain_id, group) in enumerate(groups):
        first, last = group[0], group[-1]
        newest = number == len(groups) - 1
        # Most common billing day; a tie goes to the earliest fee's day.
        billing_day = Counter(min(f.date.day, 28) for f in group).most_common(1)[0][0]
        periods.append(
            PlanPeriod(
                chain_id=chain_id,
                amount=first.amount,
                billing_day=billing_day,
                start_date=first.date.replace(day=1),
                end_date=None if newest else _month_end(last.date),
                payment_source=last.payment_source,
            )
        )
    return tuple(periods)


def _period_problems(
    periods: Sequence[PlanPeriod], existing: Existing, names: Mapping[int, str]
) -> list[Blocker]:
    problems: list[Blocker] = []
    for index, period in enumerate(periods):
        label = f"The {names.get(period.chain_id, 'unknown chain')} period from {_day(period.start_date)}"
        if not 1 <= period.billing_day <= 28:
            problems.append(Blocker(None, f"{label} needs a billing day from 1 to 28"))
        if period.amount <= 0:
            problems.append(Blocker(None, f"{label} needs a price above $0.00"))
        if period.end_date is not None and period.end_date < period.start_date:
            problems.append(Blocker(None, f"{label} ends before it starts"))
        if period.payment_source is PaymentSource.FREE:
            problems.append(Blocker(None, f"{label} is paid by gift card or bank, not free"))
        for other in periods[index + 1 :]:
            if other.chain_id == period.chain_id and _overlaps(
                period, other.start_date, other.end_date
            ):
                problems.append(Blocker(None, f"{label} overlaps another imported period"))
        for plan in existing.plans:
            if plan.chain_id == period.chain_id and _overlaps(
                period, plan.start_date, plan.end_date
            ):
                problems.append(
                    Blocker(
                        None,
                        f"{label} overlaps a {names.get(plan.chain_id, '')} subscription already "
                        f"in the app (from {_day(plan.start_date)})",
                    )
                )
    return problems


def _assign_periods(
    fees: Sequence[ProposedFee],
    periods: Sequence[PlanPeriod],
    names: Mapping[int, str],
    blockers: list[Blocker],
) -> list[ProposedFee]:
    """Each imported fee becomes an edited charge of the period covering it; one per month."""
    assigned: list[ProposedFee] = []
    months: set[tuple[int, int, int]] = set()  # (period, year, month)
    for fee in sorted(fees, key=lambda f: f.key):
        if fee.chain_id is None:
            assigned.append(fee)
            continue
        chain = names.get(fee.chain_id, "")
        index = next(
            (
                i
                for i, p in enumerate(periods)
                if p.chain_id == fee.chain_id and _overlaps(p, fee.date, fee.date)
            ),
            None,
        )
        month = f"{calendar.month_name[fee.date.month]} {fee.date.year}"
        if index is None:
            blockers.append(
                Blocker(fee.key, f"No subscription period covers the {chain} fee in {month}")
            )
        elif (index, fee.date.year, fee.date.month) in months:
            blockers.append(Blocker(fee.key, f"Two {chain} fees in {month}: skip one"))
        else:
            months.add((index, fee.date.year, fee.date.month))
        assigned.append(
            ProposedFee(fee.key, fee.date, fee.chain_id, fee.amount, fee.payment_source, index)
        )
    return assigned


def _overlaps(period: PlanPeriod, start: dt.date, end: dt.date | None) -> bool:
    period_ends_first = period.end_date is not None and period.end_date < start
    other_ends_first = end is not None and end < period.start_date
    return not (period_ends_first or other_ends_first)


def _month_end(day: dt.date) -> dt.date:
    return day.replace(day=calendar.monthrange(day.year, day.month)[1])


def _day(day: dt.date) -> str:
    return f"{day:%b} {day.day}, {day.year}"
