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
