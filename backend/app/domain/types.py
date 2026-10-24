"""Plain, immutable inputs to the money rules (spec §3). No I/O here."""

import datetime as dt
from dataclasses import dataclass
from enum import StrEnum

from app.domain.money import Cents


class PaymentSource(StrEnum):
    GIFT_CARD = "gift_card"
    BANK = "bank"
    FREE = "free"


class CreditDestination(StrEnum):
    GIFT_CARD = "gift_card"
    BANK = "bank"


@dataclass(frozen=True, slots=True)
class Chain:
    id: int
    name: str
    standard_ticket_price: Cents


@dataclass(frozen=True, slots=True)
class GiftCardLoad:
    id: int
    chain_id: int
    date: dt.date
    price_paid: Cents
    face_value: Cents


@dataclass(frozen=True, slots=True)
class FeeCharge:
    id: int
    chain_id: int
    date: dt.date
    amount: Cents
    payment_source: PaymentSource


@dataclass(frozen=True, slots=True)
class Visit:
    id: int
    chain_id: int
    date: dt.date
    my_cost: Cents
    guest_count: int
    guest_cost: Cents
    payment_source: PaymentSource


@dataclass(frozen=True, slots=True)
class Credit:
    id: int
    chain_id: int | None
    date: dt.date
    amount: Cents
    destination: CreditDestination


@dataclass(frozen=True, slots=True)
class Ledger:
    chains: tuple[Chain, ...] = ()
    loads: tuple[GiftCardLoad, ...] = ()
    fees: tuple[FeeCharge, ...] = ()
    visits: tuple[Visit, ...] = ()
    credits: tuple[Credit, ...] = ()
