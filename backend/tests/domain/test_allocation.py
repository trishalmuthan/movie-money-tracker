import datetime as dt

from app.domain.allocation import allocate
from app.domain.types import (
    Credit,
    CreditDestination,
    FeeCharge,
    GiftCardLoad,
    Ledger,
    PaymentSource,
    Visit,
)

GC = PaymentSource.GIFT_CARD
REGAL = 1
JAN1, JAN22 = dt.date(2026, 1, 1), dt.date(2026, 1, 22)
FEB1, FEB15, FEB22 = dt.date(2026, 2, 1), dt.date(2026, 2, 15), dt.date(2026, 2, 22)


def load(id: int, day: dt.date, paid: int, face: int, chain: int = REGAL) -> GiftCardLoad:
    return GiftCardLoad(id, chain, day, paid, face)


def fee(
    id: int, day: dt.date, amount: int = 599, source: PaymentSource = GC, chain: int = REGAL
) -> FeeCharge:
    return FeeCharge(id, chain, day, amount, source)


def test_fee_paid_from_discounted_card_costs_its_discounted_value() -> None:
    alloc = allocate(Ledger(loads=(load(1, JAN1, 3500, 5000),), fees=(fee(1, JAN22),)))
    assert alloc.effective[("fee", 1)] == 419  # 599 x 0.70 = 419.3
    assert alloc.uncovered == {}


def test_later_card_never_changes_an_already_covered_charge() -> None:
    first = Ledger(loads=(load(1, JAN1, 3500, 5000),), fees=(fee(1, JAN22),))
    later = Ledger(
        loads=(load(1, JAN1, 3500, 5000), load(2, dt.date(2026, 5, 1), 4500, 5000)),
        fees=(fee(1, JAN22),),
    )
    assert allocate(first).effective[("fee", 1)] == 419
    assert allocate(later).effective[("fee", 1)] == 419


def test_charge_spanning_two_cards_uses_each_cards_rate() -> None:
    ledger = Ledger(
        loads=(load(1, JAN1, 3500, 5000), load(2, FEB1, 4500, 5000)),
        fees=(fee(1, JAN22, amount=4800), fee(2, FEB22, amount=599)),
    )
    alloc = allocate(ledger)
    assert alloc.effective[("fee", 1)] == 3360
    assert alloc.effective[("fee", 2)] == 140 + 359  # $2.00 at 0.70 + $3.99 at 0.90


def test_fully_used_card_costs_exactly_its_price() -> None:
    fees = tuple(fee(i, dt.date(2026, i, 22), amount=1000) for i in (1, 2, 3))
    alloc = allocate(Ledger(loads=(load(1, JAN1, 1000, 3000),), fees=fees))
    costs = [alloc.effective[("fee", i)] for i in (1, 2, 3)]
    assert costs == [333, 334, 333]
    assert sum(costs) == 1000


def test_card_bought_same_day_covers_that_days_charge() -> None:
    # The card's id is higher than the fee's (entered later), but money arrives first.
    alloc = allocate(Ledger(loads=(load(7, JAN22, 3500, 5000),), fees=(fee(1, JAN22),)))
    assert alloc.effective[("fee", 1)] == 419
    assert alloc.uncovered == {}


def test_charge_with_no_card_money_is_uncovered_at_face() -> None:
    alloc = allocate(Ledger(fees=(fee(1, JAN22),)))
    assert alloc.effective[("fee", 1)] == 599
    assert alloc.uncovered == {("fee", 1): 599}
    assert alloc.uncovered_by_chain == {REGAL: 599}


def test_later_card_pays_off_overdraft_first() -> None:
    alloc = allocate(
        Ledger(loads=(load(1, FEB1, 3500, 5000),), fees=(fee(1, JAN22), fee(2, FEB22)))
    )
    assert alloc.effective[("fee", 1)] == 419  # re-costed at the new card's rate
    assert alloc.effective[("fee", 2)] == 420  # cumulative: round(838.6) - 419
    assert alloc.uncovered == {}
    assert alloc.uncovered_by_chain == {}


def test_partly_covered_charge_is_uncovered_only_for_the_shortfall() -> None:
    alloc = allocate(Ledger(loads=(load(1, JAN1, 350, 500),), fees=(fee(1, JAN22),)))
    assert alloc.effective[("fee", 1)] == 350 + 99  # the whole card, plus 99 at face
    assert alloc.uncovered == {("fee", 1): 99}


def test_visit_cost_is_split_between_my_ticket_and_guests() -> None:
    visit = Visit(5, REGAL, FEB15, my_cost=650, guest_count=3, guest_cost=1950, payment_source=GC)
    alloc = allocate(Ledger(loads=(load(1, JAN1, 3500, 5000),), visits=(visit,)))
    assert alloc.effective[("visit", 5)] == 455
    assert alloc.effective[("guest", 5)] == 1365


def test_gift_card_credit_is_balance_that_cost_nothing() -> None:
    credit = Credit(1, REGAL, JAN1, 717, CreditDestination.GIFT_CARD)
    alloc = allocate(Ledger(credits=(credit,), fees=(fee(1, JAN22),)))
    assert alloc.effective[("fee", 1)] == 0
    assert alloc.uncovered == {}


def test_bank_and_free_entries_do_not_touch_the_wallet() -> None:
    ledger = Ledger(
        loads=(load(1, JAN1, 3500, 5000),),
        fees=(fee(1, JAN22, source=PaymentSource.BANK),),
        visits=(Visit(1, REGAL, FEB1, 0, 0, 0, PaymentSource.FREE),),
    )
    alloc = allocate(ledger)
    assert alloc.effective == {}
    assert alloc.effective_cost(("fee", 1), 599, PaymentSource.BANK) == 599
    assert alloc.effective_cost(("visit", 1), 0, PaymentSource.FREE) == 0


def test_chains_have_separate_wallets() -> None:
    ledger = Ledger(loads=(load(1, JAN1, 3500, 5000, chain=1),), fees=(fee(1, JAN22, chain=2),))
    alloc = allocate(ledger)
    assert alloc.effective[("fee", 1)] == 599
    assert alloc.uncovered_by_chain == {2: 599}
