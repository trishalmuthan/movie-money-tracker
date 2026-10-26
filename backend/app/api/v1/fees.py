import datetime as dt
from typing import Self

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.api.deps import SessionDep, TodayDep, get_or_404
from app.db import models
from app.domain.types import PaymentSource
from app.services.fees import sync_plan

router = APIRouter(prefix="/fees", tags=["fees"])


class FeeIn(BaseModel):
    amount: int = Field(ge=0)  # 0 = a skipped month
    payment_source: PaymentSource

    @model_validator(mode="after")
    def _not_free(self) -> Self:
        if self.payment_source is PaymentSource.FREE:
            raise ValueError("payment_source must be 'gift_card' or 'bank'")
        return self


class FeeOut(FeeIn):
    id: int
    plan_id: int
    chain_id: int
    month: str
    date: dt.date
    is_overridden: bool
    from_sheet: bool  # set by the import; editing or resetting the month clears it


@router.get("/{fee_id}", response_model=FeeOut)
def get_fee(fee_id: int, session: SessionDep) -> FeeOut:
    return _out(session, get_or_404(session, models.FeeCharge, fee_id))


@router.put("/{fee_id}", response_model=FeeOut)
def update_fee(fee_id: int, body: FeeIn, session: SessionDep) -> FeeOut:
    """Edit one month. Generation never touches it again until it's reset."""
    fee = get_or_404(session, models.FeeCharge, fee_id)
    fee.amount, fee.payment_source, fee.is_overridden = body.amount, body.payment_source, True
    fee.from_sheet = False
    session.commit()
    return _out(session, fee)


@router.post("/{fee_id}/reset", response_model=FeeOut)
def reset_fee(fee_id: int, session: SessionDep, today: TodayDep) -> FeeOut:
    """Hand the month back to its plan: its amount, source and billing day."""
    fee = get_or_404(session, models.FeeCharge, fee_id)
    fee.is_overridden = fee.from_sheet = False
    sync_plan(session, get_or_404(session, models.SubscriptionPlan, fee.plan_id), today)
    session.commit()
    return _out(session, fee)


def _out(session: Session, fee: models.FeeCharge) -> FeeOut:
    session.refresh(fee)
    plan = get_or_404(session, models.SubscriptionPlan, fee.plan_id)
    return FeeOut(
        id=fee.id,
        plan_id=fee.plan_id,
        chain_id=plan.chain_id,
        month=fee.month,
        date=fee.date,
        amount=fee.amount,
        payment_source=fee.payment_source,
        is_overridden=fee.is_overridden,
        from_sheet=fee.from_sheet,
    )
