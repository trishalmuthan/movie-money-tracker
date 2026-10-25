import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import SessionDep
from app.db import models
from app.domain.allocation import Allocation, allocate
from app.domain.money import format_cents
from app.services.ledger import load_ledger

router = APIRouter(tags=["activity"])

type EntryKind = Literal["visit", "gift_card", "credit"]

# Within one day: credits, then visits, then gift cards (newest-first reading order).
_KIND_ORDER: dict[str, int] = {"credit": 0, "visit": 1, "gift_card": 2}


class ActivityEntry(BaseModel):
    kind: EntryKind
    id: int
    date: dt.date
    chain_id: int | None
    description: str
    amount: int  # signed cents: credits are negative
    payment_source: str | None  # visit's source, credit's destination, None for gift cards
    effective_cost: int | None  # what it really cost; None for credits


@router.get("/activity", response_model=list[ActivityEntry])
def list_activity(
    session: SessionDep,
    kind: EntryKind | None = None,
    chain_id: int | None = None,
    month: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
) -> list[ActivityEntry]:
    ledger = load_ledger(session)
    alloc = allocate(ledger)
    chain_names = {chain.id: chain.name for chain in ledger.chains}

    entries = [
        *(_visit_entry(v, alloc) for v in session.scalars(select(models.Visit))),
        *(_gift_card_entry(g, chain_names) for g in session.scalars(select(models.GiftCardLoad))),
        *(_credit_entry(c) for c in session.scalars(select(models.Credit))),
    ]
    entries = [
        e
        for e in entries
        if (kind is None or e.kind == kind)
        and (chain_id is None or e.chain_id == chain_id)
        and (month is None or e.date.strftime("%Y-%m") == month)
    ]
    entries.sort(key=lambda e: (e.date, -_KIND_ORDER[e.kind], e.id), reverse=True)
    return entries


def _visit_entry(v: models.Visit, alloc: Allocation) -> ActivityEntry:
    description = v.title
    if v.guest_count:
        description += f" (+{v.guest_count} guest{'' if v.guest_count == 1 else 's'})"
    effective = alloc.effective_cost(
        ("visit", v.id), v.my_cost, v.payment_source
    ) + alloc.effective_cost(("guest", v.id), v.guest_cost, v.payment_source)
    return ActivityEntry(
        kind="visit",
        id=v.id,
        date=v.date,
        chain_id=v.chain_id,
        description=description,
        amount=v.my_cost + v.guest_cost,
        payment_source=v.payment_source.value,
        effective_cost=effective,
    )


def _gift_card_entry(g: models.GiftCardLoad, chain_names: dict[int, str]) -> ActivityEntry:
    return ActivityEntry(
        kind="gift_card",
        id=g.id,
        date=g.date,
        chain_id=g.chain_id,
        description=f"{chain_names[g.chain_id]} gift card ({format_cents(g.face_value)} value)",
        amount=g.price_paid,
        payment_source=None,
        effective_cost=g.price_paid,
    )


def _credit_entry(c: models.Credit) -> ActivityEntry:
    return ActivityEntry(
        kind="credit",
        id=c.id,
        date=c.date,
        chain_id=c.chain_id,
        description=c.note or "Credit",
        amount=-c.amount,
        payment_source=c.destination.value,
        effective_cost=None,
    )
