import calendar
import datetime as dt
from collections.abc import Sequence
from typing import Annotated, Self

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import SessionDep, TodayDep, field_error, get_or_404, require_chain
from app.db import models
from app.domain.types import PaymentSource
from app.services.fees import sync_plan

router = APIRouter(prefix="/plans", tags=["plans"])

Month = Annotated[str, StringConstraints(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]


class PlanIn(BaseModel):
    chain_id: int
    amount: int = Field(gt=0)
    billing_day: int = Field(ge=1, le=28)
    start_date: dt.date
    end_date: dt.date | None = None
    payment_source: PaymentSource

    @model_validator(mode="after")
    def _valid_period(self) -> Self:
        if self.payment_source is PaymentSource.FREE:
            raise ValueError("payment_source must be 'gift_card' or 'bank'")
        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class PlanOut(PlanIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class PriceChangeIn(BaseModel):
    amount: int = Field(gt=0)
    from_month: Month


@router.get("", response_model=list[PlanOut])
def list_plans(session: SessionDep) -> list[models.SubscriptionPlan]:
    stmt = select(models.SubscriptionPlan).order_by(
        models.SubscriptionPlan.chain_id, models.SubscriptionPlan.start_date
    )
    return list(session.scalars(stmt))


@router.get("/{plan_id}", response_model=PlanOut)
def get_plan(plan_id: int, session: SessionDep) -> models.SubscriptionPlan:
    return get_or_404(session, models.SubscriptionPlan, plan_id)


@router.post("", response_model=PlanOut, status_code=201)
def create_plan(body: PlanIn, session: SessionDep, today: TodayDep) -> models.SubscriptionPlan:
    require_chain(session, body.chain_id)
    _ensure_no_overlap(session, body)
    plan = models.SubscriptionPlan(**body.model_dump())
    session.add(plan)
    session.flush()
    _sync_and_commit(session, [plan], today)
    return plan


@router.put("/{plan_id}", response_model=PlanOut)
def update_plan(
    plan_id: int, body: PlanIn, session: SessionDep, today: TodayDep
) -> models.SubscriptionPlan:
    plan = get_or_404(session, models.SubscriptionPlan, plan_id)
    require_chain(session, body.chain_id)
    _ensure_no_overlap(session, body, exclude_id=plan_id)
    for field, value in body.model_dump().items():
        setattr(plan, field, value)
    _sync_and_commit(session, [plan], today)
    return plan


@router.post("/{plan_id}/change-price", response_model=PlanOut, status_code=201)
def change_price(
    plan_id: int, body: PriceChangeIn, session: SessionDep, today: TodayDep
) -> models.SubscriptionPlan:
    """End this period the month before `from_month`; a new one at `amount` takes over from there."""
    plan = get_or_404(session, models.SubscriptionPlan, plan_id)
    first = dt.date.fromisoformat(f"{body.from_month}-01")
    if first <= plan.start_date:
        raise field_error("from_month", "Must be after the plan's first month", body.from_month)
    if plan.end_date is not None and first > plan.end_date:
        raise field_error("from_month", "Must be before the plan ends", body.from_month)
    successor = models.SubscriptionPlan(
        chain_id=plan.chain_id,
        amount=body.amount,
        billing_day=plan.billing_day,
        start_date=first,
        end_date=plan.end_date,
        payment_source=plan.payment_source,
    )
    session.add(successor)
    session.flush()
    plan.end_date = first - dt.timedelta(days=1)
    # Months from the change move to the new period, so overridden ones keep their edits.
    session.execute(
        update(models.FeeCharge)
        .where(models.FeeCharge.plan_id == plan.id, models.FeeCharge.month >= body.from_month)
        .values(plan_id=successor.id)
    )
    _sync_and_commit(session, [plan, successor], today)
    return successor


@router.delete("/{plan_id}", status_code=204)
def delete_plan(plan_id: int, session: SessionDep) -> None:
    plan = get_or_404(session, models.SubscriptionPlan, plan_id)
    overridden = session.scalars(
        select(models.FeeCharge.month)
        .where(models.FeeCharge.plan_id == plan_id, models.FeeCharge.is_overridden)
        .order_by(models.FeeCharge.month)
    ).all()
    if overridden:
        raise HTTPException(
            status_code=409,
            detail=f"This plan has fees you edited or imported ({_months(overridden)}). Reset them first, or end the plan instead.",
        )
    session.delete(plan)  # its generated charges go with it (ON DELETE CASCADE)
    session.commit()


def _sync_and_commit(
    session: Session, plans: list[models.SubscriptionPlan], today: dt.date
) -> None:
    """Regenerate the plans' charges; refuse (and undo everything) if that would drop an edited month."""
    stranded = [month for plan in plans for month in sync_plan(session, plan, today).stranded]
    if stranded:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"These dates would drop fees you edited or imported for {_months(stranded)}. Reset those months first.",
        )
    session.commit()
    for plan in plans:
        session.refresh(plan)


def _ensure_no_overlap(session: Session, body: PlanIn, exclude_id: int | None = None) -> None:
    stmt = select(models.SubscriptionPlan).where(
        models.SubscriptionPlan.chain_id == body.chain_id,
        (models.SubscriptionPlan.end_date.is_(None))
        | (models.SubscriptionPlan.end_date >= body.start_date),
    )
    if body.end_date is not None:
        stmt = stmt.where(models.SubscriptionPlan.start_date <= body.end_date)
    if exclude_id is not None:
        stmt = stmt.where(models.SubscriptionPlan.id != exclude_id)
    clash = session.scalars(stmt).first()
    if clash is not None:
        chain = get_or_404(session, models.Chain, body.chain_id)
        until = f"to {clash.end_date.isoformat()}" if clash.end_date else "with no end date"
        raise HTTPException(
            status_code=409,
            detail=f"{chain.name} already has a subscription from {clash.start_date.isoformat()} "
            f"{until}, which overlaps these dates.",
        )


def _months(months: Sequence[str]) -> str:
    """["2026-08", "2026-09"] → "August 2026, September 2026"."""
    return ", ".join(f"{calendar.month_name[int(m[5:])]} {m[:4]}" for m in months)
