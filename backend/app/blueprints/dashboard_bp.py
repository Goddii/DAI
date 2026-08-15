"""Dashboard summary.

Answers the trader's three questions:
  1. How much am I owed in total?
  2. How many customers owe me?
  3. Who needs attention (top outstanding customers)?
"""

from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required

from app.auth_helpers import current_trader
from app.models import Customer
from app.services.ledger_service import balances_for_trader

bp = Blueprint("dashboard", __name__, url_prefix="/api/dashboard")

TOP_N = 5


@bp.get("/summary")
@jwt_required()
def summary():
    trader = current_trader()
    balances = balances_for_trader(trader.id)

    total_owed = sum(balances.values())
    customers_owing = sum(1 for b in balances.values() if b > 0)

    top = sorted(
        ((cid, b) for cid, b in balances.items() if b > 0),
        key=lambda item: item[1],
        reverse=True,
    )[:TOP_N]

    customers_by_id = {
        c.id: c for c in Customer.query.filter(
            Customer.id.in_([cid for cid, _ in top])
        ).all()
    } if top else {}

    top_customers = [
        {
            "id": cid,
            "name": customers_by_id[cid].name,
            "balance_minor": b,
        }
        for cid, b in top
        if cid in customers_by_id
    ]

    return jsonify(
        {
            "total_owed_minor": total_owed,
            "customers_owing": customers_owing,
            "total_customers": Customer.query.filter_by(trader_id=trader.id).count(),
            "top_customers": top_customers,
        }
    )
