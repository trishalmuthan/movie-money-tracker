from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import SessionDep, TodayDep
from app.domain.allocation import allocate
from app.domain.wallet import wallet_balance
from app.services.ledger import load_ledger

router = APIRouter(tags=["wallets"])


class WalletOut(BaseModel):
    chain_id: int
    chain_name: str
    balance: int  # cents of gift card value left, as of today; negative means a top-up is due
    uncovered: int  # gift-card spending no card money has covered yet


@router.get("/wallets", response_model=list[WalletOut])
def list_wallets(session: SessionDep, today: TodayDep) -> list[WalletOut]:
    ledger = load_ledger(session)
    alloc = allocate(ledger)
    return [
        WalletOut(
            chain_id=chain.id,
            chain_name=chain.name,
            balance=wallet_balance(ledger, chain.id, as_of=today),
            uncovered=alloc.uncovered_by_chain.get(chain.id, 0),
        )
        for chain in sorted(ledger.chains, key=lambda c: c.name.lower())
    ]
