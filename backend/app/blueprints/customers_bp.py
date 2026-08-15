"""Customer endpoints.

Ownership is enforced server-side from the auth context: every query is
scoped to the authenticated trader. Searching matches name or phone
(case-insensitive substring).
"""

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.auth_helpers import current_trader
from app.errors import bad_request, not_found
from app.extensions import db
from app.models import Customer, LedgerEntry, new_uuid
from app.services.ledger_service import (
    balances_for_trader,
    get_customer_or_404,
    outstanding_balance_minor,
)
from app.validation import (
    validate_name,
    validate_optional_text,
    validate_phone,
)

bp = Blueprint("customers", __name__, url_prefix="/api/customers")


def customer_payload(customer: Customer, balance_minor: int) -> dict:
    return {
        "id": customer.id,
        "client_uuid": customer.client_uuid,
        "name": customer.name,
        "phone": customer.phone,
        "notes": customer.notes,
        "balance_minor": balance_minor,
        "created_at": customer.created_at.isoformat(),
    }


@bp.get("")
@jwt_required()
def list_customers():
    trader = current_trader()
    query = request.args.get("q", "").strip()
    if len(query) > 100:
        raise bad_request(
            "Search text is too long.", code="invalid_search"
        )

    base = Customer.query.filter_by(trader_id=trader.id)
    if query:
        pattern = f"%{query}%"
        base = base.filter(
            db.or_(
                Customer.name.ilike(pattern),
                Customer.phone.ilike(pattern),
            )
        )
    customers = base.order_by(Customer.name.asc(), Customer.id.asc()).all()

    balances = balances_for_trader(trader.id)
    return jsonify(
        {
            "customers": [
                customer_payload(c, balances.get(c.id, 0)) for c in customers
            ],
            "total_owed_minor": sum(balances.get(c.id, 0) for c in customers),
        }
    )


@bp.post("")
@jwt_required()
def create_customer():
    trader = current_trader()
    data = request.get_json(silent=True) or {}
    name = validate_name(data.get("name"))
    phone = validate_phone(data.get("phone"))
    notes = validate_optional_text(data.get("notes"), "notes", max_len=2000)
    client_uuid = str(data.get("client_uuid") or "").strip() or new_uuid()

    if Customer.query.filter_by(trader_id=trader.id, client_uuid=client_uuid).first():
        raise bad_request(
            "That customer was already added.", code="duplicate_client_uuid"
        )

    customer = Customer(
        trader_id=trader.id,
        client_uuid=client_uuid,
        name=name,
        phone=phone,
        notes=notes,
    )
    db.session.add(customer)
    db.session.commit()
    return jsonify(customer_payload(customer, 0)), 201


@bp.get("/<int:customer_id>")
@jwt_required()
def get_customer(customer_id: int):
    trader = current_trader()
    customer = get_customer_or_404(trader.id, customer_id)
    return jsonify(customer_payload(customer, outstanding_balance_minor(trader.id, customer.id)))


@bp.patch("/<int:customer_id>")
@jwt_required()
def update_customer(customer_id: int):
    trader = current_trader()
    customer = get_customer_or_404(trader.id, customer_id)
    data = request.get_json(silent=True) or {}

    if "name" in data:
        customer.name = validate_name(data.get("name"))
    if "phone" in data:
        customer.phone = validate_phone(data.get("phone"))
    if "notes" in data:
        customer.notes = validate_optional_text(data.get("notes"), "notes", max_len=2000)

    db.session.commit()
    return jsonify(customer_payload(customer, outstanding_balance_minor(trader.id, customer.id)))


@bp.get("/<int:customer_id>/ledger")
@jwt_required()
def customer_ledger(customer_id: int):
    trader = current_trader()
    customer = get_customer_or_404(trader.id, customer_id)
    # Malformed pagination args must be a clean 400, not a 500 crash.
    # Numeric out-of-range values are clamped to sane bounds.
    try:
        limit = min(max(int(request.args.get("limit", 100)), 1), 500)
        offset = max(int(request.args.get("offset", 0)), 0)
    except (TypeError, ValueError):
        raise bad_request(
            "limit and offset must be whole numbers.", code="invalid_pagination"
        )

    entries = (
        LedgerEntry.query.filter_by(trader_id=trader.id, customer_id=customer.id)
        .order_by(LedgerEntry.created_at.desc(), LedgerEntry.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    balance = outstanding_balance_minor(trader.id, customer.id)
    return jsonify(
        {
            "customer": customer_payload(customer, balance),
            "entries": [e.to_dict() for e in entries],
            "balance_minor": balance,
        }
    )
