"""Ledger tables (spec §3). Money columns are integer cents."""

import datetime as dt
from enum import StrEnum

from sqlalchemy import CheckConstraint, Date, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.domain.types import CreditDestination, PaymentSource

__all__ = ["Chain", "Credit", "CreditDestination", "GiftCardLoad", "PaymentSource", "Visit"]


def _enum[E: StrEnum](enum_cls: type[E]) -> Enum:
    """Store a StrEnum as its string value, guarded by a named CHECK constraint."""
    return Enum(
        enum_cls,
        name=enum_cls.__name__.lower(),
        native_enum=False,
        create_constraint=True,
        length=20,
        values_callable=lambda members: [member.value for member in members],
    )


class Chain(Base):
    __tablename__ = "chains"
    __table_args__ = (CheckConstraint("standard_ticket_price >= 0", name="price_nonneg"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    standard_ticket_price: Mapped[int]


class GiftCardLoad(Base):
    __tablename__ = "gift_card_loads"
    __table_args__ = (
        CheckConstraint("price_paid > 0", name="price_positive"),
        CheckConstraint("face_value >= price_paid", name="face_covers_price"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    chain_id: Mapped[int] = mapped_column(ForeignKey("chains.id", ondelete="RESTRICT"), index=True)
    date: Mapped[dt.date] = mapped_column(Date)
    price_paid: Mapped[int]
    face_value: Mapped[int]
    note: Mapped[str | None] = mapped_column(String(200))


class Visit(Base):
    __tablename__ = "visits"
    __table_args__ = (
        CheckConstraint("my_cost >= 0", name="my_cost_nonneg"),
        CheckConstraint("guest_count >= 0", name="guest_count_nonneg"),
        CheckConstraint("guest_cost >= 0", name="guest_cost_nonneg"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, index=True)
    chain_id: Mapped[int] = mapped_column(ForeignKey("chains.id", ondelete="RESTRICT"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    my_cost: Mapped[int]
    guest_count: Mapped[int]
    guest_cost: Mapped[int]
    payment_source: Mapped[PaymentSource] = mapped_column(_enum(PaymentSource))
    note: Mapped[str | None] = mapped_column(String(200))


class Credit(Base):
    __tablename__ = "credits"
    __table_args__ = (CheckConstraint("amount > 0", name="amount_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date)
    chain_id: Mapped[int | None] = mapped_column(
        ForeignKey("chains.id", ondelete="RESTRICT"), index=True
    )
    amount: Mapped[int]
    destination: Mapped[CreditDestination] = mapped_column(_enum(CreditDestination))
    note: Mapped[str | None] = mapped_column(String(200))
