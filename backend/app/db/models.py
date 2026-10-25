"""Ledger tables (spec §3). Money columns are integer cents."""

import datetime as dt
from enum import StrEnum

from sqlalchemy import CheckConstraint, Date, DateTime, Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.domain.types import CreditDestination, PaymentSource

__all__ = [
    "Chain",
    "Credit",
    "CreditDestination",
    "FeeCharge",
    "GiftCardLoad",
    "Import",
    "ImportFile",
    "PaymentSource",
    "SubscriptionPlan",
    "Visit",
]


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


class SubscriptionPlan(Base):
    """One price period of a subscription. A price change ends one period and starts the next."""

    __tablename__ = "subscription_plans"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("billing_day BETWEEN 1 AND 28", name="billing_day_in_every_month"),
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="ends_after_start"),
        CheckConstraint("payment_source != 'free'", name="never_free"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    chain_id: Mapped[int] = mapped_column(ForeignKey("chains.id", ondelete="RESTRICT"), index=True)
    amount: Mapped[int]
    billing_day: Mapped[int]
    start_date: Mapped[dt.date] = mapped_column(Date)
    end_date: Mapped[dt.date | None] = mapped_column(Date)
    payment_source: Mapped[PaymentSource] = mapped_column(_enum(PaymentSource))


class FeeCharge(Base):
    """One month's fee. Generated from its plan unless `is_overridden` (then never touched)."""

    __tablename__ = "fee_charges"
    __table_args__ = (
        UniqueConstraint("plan_id", "month", name="uq_fee_charges_plan_month"),
        CheckConstraint("amount >= 0", name="amount_nonneg"),  # 0 = a skipped month
        CheckConstraint("payment_source != 'free'", name="never_free"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(
        ForeignKey("subscription_plans.id", ondelete="CASCADE"), index=True
    )
    month: Mapped[str] = mapped_column(String(7))  # "YYYY-MM"
    date: Mapped[dt.date] = mapped_column(Date, index=True)
    amount: Mapped[int]
    payment_source: Mapped[PaymentSource] = mapped_column(_enum(PaymentSource))
    is_overridden: Mapped[bool] = mapped_column(default=False)


class Import(Base):
    """The one-time sheet import (spec §5.8). Its presence means the import can't run again."""

    __tablename__ = "imports"

    id: Mapped[int] = mapped_column(primary_key=True)
    committed_at: Mapped[dt.datetime] = mapped_column(DateTime)
    cutoff: Mapped[dt.date] = mapped_column(Date)  # rows on or after it were left to the app


class ImportFile(Base):
    """One uploaded tab: its totals as the sheet shows them, and what was actually imported."""

    __tablename__ = "import_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    import_id: Mapped[int] = mapped_column(ForeignKey("imports.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    legacy_total: Mapped[int]
    ticket_total: Mapped[int]
    imported_total: Mapped[int]
    imported_tickets: Mapped[int]
