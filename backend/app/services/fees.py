"""Keep stored fee charges in line with their plans (M3). The rules live in app.domain.fees."""

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import models
from app.domain.fees import ChargeSync, PlanTerms, StoredCharge, sync_charges


def ensure_fee_charges(session: Session, today: dt.date) -> None:
    """Create due charges and refresh generated ones for every plan. Idempotent; doesn't commit."""
    for plan in session.scalars(select(models.SubscriptionPlan)).all():
        sync_plan(session, plan, today)


def sync_plan(session: Session, plan: models.SubscriptionPlan, today: dt.date) -> ChargeSync:
    """Apply one plan's sync and return it, so a plan write can refuse `stranded` months."""
    stored = {
        c.id: c
        for c in session.scalars(
            select(models.FeeCharge).where(models.FeeCharge.plan_id == plan.id)
        )
    }
    sync = sync_charges(
        PlanTerms(
            plan.start_date, plan.end_date, plan.billing_day, plan.amount, plan.payment_source
        ),
        [
            StoredCharge(c.id, c.month, c.date, c.amount, c.payment_source, c.is_overridden)
            for c in stored.values()
        ],
        today,
    )
    for charge_id in sync.delete:
        session.delete(stored[charge_id])
    for charge_id, due in sync.update:
        charge = stored[charge_id]
        charge.date, charge.amount, charge.payment_source = due.date, due.amount, due.payment_source
    session.add_all(
        models.FeeCharge(
            plan_id=plan.id,
            month=due.month,
            date=due.date,
            amount=due.amount,
            payment_source=due.payment_source,
            is_overridden=False,
        )
        for due in sync.create
    )
    session.flush()
    return sync
