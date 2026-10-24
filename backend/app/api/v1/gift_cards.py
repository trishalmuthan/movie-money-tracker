import datetime as dt
from typing import Annotated, Self

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import select

from app.api.deps import SessionDep, TodayDep, get_or_404, reject_future, require_chain
from app.db import models

router = APIRouter(prefix="/gift-cards", tags=["gift-cards"])

Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


class GiftCardIn(BaseModel):
    chain_id: int
    date: dt.date
    price_paid: int = Field(gt=0)
    face_value: int = Field(gt=0)
    note: Note | None = None

    @model_validator(mode="after")
    def _face_covers_price(self) -> Self:
        if self.face_value < self.price_paid:
            raise ValueError("face_value must be at least price_paid")
        return self


class GiftCardOut(GiftCardIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


@router.get("", response_model=list[GiftCardOut])
def list_gift_cards(session: SessionDep, chain_id: int | None = None) -> list[models.GiftCardLoad]:
    stmt = select(models.GiftCardLoad).order_by(
        models.GiftCardLoad.date.desc(), models.GiftCardLoad.id.desc()
    )
    if chain_id is not None:
        stmt = stmt.where(models.GiftCardLoad.chain_id == chain_id)
    return list(session.scalars(stmt))


@router.post("", response_model=GiftCardOut, status_code=201)
def create_gift_card(body: GiftCardIn, session: SessionDep, today: TodayDep) -> models.GiftCardLoad:
    reject_future(body.date, today)
    require_chain(session, body.chain_id)
    load = models.GiftCardLoad(**body.model_dump())
    session.add(load)
    session.commit()
    session.refresh(load)
    return load


@router.put("/{load_id}", response_model=GiftCardOut)
def update_gift_card(
    load_id: int, body: GiftCardIn, session: SessionDep, today: TodayDep
) -> models.GiftCardLoad:
    load = get_or_404(session, models.GiftCardLoad, load_id)
    reject_future(body.date, today)
    require_chain(session, body.chain_id)
    for field, value in body.model_dump().items():
        setattr(load, field, value)
    session.commit()
    session.refresh(load)
    return load


@router.delete("/{load_id}", status_code=204)
def delete_gift_card(load_id: int, session: SessionDep) -> None:
    session.delete(get_or_404(session, models.GiftCardLoad, load_id))
    session.commit()
