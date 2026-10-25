"""Load the database into the pure domain Ledger."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import models
from app.domain import types as domain


def load_ledger(session: Session) -> domain.Ledger:
    return domain.Ledger(
        chains=tuple(
            domain.Chain(c.id, c.name, c.standard_ticket_price)
            for c in session.scalars(select(models.Chain))
        ),
        loads=tuple(
            domain.GiftCardLoad(g.id, g.chain_id, g.date, g.price_paid, g.face_value)
            for g in session.scalars(select(models.GiftCardLoad))
        ),
        # Fee charges join the ledger with subscriptions (M3).
        fees=(),
        visits=tuple(
            domain.Visit(
                v.id, v.chain_id, v.date, v.my_cost, v.guest_count, v.guest_cost, v.payment_source
            )
            for v in session.scalars(select(models.Visit))
        ),
        credits=tuple(
            domain.Credit(c.id, c.chain_id, c.date, c.amount, c.destination)
            for c in session.scalars(select(models.Credit))
        ),
    )
