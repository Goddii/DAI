"""Sync endpoint.

Accepts a batch of offline operations from an authenticated trader and
returns per-operation results. Idempotent by client_uuid. See
app/services/sync_service.py for the protocol details.
"""

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.auth_helpers import current_trader
from app.services.sync_service import process_sync_operations

bp = Blueprint("sync", __name__, url_prefix="/api")


@bp.post("/sync")
@jwt_required()
def sync():
    trader = current_trader()
    data = request.get_json(silent=True) or {}
    operations = data.get("operations")
    if not isinstance(operations, list):
        return jsonify({"error": {"message": "operations must be a list.", "code": "bad_request"}}), 400

    results = process_sync_operations(trader.id, operations)
    return jsonify({"results": results})
