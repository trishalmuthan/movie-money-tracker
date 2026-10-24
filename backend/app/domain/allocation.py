"""Oldest-card-first gift card allocation (spec §4 rules 4-5).

Each chain's wallet is a queue of lots: gift card loads and gift-card credits.
Gift-card-paid spends join a queue of debts in date order and draw from the
oldest lot with money left. A lot's cost is rounded cumulatively, so a fully
used lot's draws add up to exactly its price paid. Debt that no lot covers is
costed at face and reported as uncovered until a later lot pays it off.
"""

import datetime as dt
from collections import deque
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Literal

from app.domain.money import Cents, div_round_half_up
from app.domain.types import CreditDestination, Ledger, PaymentSource

type SpendKind = Literal["fee", "visit", "guest"]
type SpendKey = tuple[SpendKind, int]

# Same-day order: money arrives before it is spent.
_LOAD, _CREDIT, _SPEND = 0, 1, 2


@dataclass(frozen=True, slots=True)
class Allocation:
    effective: dict[SpendKey, Cents]
    uncovered: dict[SpendKey, Cents]
    uncovered_by_chain: dict[int, Cents]

    def effective_cost(self, key: SpendKey, amount: Cents, source: PaymentSource) -> Cents:
        """Effective cost of any spend: allocated if gift-card-paid, otherwise face."""
        if source is PaymentSource.GIFT_CARD:
            return self.effective.get(key, 0)
        return amount


@dataclass(slots=True)
class _Lot:
    price_paid: Cents
    face_value: Cents
    used: Cents = 0

    @property
    def remaining(self) -> Cents:
        return self.face_value - self.used

    def draw(self, wanted: Cents) -> tuple[Cents, Cents]:
        """Take up to `wanted` of face value; return (taken, cost of what was taken)."""
        taken = min(wanted, self.remaining)
        before = self._cost_at(self.used)
        self.used += taken
        return taken, self._cost_at(self.used) - before

    def _cost_at(self, used: Cents) -> Cents:
        return div_round_half_up(used * self.price_paid, self.face_value)


@dataclass(slots=True)
class _Debt:
    key: SpendKey
    remaining: Cents


@dataclass(frozen=True, slots=True)
class _Event:
    date: dt.date
    rank: int
    seq: tuple[int, ...]
    chain_id: int
    lot: _Lot | None = None
    key: SpendKey | None = None
    amount: Cents = 0


def allocate(ledger: Ledger) -> Allocation:
    effective: dict[SpendKey, Cents] = {}
    lots: dict[int, deque[_Lot]] = {}
    debts: dict[int, deque[_Debt]] = {}

    for event in sorted(_events(ledger), key=lambda e: (e.date, e.rank, e.seq)):
        chain_lots = lots.setdefault(event.chain_id, deque())
        chain_debts = debts.setdefault(event.chain_id, deque())
        if event.lot is not None:
            chain_lots.append(event.lot)
        else:
            assert event.key is not None
            effective[event.key] = 0
            chain_debts.append(_Debt(event.key, event.amount))
        _settle(chain_debts, chain_lots, effective)

    uncovered: dict[SpendKey, Cents] = {}
    uncovered_by_chain: dict[int, Cents] = {}
    for chain_id, chain_debts in debts.items():
        for debt in chain_debts:
            effective[debt.key] += debt.remaining
            uncovered[debt.key] = debt.remaining
            uncovered_by_chain[chain_id] = uncovered_by_chain.get(chain_id, 0) + debt.remaining
    return Allocation(effective, uncovered, uncovered_by_chain)


def _settle(debts: deque[_Debt], lots: deque[_Lot], effective: dict[SpendKey, Cents]) -> None:
    """Pay the oldest debts from the oldest lots until one queue runs out."""
    while debts and lots:
        debt, lot = debts[0], lots[0]
        taken, cost = lot.draw(debt.remaining)
        effective[debt.key] += cost
        debt.remaining -= taken
        if lot.remaining == 0:
            lots.popleft()
        if debt.remaining == 0:
            debts.popleft()


def _events(ledger: Ledger) -> Iterator[_Event]:
    for load in ledger.loads:
        lot = _Lot(load.price_paid, load.face_value)
        yield _Event(load.date, _LOAD, (load.id,), load.chain_id, lot=lot)
    for credit in ledger.credits:
        if credit.destination is CreditDestination.GIFT_CARD:
            if credit.chain_id is None:
                raise ValueError(f"Gift card credit {credit.id} has no chain")
            lot = _Lot(0, credit.amount)
            yield _Event(credit.date, _CREDIT, (credit.id,), credit.chain_id, lot=lot)
    for fee in ledger.fees:
        if fee.payment_source is PaymentSource.GIFT_CARD and fee.amount > 0:
            key: SpendKey = ("fee", fee.id)
            yield _Event(fee.date, _SPEND, (0, fee.id, 0), fee.chain_id, key=key, amount=fee.amount)
    for visit in ledger.visits:
        if visit.payment_source is not PaymentSource.GIFT_CARD:
            continue
        parts: tuple[tuple[int, SpendKind, Cents], ...] = (
            (0, "visit", visit.my_cost),
            (1, "guest", visit.guest_cost),
        )
        for part, kind, amount in parts:
            if amount > 0:
                key = (kind, visit.id)
                seq = (1, visit.id, part)
                yield _Event(visit.date, _SPEND, seq, visit.chain_id, key=key, amount=amount)
