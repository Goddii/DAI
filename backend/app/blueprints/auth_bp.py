"""Auth endpoints.

Registration + login issue a JWT access token. Passwords are hashed with
werkzeug (PBKDF2) and never stored or returned in plaintext. Logout is
client-side token discard (the endpoint exists for API symmetry and
returns 204); tokens are long-lived (default 30 days) for a daily-use
phone app, and the login endpoint is rate-limited per IP+phone.

Failed logins and rate-limit blocks are logged (phone + IP, never the
password) so credential stuffing is visible server-side.
"""

import logging

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required
from werkzeug.security import check_password_hash, generate_password_hash

from app.errors import ApiError, bad_request, conflict
from app.extensions import db
from app.limiter import SlidingWindowLimiter
from app.models import Trader
from app.validation import (
    require_fields,
    validate_name,
    validate_password,
    validate_phone,
)

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

logger = logging.getLogger(__name__)

_limiter = SlidingWindowLimiter(
    limit=lambda: current_app.config.get("LOGIN_RATE_LIMIT", 10),
    window_seconds=lambda: current_app.config.get("LOGIN_RATE_WINDOW_SECONDS", 300),
)


def trader_payload(trader: Trader) -> dict:
    return {
        "id": trader.id,
        "name": trader.name,
        "phone": trader.phone,
        "email": trader.email,
    }


@bp.post("/register")
def register():
    data = request.get_json(silent=True) or {}
    require_fields(data, "name", "phone", "password")
    name = validate_name(data.get("name"))
    phone = validate_phone(data.get("phone"))
    password = validate_password(data.get("password"))
    email = data.get("email") or None

    if Trader.query.filter_by(phone=phone).first() is not None:
        raise conflict(
            "An account with this phone number already exists. Try logging in.",
            code="phone_taken",
        )
    if email:
        email = str(email).strip()
        if Trader.query.filter_by(email=email).first() is not None:
            raise conflict("An account with this email already exists.", code="email_taken")

    trader = Trader(
        name=name,
        phone=phone,
        email=email,
        password_hash=generate_password_hash(password),
    )
    db.session.add(trader)
    db.session.commit()

    token = create_access_token(identity=str(trader.id))
    return jsonify({"token": token, "trader": trader_payload(trader)}), 201


@bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    require_fields(data, "phone", "password")
    phone = validate_phone(data.get("phone"))
    password = str(data.get("password") or "")

    key = f"{request.remote_addr}:{phone}"
    allowed, retry_after = _limiter.allow(key)
    if not allowed:
        logger.warning(
            "Rate-limited login for phone %s from %s", phone, request.remote_addr
        )
        raise ApiError(
            429,
            f"Too many attempts. Try again in {retry_after} seconds.",
            code="rate_limited",
        )

    trader = Trader.query.filter_by(phone=phone).first()
    if trader is None or not check_password_hash(trader.password_hash, password):
        # The failed attempt is already recorded by `allow` above.
        logger.warning(
            "Failed login for phone %s from %s", phone, request.remote_addr
        )
        raise ApiError(
            401,
            "Wrong phone number or password.",
            code="invalid_credentials",
        )

    _limiter.reset(key)
    token = create_access_token(identity=str(trader.id))
    return jsonify({"token": token, "trader": trader_payload(trader)})


@bp.post("/logout")
@jwt_required()
def logout():
    # JWT is stateless; the client discards the token. Endpoint for symmetry.
    return ("", 204)


@bp.get("/me")
@jwt_required()
def me():
    trader = db.session.get(Trader, int(get_jwt_identity()))
    if trader is None:
        raise ApiError(401, "Session expired. Please log in again.", code="invalid_token")
    return jsonify({"trader": trader_payload(trader)})
