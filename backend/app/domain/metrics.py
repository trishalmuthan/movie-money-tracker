"""Period metrics (spec §4 rules 1 and 6-8)."""

import calendar
import datetime as dt
from dataclasses import dataclass
from typing import Self

from app.domain.allocation import Allocation
from app.domain.money import Cents, div_round_half_up
from app.domain.types import CreditDestination, Ledger, PaymentSource


@dataclass(frozen=True, slots=True)
class Period:
    start: dt.date
    end: dt.date  # inclusive

    def __contains__(self, day: object) -> bool:
        return isinstance(day, dt.date) and self.start <= day <= self.end

    @classmethod
    def year(cls, year: int) -> Self:
        return cls(dt.date(year, 1, 1), dt.date(year, 12, 31))

    @classmethod
    def month(cls, year: int, month: int) -> Self:
        last_day = calendar.monthrange(year, month)[1]
        return cls(dt.date(year, month, 1), dt.date(year, month, last_day))


def cash_out(ledger: Ledger, period: Period) -> Cents:
    """Money that left the bank: gift card purchases + bank-paid spends - bank credits."""
    bank = PaymentSource.BANK
    loads = sum(load.price_paid for load in ledger.loads if load.date in period)
    fees = sum(f.amount for f in ledger.fees if f.payment_source is bank and f.date in period)
    visits = sum(
        v.my_cost + v.guest_cost
        for v in ledger.visits
        if v.payment_source is bank and v.date in period
    )
    refunds = sum(
        c.amount
        for c in ledger.credits
        if c.destination is CreditDestination.BANK and c.date in period
    )
    return loads + fees + visits - refunds


def visit_count(ledger: Ledger, period: Period) -> int:
    return sum(1 for v in ledger.visits if v.date in period)


def cost_per_movie(ledger: Ledger, alloc: Allocation, period: Period) -> Cents | None:
    visits = visit_count(ledger, period)
    if visits == 0:
        return None
    return div_round_half_up(_effective_movie_cost(ledger, alloc, period), visits)


def guest_spend(ledger: Ledger, alloc: Allocation, period: Period) -> Cents:
    return sum(
        alloc.effective_cost(("guest", v.id), v.guest_cost, v.payment_source)
        for v in ledger.visits
        if v.date in period
    )


def gift_card_discount(ledger: Ledger, period: Period) -> Cents:
    return sum(load.face_value - load.price_paid for load in ledger.loads if load.date in period)


def unlimited_savings(ledger: Ledger, alloc: Allocation, period: Period) -> Cents:
    """Full-price tickets for my visits minus what moviegoing actually cost. May be negative."""
    prices = {chain.id: chain.standard_ticket_price for chain in ledger.chains}
    full_price = sum(prices[v.chain_id] for v in ledger.visits if v.date in period)
    return full_price - _effective_movie_cost(ledger, alloc, period)


def _effective_movie_cost(ledger: Ledger, alloc: Allocation, period: Period) -> Cents:
    """Effective subscription fees plus my own ticket costs (guests excluded)."""
    fees = sum(
        alloc.effective_cost(("fee", f.id), f.amount, f.payment_source)
        for f in ledger.fees
        if f.date in period
    )
    mine = sum(
        alloc.effective_cost(("visit", v.id), v.my_cost, v.payment_source)
        for v in ledger.visits
        if v.date in period
    )
    return fees + mine
