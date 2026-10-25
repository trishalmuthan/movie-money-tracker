import datetime as dt
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import models
from app.db.base import Base
from app.db.migrate import upgrade_to_head
from app.db.session import make_engine

JAN1 = dt.date(2026, 1, 1)


def test_face_value_below_price_is_rejected_by_the_database(db: Session) -> None:
    db.add(models.Chain(name="Regal", standard_ticket_price=1500))
    db.flush()
    db.add(models.GiftCardLoad(chain_id=1, date=JAN1, price_paid=5000, face_value=3500))
    with pytest.raises(IntegrityError):
        db.flush()


def test_unknown_chain_is_rejected_by_the_database(db: Session) -> None:
    db.add(models.GiftCardLoad(chain_id=99, date=JAN1, price_paid=3500, face_value=5000))
    with pytest.raises(IntegrityError):
        db.flush()


def test_negative_visit_cost_is_rejected_by_the_database(db: Session) -> None:
    db.add(models.Chain(name="Regal", standard_ticket_price=1500))
    db.flush()
    db.add(
        models.Visit(
            date=JAN1,
            chain_id=1,
            title="Send Help",
            my_cost=-1,
            guest_count=0,
            guest_cost=0,
            payment_source=models.PaymentSource.BANK,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_enum_columns_store_their_string_values(db: Session) -> None:
    db.add(models.Credit(date=JAN1, amount=717, destination=models.CreditDestination.BANK))
    db.commit()
    stored = db.connection().exec_driver_sql("SELECT destination FROM credits").scalar_one()
    assert stored == "bank"


def test_migrations_match_models(tmp_path: Path) -> None:
    url = f"sqlite:///{(tmp_path / 'migrated.db').as_posix()}"
    upgrade_to_head(url)
    engine = make_engine(url)
    with engine.connect() as connection:
        diff = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    engine.dispose()
    assert diff == []


def _plan(db: Session, **overrides: object) -> models.SubscriptionPlan:
    db.add(models.Chain(name="Regal", standard_ticket_price=1500))
    db.flush()
    plan = models.SubscriptionPlan(
        **{
            "chain_id": 1,
            "amount": 599,
            "billing_day": 22,
            "start_date": JAN1,
            "end_date": None,
            "payment_source": models.PaymentSource.GIFT_CARD,
            **overrides,
        }
    )
    db.add(plan)
    db.flush()
    return plan


def test_billing_day_must_exist_in_every_month(db: Session) -> None:
    with pytest.raises(IntegrityError):
        _plan(db, billing_day=29)


def test_a_plan_cannot_end_before_it_starts(db: Session) -> None:
    with pytest.raises(IntegrityError):
        _plan(db, end_date=dt.date(2025, 12, 31))


def test_a_subscription_is_never_free(db: Session) -> None:
    with pytest.raises(IntegrityError):
        _plan(db, payment_source=models.PaymentSource.FREE)


def test_one_charge_per_plan_per_month(db: Session) -> None:
    plan = _plan(db)
    jan22 = dt.date(2026, 1, 22)
    db.add(
        models.FeeCharge(
            plan_id=plan.id,
            month="2026-01",
            date=jan22,
            amount=599,
            payment_source=models.PaymentSource.GIFT_CARD,
            is_overridden=False,
        )
    )
    db.flush()
    db.add(
        models.FeeCharge(
            plan_id=plan.id,
            month="2026-01",
            date=jan22,
            amount=599,
            payment_source=models.PaymentSource.GIFT_CARD,
            is_overridden=False,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_a_skipped_month_is_a_zero_charge(db: Session) -> None:
    plan = _plan(db)
    db.add(
        models.FeeCharge(
            plan_id=plan.id,
            month="2026-03",
            date=dt.date(2026, 3, 22),
            amount=0,
            payment_source=models.PaymentSource.GIFT_CARD,
            is_overridden=True,
        )
    )
    db.flush()  # allowed
    db.add(
        models.FeeCharge(
            plan_id=plan.id,
            month="2026-04",
            date=dt.date(2026, 4, 22),
            amount=-1,
            payment_source=models.PaymentSource.GIFT_CARD,
            is_overridden=True,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()
