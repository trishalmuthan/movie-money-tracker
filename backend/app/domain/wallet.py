"""Wallet balance and runway (spec §4 rules 2-3)."""

import datetime as dt

from app.domain.money import Cents
from app.domain.types import CreditDestination, Ledger, PaymentSource


def wallet_balance(ledger: Ledger, chain_id: int, as_of: dt.date | None = None) -> Cents:
    """Face value loaded + gift-card credits - gift-card spending. May be negative."""

    def counts(day: dt.date, entry_chain: int | None) -> bool:
        return entry_chain == chain_id and (as_of is None or day <= as_of)

    gift = PaymentSource.GIFT_CARD
    loaded = sum(load.face_value for load in ledger.loads if counts(load.date, load.chain_id))
    credited = sum(
        credit.amount
        for credit in ledger.credits
        if credit.destination is CreditDestination.GIFT_CARD
        and counts(credit.date, credit.chain_id)
    )
    spent_on_fees = sum(
        fee.amount
        for fee in ledger.fees
        if fee.payment_source is gift and counts(fee.date, fee.chain_id)
    )
    spent_on_visits = sum(
        visit.my_cost + visit.guest_cost
        for visit in ledger.visits
        if visit.payment_source is gift and counts(visit.date, visit.chain_id)
    )
    return loaded + credited - spent_on_fees - spent_on_visits


def runway(balance: Cents, monthly_fee: Cents) -> int | None:
    """Whole months of fees the balance covers; None when there is no fee to divide by."""
    if monthly_fee <= 0:
        return None
    return max(balance, 0) // monthly_fee
