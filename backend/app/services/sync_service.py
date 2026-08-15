"""Offline sync processing.

The client submits a batch of operations it recorded while offline. Every
operation carries a client-generated UUID which is the idempotency key:
re-submitting the same operation (retry, duplicate request, app restart)
never creates a second record.

Protocol:  POST /api/sync  {"operations": [...]}

Each op is processed in its own savepoint, so a failed op (e.g. a payment
that no longer fits the balance) does not roll back the rest of the batch
— partial synchronization works. The client keeps failed ops pending and
surfaces them to the user.

Operation shapes:
  create_customer  {op, client_uuid, name, phone?, notes?}
  update_customer  {op, client_uuid, customer_client_uuid, name?, phone?, notes?}
  credit           {op, client_uuid, customer_client_uuid, amount_minor, note?}
  payment          {op, client_uuid, customer_client_uuid, amount_minor,
                    payment_method?, note?}
  void             {op, client_uuid, entry_client_uuid, reason?}

update_customer is idempotent by nature (re-applying an edit has no side
 effect), so it needs no dedupe key beyond the customer reference.
"""

import logging

from sqlalchemy.exc import IntegrityError

from app.errors import ApiError
from app.extensions import db
from app.models import Customer, LedgerEntry
from app.services.ledger_service import (
    outstanding_balance_minor,
    record_credit,
    record_payment,
    void_entry,
)
from app.validation import (
    validate_amount_minor,
    validate_name,
    validate_optional_text,
    validate_payment_method,
    validate_phone,
)

MAX_BATCH = 200

logger = logging.getLogger(__name__)


class _OpError(Exception):
    def __init__(self, message: str):
        self.message = message


def process_sync_operations(trader_id: int, operations: list[dict]) -> list[dict]:
    """Process a batch of offline operations, one SAVEPOINT per op.

    Each operation commits or rolls back independently, so a failure in one
    op never blocks or corrupts the others (partial synchronization). A
    duplicate client_uuid is treated as an idempotent success.
    """
    results: list[dict] = []
    if not isinstance(operations, list):
        raise _OpError("operations must be a list")
    if len(operations) > MAX_BATCH:
        raise _OpError(f"Too many operations in one sync (max {MAX_BATCH}).")

    for raw_op in operations:
        op = raw_op if isinstance(raw_op, dict) else {}
        client_uuid = str(op.get("client_uuid") or "").strip()
        if not client_uuid:
            results.append(_error(op, "missing client_uuid"))
            continue
        try:
            with db.session.begin_nested():
                result = _process_one(trader_id, op, client_uuid)
            results.append(result)
        except _OpError as err:
            # Contract failure (e.g. customer reference not synced yet).
            results.append(_error(op, err.message))
        except ApiError as err:
            # Validation failure (e.g. payment exceeds balance) — reported per-op.
            results.append(_error(op, err.message))
        except IntegrityError:
            results.append(_error(op, "Couldn't save this record. Please try again."))
        except Exception:  # pragma: no cover - defensive
            logger.exception("Sync op failed: %s", op.get("op"))
            results.append(_error(op, "Something went wrong saving this record."))
    # Persist every successfully processed op atomically. Without this the
    # uncommitted work would be rolled back when the request session ends.
    db.session.commit()
    return results


def _process_one(trader_id: int, op: dict, client_uuid: str) -> dict:
    op_type = str(op.get("op") or "").strip().upper()
    if op_type == "CREATE_CUSTOMER":
        return _create_customer(trader_id, op, client_uuid)
    if op_type == "UPDATE_CUSTOMER":
        return _update_customer(trader_id, op, client_uuid)
    if op_type == "CREDIT":
        return _credit(trader_id, op, client_uuid)
    if op_type == "PAYMENT":
        return _payment(trader_id, op, client_uuid)
    if op_type == "VOID":
        return _void(trader_id, op, client_uuid)
    raise _OpError(f"Unknown operation: {op_type or '(empty)'}")


def _duplicate(result_dict: dict) -> dict:
    result_dict["status"] = "ok"
    result_dict["duplicate"] = True
    return result_dict


def _create_customer(trader_id: int, op: dict, client_uuid: str) -> dict:
    name = validate_name(op.get("name"))
    phone = validate_phone(op.get("phone"))
    notes = validate_optional_text(op.get("notes"), "notes", max_len=2000)
    existing = Customer.query.filter_by(
        trader_id=trader_id, client_uuid=client_uuid
    ).first()
    if existing is not None:
        return _duplicate(
            {
                "client_uuid": client_uuid,
                "server_id": existing.id,
            }
        )
    customer = Customer(
        trader_id=trader_id,
        client_uuid=client_uuid,
        name=name,
        phone=phone,
        notes=notes,
    )
    db.session.add(customer)
    db.session.flush()
    return {"client_uuid": client_uuid, "status": "ok", "server_id": customer.id}


def _update_customer(trader_id: int, op: dict, client_uuid: str) -> dict:
    customer = _resolve_customer(trader_id, str(op.get("customer_client_uuid") or ""))
    if op.get("name") is not None:
        customer.name = validate_name(op.get("name"))
    if op.get("phone") is not None:
        customer.phone = validate_phone(op.get("phone"))
    if op.get("notes") is not None:
        customer.notes = validate_optional_text(op.get("notes"), "notes", max_len=2000)
    db.session.flush()
    return {
        "client_uuid": client_uuid,
        "status": "ok",
        "server_id": customer.id,
        "balance_minor": outstanding_balance_minor(trader_id, customer.id),
    }


def _resolve_customer(trader_id: int, client_uuid: str) -> Customer:
    customer = Customer.query.filter_by(
        trader_id=trader_id, client_uuid=client_uuid
    ).first()
    if customer is None:
        raise _OpError("This customer hasn't been saved yet. Sync the customer first.")
    return customer


def _credit(trader_id: int, op: dict, client_uuid: str) -> dict:
    customer = _resolve_customer(trader_id, str(op.get("customer_client_uuid") or ""))
    amount = validate_amount_minor(op.get("amount_minor"))
    note = validate_optional_text(op.get("note"), "note", max_len=255)
    existing = LedgerEntry.query.filter_by(
        trader_id=trader_id, client_uuid=client_uuid
    ).first()
    if existing is not None:
        return _duplicate(
            {
                "client_uuid": client_uuid,
                "server_id": existing.id,
                "balance_minor": outstanding_balance_minor(trader_id, customer.id),
            }
        )
    entry = record_credit(trader_id, customer.id, amount, note=note, client_uuid=client_uuid)
    db.session.flush()
    return {
        "client_uuid": client_uuid,
        "status": "ok",
        "server_id": entry.id,
        "balance_minor": outstanding_balance_minor(trader_id, customer.id),
    }


def _payment(trader_id: int, op: dict, client_uuid: str) -> dict:
    customer = _resolve_customer(trader_id, str(op.get("customer_client_uuid") or ""))
    amount = validate_amount_minor(op.get("amount_minor"))
    method = validate_payment_method(op.get("payment_method"))
    note = validate_optional_text(op.get("note"), "note", max_len=255)
    existing = LedgerEntry.query.filter_by(
        trader_id=trader_id, client_uuid=client_uuid
    ).first()
    if existing is not None:
        return _duplicate(
            {
                "client_uuid": client_uuid,
                "server_id": existing.id,
                "balance_minor": outstanding_balance_minor(trader_id, customer.id),
            }
        )
    entry = record_payment(
        trader_id,
        customer.id,
        amount,
        payment_method=method,
        note=note,
        client_uuid=client_uuid,
    )
    db.session.flush()
    return {
        "client_uuid": client_uuid,
        "status": "ok",
        "server_id": entry.id,
        "balance_minor": outstanding_balance_minor(trader_id, customer.id),
    }


def _void(trader_id: int, op: dict, client_uuid: str) -> dict:
    entry_client_uuid = str(op.get("entry_client_uuid") or "")
    entry = LedgerEntry.query.filter_by(
        trader_id=trader_id, client_uuid=entry_client_uuid
    ).first()
    if entry is None:
        raise _OpError("That transaction doesn't exist.")
    reason = validate_optional_text(op.get("reason"), "reason", max_len=255)
    if entry.voided_at is not None:
        # Already voided — idempotent success.
        return _duplicate(
            {
                "client_uuid": client_uuid,
                "server_id": entry.id,
                "balance_minor": outstanding_balance_minor(trader_id, entry.customer_id),
            }
        )
    void_entry(trader_id, entry.id, reason=reason)
    db.session.flush()
    return {
        "client_uuid": client_uuid,
        "status": "ok",
        "server_id": entry.id,
        "balance_minor": outstanding_balance_minor(trader_id, entry.customer_id),
    }


def _error(op: dict, message: str) -> dict:
    return {
        "client_uuid": str(op.get("client_uuid") or ""),
        "status": "error",
        "message": message,
    }
