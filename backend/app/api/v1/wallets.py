from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import SessionDep, TodayDep
from app.db import models
from app.domain.allocation import allocate
from app.domain.types import PaymentSource
from app.domain.wallet import runway, wallet_balance
from app.services.ledger import load_ledger

router = APIRouter(tags=["wallets"])


class WalletOut(BaseModel):
    chain_id: int
    chain_name: str
    balance: int  # cents of gift card value left, as of today; negative means a top-up is due
    uncovered: int  # gift-card spending no card money has covered yet
    runway_months: int | None  # months the current gift-card-paid fee is covered; None if none


@router.get("/wallets", response_model=list[WalletOut])
def list_wallets(session: SessionDep, today: TodayDep) -> list[WalletOut]:
    ledger = load_ledger(session, today)
    alloc = allocate(ledger)
    plan = models.SubscriptionPlan
    current_fee = dict(
        session.execute(
            select(plan.chain_id, plan.amount).where(
                plan.payment_source == PaymentSource.GIFT_CARD,
                plan.start_date <= today,
                plan.end_date.is_(None) | (plan.end_date >= today),
            )
        ).all()
    )
    wallets: list[WalletOut] = []
    for chain in sorted(ledger.chains, key=lambda c: c.name.lower()):
        balance = wallet_balance(ledger, chain.id, as_of=today)
        fee = current_fee.get(chain.id)
        wallets.append(
            WalletOut(
                chain_id=chain.id,
                chain_name=chain.name,
                balance=balance,
                uncovered=alloc.uncovered_by_chain.get(chain.id, 0),
                runway_months=None if fee is None else runway(balance, fee),
            )
        )
    return wallets
