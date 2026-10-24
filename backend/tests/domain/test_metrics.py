import datetime as dt

from app.domain.allocation import allocate
from app.domain.metrics import (
    Period,
    cash_out,
    cost_per_movie,
    gift_card_discount,
    guest_spend,
    unlimited_savings,
    visit_count,
)
from app.domain.types import (
    Chain,
    Credit,
    CreditDestination,
    FeeCharge,
    GiftCardLoad,
    Ledger,
    PaymentSource,
    Visit,
)
from app.domain.wallet import wallet_balance

GC, BANK, FREE = PaymentSource.GIFT_CARD, PaymentSource.BANK, PaymentSource.FREE
REGAL = 1
D = dt.date

# The plan's reference scenario: a slice of the 2026 sheet with a $35 → $50 Regal card.
# Cumulative costs at 0.70: fee1 419, PHM mine 455, PHM guests 1365, fee2 420, fee3 419.
SCENARIO = Ledger(
    chains=(Chain(REGAL, "Regal", 1500),),
    loads=(GiftCardLoad(1, REGAL, D(2026, 1, 1), 3500, 5000),),
    fees=(
        FeeCharge(1, REGAL, D(2026, 1, 22), 599, GC),
        FeeCharge(2, REGAL, D(2026, 2, 22), 599, GC),
        FeeCharge(3, REGAL, D(2026, 3, 22), 599, GC),
    ),
    visits=(
        Visit(1, REGAL, D(2026, 2, 1), 0, 0, 0, FREE),  # No Other Choice
        Visit(2, REGAL, D(2026, 2, 15), 650, 3, 1950, GC),  # Project Hail Mary
        Visit(3, REGAL, D(2026, 2, 16), 500, 0, 0, BANK),  # How to Make a Killing
    ),
)
Q1 = Period(D(2026, 1, 1), D(2026, 3, 31))
ALLOC = allocate(SCENARIO)


def test_period_bounds_are_inclusive() -> None:
    feb = Period.month(2026, 2)
    assert feb == Period(D(2026, 2, 1), D(2026, 2, 28))
    assert D(2026, 2, 28) in feb
    assert D(2026, 3, 1) not in feb
    assert Period.year(2025) == Period(D(2025, 1, 1), D(2025, 12, 31))


def test_cash_out_counts_card_purchases_and_bank_payments_only() -> None:
    assert cash_out(SCENARIO, Q1) == 3500 + 500
    assert cash_out(SCENARIO, Period.month(2026, 2)) == 500


def test_bank_credit_reduces_cash_out_gift_card_credit_does_not() -> None:
    ledger = Ledger(
        credits=(
            Credit(1, REGAL, D(2026, 2, 1), 717, CreditDestination.BANK),
            Credit(2, REGAL, D(2026, 2, 1), 300, CreditDestination.GIFT_CARD),
        )
    )
    assert cash_out(ledger, Q1) == -717


def test_visit_count_counts_my_visits_not_tickets() -> None:
    assert visit_count(SCENARIO, Q1) == 3


def test_cost_per_movie_uses_effective_fees_and_my_ticket_costs() -> None:
    # fees 419 + 420 + 419 = 1258; mine 0 + 455 + 500 = 955; 2213 / 3 = 737.67
    assert cost_per_movie(SCENARIO, ALLOC, Q1) == 738
    # Feb: fee 420 + mine 955 = 1375 / 3 = 458.33
    assert cost_per_movie(SCENARIO, ALLOC, Period.month(2026, 2)) == 458


def test_cost_per_movie_is_undefined_without_visits() -> None:
    assert cost_per_movie(SCENARIO, ALLOC, Period.month(2026, 1)) is None


def test_guest_spend_is_reported_separately() -> None:
    assert guest_spend(SCENARIO, ALLOC, Q1) == 1365


def test_gift_card_discount_is_face_minus_price() -> None:
    assert gift_card_discount(SCENARIO, Q1) == 1500
    assert gift_card_discount(SCENARIO, Period.month(2026, 2)) == 0


def test_unlimited_savings_compares_full_price_with_effective_cost() -> None:
    assert unlimited_savings(SCENARIO, ALLOC, Q1) == 3 * 1500 - 2213


def test_unlimited_savings_can_be_negative() -> None:
    # January: one fee (419 effective) and no visits.
    assert unlimited_savings(SCENARIO, ALLOC, Period.month(2026, 1)) == -419


def test_reference_scenario_wallet_ends_at_six_dollars_three() -> None:
    assert wallet_balance(SCENARIO, REGAL) == 603  # 5000 - 3 × 599 - 650 - 1950
