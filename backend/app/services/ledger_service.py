"""Ledger business logic.

The ledger is the source of truth. Balances are always derived from
non-voided entries:

    balance = SUM(CREDIT.amount) - SUM(PAYMENT.amount)  (voided excluded)

All money is integer minor units (cents). Every financial operation runs
inside a database transaction and completes atomically or not at all.
"""

from sqlalchemy import case, func, select

from app.errors import ApiError, bad_request, not_found
from app.extensions import db
from app.models import Customer, LedgerEntry, new_uuid


def get_customer_or_404(trader_id: int, customer_id: int) -> Customer:
    customer = db.session.get(Customer, customer_id)
    if customer is None or customer.trader_id != trader_id:
        raise not_found("That customer doesn't exist.", code="customer_not_found")
    return customer


def outstanding_balance_minor(trader_id: int, customer_id: int) -> int:
    """Derived outstanding balance for one customer, in minor units."""
    total = db.session.execute(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (LedgerEntry.type == "CREDIT", LedgerEntry.amount),
                        else_=-LedgerEntry.amount,
                    )
                ),
                0,
            )
        ).where(
            LedgerEntry.trader_id == trader_id,
            LedgerEntry.customer_id == customer_id,
            LedgerEntry.voided_at.is_(None),
        )
    ).scalar()
    return int(total or 0)


def balances_for_trader(trader_id: int) -> dict[int, int]:
    """{customer_id: outstanding_minor} for every customer of the trader."""
    rows = db.session.execute(
        select(
            LedgerEntry.customer_id,
            func.coalesce(
                func.sum(
                    case(
                        (LedgerEntry.type == "CREDIT", LedgerEntry.amount),
                        else_=-LedgerEntry.amount,
                    )
                ),
                0,
            ),
        )
        .where(
            LedgerEntry.trader_id == trader_id,
            LedgerEntry.voided_at.is_(None),
        )
        .group_by(LedgerEntry.customer_id)
    ).all()
    return {customer_id: int(balance or 0) for customer_id, balance in rows}


def record_credit(
    trader_id: int,
    customer_id: int,
    amount_minor: int,
    note: str | None = None,
    client_uuid: str | None = None,
) -> LedgerEntry:
    """Record a credit. Atomic: the entry is created or nothing happens."""
    customer = _lock_customer(trader_id, customer_id)
    entry = LedgerEntry(
        trader_id=trader_id,
        customer_id=customer.id,
        type="CREDIT",
        amount=amount_minor,
        note=note,
        client_uuid=client_uuid or new_uuid(),
    )
    db.session.add(entry)
    db.session.flush()
    return entry


def record_payment(
    trader_id: int,
    customer_id: int,
    amount_minor: int,
    payment_method: str | None = None,
    note: str | None = None,
    client_uuid: str | None = None,
) -> LedgerEntry:
    """Record a payment.

    Guards:
      - a payment on a customer with no outstanding balance is rejected;
      - a payment larger than the outstanding balance is rejected
        (prevents accidental overpayment; credit balances are out of scope).
    """
    customer = _lock_customer(trader_id, customer_id)
    balance = outstanding_balance_minor(trader_id, customer.id)
    if balance <= 0:
        raise bad_request(
            f"{customer.name} doesn't owe anything right now.",
            code="no_outstanding_balance",
            details={"balance_minor": 0},
        )
    if amount_minor > balance:
        raise bad_request(
            "That payment is more than what's owed. "
            f"Current balance is KSh {balance / 100:,.0f}.",
            code="payment_exceeds_balance",
            details={"balance_minor": balance},
        )
    entry = LedgerEntry(
        trader_id=trader_id,
        customer_id=customer.id,
        type="PAYMENT",
        amount=amount_minor,
        payment_method=payment_method or "CASH",
        note=note,
        client_uuid=client_uuid or new_uuid(),
    )
    db.session.add(entry)
    db.session.flush()
    return entry


def void_entry(
    trader_id: int,
    entry_id: int,
    reason: str | None = None,
) -> LedgerEntry:
    """Void an entry. Never mutates history — the entry stays, marked voided.

    The balance effect reverses (a voided credit no longer counts, a voided
    payment no longer reduces the balance).
    """
    entry = db.session.get(LedgerEntry, entry_id)
    if entry is None or entry.trader_id != trader_id:
        raise not_found("That transaction doesn't exist.", code="entry_not_found")
    if entry.voided_at is not None:
        raise bad_request(
            "That transaction has already been voided.", code="already_voided"
        )
    from app.models import utcnow

    entry.voided_at = utcnow()
    entry.void_reason = reason or None
    db.session.flush()
    return entry


def _lock_customer(trader_id: int, customer_id: int) -> Customer:
    """Fetch the customer with a row lock so concurrent financial ops on the
    same customer serialize (no-op on SQLite; enforced on PostgreSQL)."""
    stmt = (
        select(Customer)
        .where(Customer.id == customer_id, Customer.trader_id == trader_id)
        .with_for_update()
    )
    customer = db.session.execute(stmt).scalar_one_or_none()
    if customer is None:
        raise not_found("That customer doesn't exist.", code="customer_not_found")
    return customer


def format_ksh(amount_minor: int) -> str:
    """Human display helper used in error messages. Frontend does its own
    formatting; this is only for server-generated messages."""
    return f"KSh {amount_minor / 100:,.0f}"
