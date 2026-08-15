"""Data model.

Money rule: every amount is stored as an INTEGER of minor units (cents,
1 KSh = 100 cents). Floating point is never used for money.

Balance rule: there is no mutable balance column. The balance is always
derived from non-voided ledger entries (CREDIT adds, PAYMENT subtracts).
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, Index, UniqueConstraint

from app.extensions import db


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_uuid() -> str:
    return str(uuid.uuid4())


class Trader(db.Model):
    __tablename__ = "traders"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    # Phone is the login identifier. Normalized before storage (digits, optional leading +).
    phone = db.Column(db.String(20), nullable=False, unique=True, index=True)
    email = db.Column(db.String(255), nullable=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )

    customers = db.relationship(
        "Customer", back_populates="trader", cascade="all, delete-orphan"
    )
    ledger_entries = db.relationship(
        "LedgerEntry", back_populates="trader", cascade="all, delete-orphan"
    )


class Customer(db.Model):
    __tablename__ = "customers"
    __table_args__ = (
        UniqueConstraint(
            "trader_id", "client_uuid", name="uq_customer_trader_client_uuid"
        ),
        Index("ix_customers_trader_name", "trader_id", "name"),
    )

    id = db.Column(db.Integer, primary_key=True)
    trader_id = db.Column(
        db.Integer, db.ForeignKey("traders.id"), nullable=False, index=True
    )
    # Client-generated UUID: the sync idempotency key for offline-created customers.
    client_uuid = db.Column(db.String(36), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    phone = db.Column(db.String(20), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )

    trader = db.relationship("Trader", back_populates="customers")
    ledger_entries = db.relationship(
        "LedgerEntry",
        back_populates="customer",
        cascade="all, delete-orphan",
        order_by="LedgerEntry.created_at",
    )


class LedgerEntry(db.Model):
    __tablename__ = "ledger_entries"
    __table_args__ = (
        # Idempotency: the same client_uuid can never create two entries for a trader.
        UniqueConstraint(
            "trader_id", "client_uuid", name="uq_ledger_trader_client_uuid"
        ),
        CheckConstraint("amount > 0", name="ck_ledger_amount_positive"),
        CheckConstraint(
            "type IN ('CREDIT', 'PAYMENT')", name="ck_ledger_type"
        ),
        Index("ix_ledger_customer_created", "trader_id", "customer_id", "created_at"),
    )

    id = db.Column(db.Integer, primary_key=True)
    trader_id = db.Column(
        db.Integer, db.ForeignKey("traders.id"), nullable=False, index=True
    )
    customer_id = db.Column(
        db.Integer, db.ForeignKey("customers.id"), nullable=False, index=True
    )
    # CREDIT | PAYMENT
    type = db.Column(db.String(10), nullable=False)
    # Minor units (cents). Always > 0; direction is expressed by `type`.
    amount = db.Column(db.Integer, nullable=False)
    # CASH | MPESA | OTHER — only meaningful for PAYMENT entries.
    payment_method = db.Column(db.String(20), nullable=True)
    note = db.Column(db.String(255), nullable=True)
    # Client-generated UUID: the sync idempotency key.
    client_uuid = db.Column(db.String(36), nullable=False)
    # Non-null means the entry has been voided. Voided entries stay in the
    # ledger (audit trail) but are excluded from balance calculations.
    voided_at = db.Column(db.DateTime(timezone=True), nullable=True)
    void_reason = db.Column(db.String(255), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
    )

    trader = db.relationship("Trader", back_populates="ledger_entries")
    customer = db.relationship("Customer", back_populates="ledger_entries")

    def to_dict(self, balance_minor: int | None = None) -> dict:
        data = {
            "id": self.id,
            "type": self.type,
            "amount_minor": self.amount,
            "payment_method": self.payment_method,
            "note": self.note,
            "client_uuid": self.client_uuid,
            "voided": self.voided_at is not None,
            "void_reason": self.void_reason,
            "created_at": self.created_at.isoformat(),
        }
        if balance_minor is not None:
            data["balance_minor"] = balance_minor
        return data
