import datetime as dt

from app.domain.types import (
    Credit,
    CreditDestination,
    FeeCharge,
    GiftCardLoad,
    Ledger,
    PaymentSource,
    Visit,
)
from app.domain.wallet import runway, wallet_balance

GC, BANK = PaymentSource.GIFT_CARD, PaymentSource.BANK
REGAL = 1
JAN1, JAN22, JAN31 = dt.date(2026, 1, 1), dt.date(2026, 1, 22), dt.date(2026, 1, 31)
FEB1, FEB15, FEB22 = dt.date(2026, 2, 1), dt.date(2026, 2, 15), dt.date(2026, 2, 22)

LEDGER = Ledger(
    loads=(GiftCardLoad(1, REGAL, JAN1, 3500, 5000),),
    credits=(
        Credit(1, REGAL, FEB1, 717, CreditDestination.GIFT_CARD),
        Credit(2, REGAL, FEB1, 300, CreditDestination.BANK),
    ),
    fees=(FeeCharge(1, REGAL, JAN22, 599, GC), FeeCharge(2, REGAL, FEB22, 599, BANK)),
    visits=(Visit(1, REGAL, FEB15, 650, 3, 1950, GC),),
)


def test_balance_is_face_value_plus_credits_minus_gift_card_spending() -> None:
    assert wallet_balance(LEDGER, REGAL) == 5000 + 717 - 599 - 650 - 1950


def test_balance_as_of_a_date_ignores_later_entries() -> None:
    assert wallet_balance(LEDGER, REGAL, as_of=JAN31) == 5000 - 599


def test_balance_can_go_negative() -> None:
    ledger = Ledger(fees=(FeeCharge(1, REGAL, JAN22, 599, GC),))
    assert wallet_balance(ledger, REGAL) == -599


def test_other_chains_do_not_count() -> None:
    assert wallet_balance(LEDGER, chain_id=2) == 0


def test_runway_is_whole_months_of_fees_left() -> None:
    assert runway(1200, 599) == 2
    assert runway(-5, 599) == 0
    assert runway(1000, 0) is None
