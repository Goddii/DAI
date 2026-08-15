"""Helpers for authenticated endpoints."""

from flask_jwt_extended import get_jwt_identity

from app.errors import ApiError
from app.extensions import db
from app.models import Trader


def current_trader() -> Trader:
    """Load the authenticated trader. The trader identity ALWAYS comes from
    the JWT — the client never supplies a trader ID."""
    identity = get_jwt_identity()
    try:
        trader_id = int(identity)
    except (TypeError, ValueError):
        raise ApiError(401, "Session expired. Please log in again.", code="invalid_token")
    trader = db.session.get(Trader, trader_id)
    if trader is None:
        raise ApiError(401, "Session expired. Please log in again.", code="invalid_token")
    return trader
