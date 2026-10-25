import datetime as dt
from typing import Annotated, Self

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import select

from app.api.deps import SessionDep, TodayDep, get_or_404, reject_future, require_chain
from app.db import models
from app.domain.types import PaymentSource

router = APIRouter(prefix="/visits", tags=["visits"])

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


class VisitIn(BaseModel):
    date: dt.date
    chain_id: int
    title: Title
    my_cost: int = Field(default=0, ge=0)
    guest_count: int = Field(default=0, ge=0)
    guest_cost: int = Field(default=0, ge=0)
    payment_source: PaymentSource
    note: Note | None = None

    @model_validator(mode="after")
    def _payment_matches_costs(self) -> Self:
        is_free = self.my_cost + self.guest_cost == 0
        if (self.payment_source is PaymentSource.FREE) != is_free:
            raise ValueError("payment_source must be 'free' exactly when my_cost + guest_cost is 0")
        if self.guest_cost > 0 and self.guest_count == 0:
            raise ValueError("guest_cost needs guest_count of at least 1")
        return self


class VisitOut(VisitIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


@router.get("", response_model=list[VisitOut])
def list_visits(session: SessionDep, chain_id: int | None = None) -> list[models.Visit]:
    stmt = select(models.Visit).order_by(models.Visit.date.desc(), models.Visit.id.desc())
    if chain_id is not None:
        stmt = stmt.where(models.Visit.chain_id == chain_id)
    return list(session.scalars(stmt))


@router.post("", response_model=VisitOut, status_code=201)
def create_visit(body: VisitIn, session: SessionDep, today: TodayDep) -> models.Visit:
    reject_future(body.date, today)
    require_chain(session, body.chain_id)
    visit = models.Visit(**body.model_dump())
    session.add(visit)
    session.commit()
    session.refresh(visit)
    return visit


@router.put("/{visit_id}", response_model=VisitOut)
def update_visit(
    visit_id: int, body: VisitIn, session: SessionDep, today: TodayDep
) -> models.Visit:
    visit = get_or_404(session, models.Visit, visit_id)
    reject_future(body.date, today)
    require_chain(session, body.chain_id)
    for field, value in body.model_dump().items():
        setattr(visit, field, value)
    session.commit()
    session.refresh(visit)
    return visit


@router.delete("/{visit_id}", status_code=204)
def delete_visit(visit_id: int, session: SessionDep) -> None:
    session.delete(get_or_404(session, models.Visit, visit_id))
    session.commit()
