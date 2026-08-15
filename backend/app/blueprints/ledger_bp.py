"""Ledger endpoints.

Recording credit/payment and voiding run through the ledger service, which
owns the invariants (positive amounts, no overpayment, no silent mutation).
Each financial write commits atomically.
"""

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.auth_helpers import current_trader
from app.extensions import db
from app.models import LedgerEntry
from app.services.ledger_service import (
    get_customer_or_404,
    outstanding_balance_minor,
    record_credit,
    record_payment,
    void_entry,
)
from app.validation import (
    validate_amount_minor,
    validate_integer,
    validate_optional_text,
    validate_payment_method,
)

bp = Blueprint("ledger", __name__, url_prefix="/api/ledger")


def _entry_response(entry: LedgerEntry) -> dict:
    return {
        "entry": entry.to_dict(),
        "balance_minor": outstanding_balance_minor(entry.trader_id, entry.customer_id),
    }


@bp.post("/credit")
@jwt_required()
def credit():
    trader = current_trader()
    data = request.get_json(silent=True) or {}
    customer_id = validate_integer(
        data.get("customer_id"), "customer_id", min_value=1
    )
    customer = get_customer_or_404(trader.id, customer_id)
    amount = validate_amount_minor(data.get("amount_minor"))
    note = validate_optional_text(data.get("note"), "note", max_len=255)
    client_uuid = str(data.get("client_uuid") or "").strip() or None

    entry = record_credit(trader.id, customer.id, amount, note=note, client_uuid=client_uuid)
    db.session.commit()
    return jsonify(_entry_response(entry)), 201


@bp.post("/payment")
@jwt_required()
def payment():
    trader = current_trader()
    data = request.get_json(silent=True) or {}
    customer_id = validate_integer(
        data.get("customer_id"), "customer_id", min_value=1
    )
    customer = get_customer_or_404(trader.id, customer_id)
    amount = validate_amount_minor(data.get("amount_minor"))
    method = validate_payment_method(data.get("payment_method"))
    note = validate_optional_text(data.get("note"), "note", max_len=255)
    client_uuid = str(data.get("client_uuid") or "").strip() or None

    entry = record_payment(
        trader.id,
        customer.id,
        amount,
        payment_method=method,
        note=note,
        client_uuid=client_uuid,
    )
    db.session.commit()
    return jsonify(_entry_response(entry)), 201


@bp.post("/<int:entry_id>/void")
@jwt_required()
def void(entry_id: int):
    trader = current_trader()
    data = request.get_json(silent=True) or {}
    reason = validate_optional_text(data.get("reason"), "reason", max_len=255)

    entry = void_entry(trader.id, entry_id, reason=reason)
    db.session.commit()
    return jsonify(_entry_response(entry))
