import datetime as dt
from typing import Annotated, Self

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import select

from app.api.deps import SessionDep, TodayDep, get_or_404, reject_future, require_chain
from app.db import models
from app.domain.types import CreditDestination

router = APIRouter(prefix="/credits", tags=["credits"])

Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


class CreditIn(BaseModel):
    date: dt.date
    chain_id: int | None = None
    amount: int = Field(gt=0)
    destination: CreditDestination
    note: Note | None = None

    @model_validator(mode="after")
    def _gift_card_credit_has_chain(self) -> Self:
        if self.destination is CreditDestination.GIFT_CARD and self.chain_id is None:
            raise ValueError("a gift_card credit needs a chain_id")
        return self


class CreditOut(CreditIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


@router.get("", response_model=list[CreditOut])
def list_credits(session: SessionDep) -> list[models.Credit]:
    stmt = select(models.Credit).order_by(models.Credit.date.desc(), models.Credit.id.desc())
    return list(session.scalars(stmt))


@router.post("", response_model=CreditOut, status_code=201)
def create_credit(body: CreditIn, session: SessionDep, today: TodayDep) -> models.Credit:
    _validate(body, session, today)
    credit = models.Credit(**body.model_dump())
    session.add(credit)
    session.commit()
    session.refresh(credit)
    return credit


@router.put("/{credit_id}", response_model=CreditOut)
def update_credit(
    credit_id: int, body: CreditIn, session: SessionDep, today: TodayDep
) -> models.Credit:
    credit = get_or_404(session, models.Credit, credit_id)
    _validate(body, session, today)
    for field, value in body.model_dump().items():
        setattr(credit, field, value)
    session.commit()
    session.refresh(credit)
    return credit


@router.delete("/{credit_id}", status_code=204)
def delete_credit(credit_id: int, session: SessionDep) -> None:
    session.delete(get_or_404(session, models.Credit, credit_id))
    session.commit()


def _validate(body: CreditIn, session: SessionDep, today: dt.date) -> None:
    reject_future(body.date, today)
    if body.chain_id is not None:
        require_chain(session, body.chain_id)
