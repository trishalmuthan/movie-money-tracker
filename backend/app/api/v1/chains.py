from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import SessionDep, get_or_404
from app.db import models

router = APIRouter(prefix="/chains", tags=["chains"])

ChainName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class ChainIn(BaseModel):
    name: ChainName
    standard_ticket_price: int = Field(ge=0)


class ChainOut(ChainIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


@router.get("", response_model=list[ChainOut])
def list_chains(session: SessionDep) -> list[models.Chain]:
    return list(session.scalars(select(models.Chain).order_by(func.lower(models.Chain.name))))


@router.post("", response_model=ChainOut, status_code=201)
def create_chain(body: ChainIn, session: SessionDep) -> models.Chain:
    _ensure_unique_name(session, body.name)
    chain = models.Chain(**body.model_dump())
    session.add(chain)
    session.commit()
    session.refresh(chain)
    return chain


@router.put("/{chain_id}", response_model=ChainOut)
def update_chain(chain_id: int, body: ChainIn, session: SessionDep) -> models.Chain:
    chain = get_or_404(session, models.Chain, chain_id)
    _ensure_unique_name(session, body.name, exclude_id=chain_id)
    chain.name = body.name
    chain.standard_ticket_price = body.standard_ticket_price
    session.commit()
    session.refresh(chain)
    return chain


@router.delete("/{chain_id}", status_code=204)
def delete_chain(chain_id: int, session: SessionDep) -> None:
    session.delete(get_or_404(session, models.Chain, chain_id))
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="This chain still has entries. Delete or move them first.",
        ) from None


def _ensure_unique_name(session: Session, name: str, exclude_id: int | None = None) -> None:
    """Chain names are unique ignoring case ("Regal" and "regal" are the same chain)."""
    stmt = select(models.Chain.id).where(func.lower(models.Chain.name) == name.lower())
    if exclude_id is not None:
        stmt = stmt.where(models.Chain.id != exclude_id)
    if session.scalar(stmt) is not None:
        raise HTTPException(status_code=409, detail=f"A chain named {name!r} already exists")
