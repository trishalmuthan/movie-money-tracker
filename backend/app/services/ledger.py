"""Load the database into the pure domain Ledger."""

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import models
from app.domain import types as domain
from app.services.fees import ensure_fee_charges


def load_ledger(session: Session, today: dt.date) -> domain.Ledger:
    """Generate any fees now due (and commit them), then read everything."""
    ensure_fee_charges(session, today)
    session.commit()
    return domain.Ledger(
        chains=tuple(
            domain.Chain(c.id, c.name, c.standard_ticket_price)
            for c in session.scalars(select(models.Chain))
        ),
        loads=tuple(
            domain.GiftCardLoad(g.id, g.chain_id, g.date, g.price_paid, g.face_value)
            for g in session.scalars(select(models.GiftCardLoad))
        ),
        fees=tuple(
            domain.FeeCharge(f.id, chain_id, f.date, f.amount, f.payment_source)
            for f, chain_id in session.execute(
                select(models.FeeCharge, models.SubscriptionPlan.chain_id).join(
                    models.SubscriptionPlan
                )
            )
        ),
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
