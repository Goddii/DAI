"""Auth endpoints.

Registration + login issue a JWT access token. Passwords are hashed with
werkzeug (PBKDF2) and never stored or returned in plaintext. Logout is
client-side token discard (the endpoint exists for API symmetry and
returns 204); tokens are long-lived (default 30 days) for a daily-use
phone app, and the login endpoint is rate-limited per IP+phone.

Failed logins and rate-limit blocks are logged (phone + IP, never the
password) so credential stuffing is visible server-side.
"""

import hashlib
import logging
import secrets
import smtplib
from datetime import timedelta

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required
from sqlalchemy import func
from werkzeug.security import check_password_hash, generate_password_hash

from app.errors import ApiError, bad_request, conflict
from app.extensions import db
from app.limiter import SlidingWindowLimiter
from app.models import EmailVerificationToken, PasswordResetToken, Trader, utcnow
from app.services.email_service import (
    send_email_verification_email,
    send_password_reset_email,
)
from app.validation import (
    require_fields,
    validate_email,
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
_password_reset_limiter = SlidingWindowLimiter(
    limit=lambda: current_app.config.get("PASSWORD_RESET_RATE_LIMIT", 5),
    window_seconds=lambda: current_app.config.get(
        "PASSWORD_RESET_RATE_WINDOW_SECONDS", 900
    ),
)
_password_reset_confirm_limiter = SlidingWindowLimiter(
    limit=lambda: current_app.config.get("PASSWORD_RESET_CONFIRM_RATE_LIMIT", 10),
    window_seconds=lambda: current_app.config.get(
        "PASSWORD_RESET_CONFIRM_RATE_WINDOW_SECONDS", 300
    ),
)
_email_verification_limiter = SlidingWindowLimiter(
    limit=lambda: current_app.config.get("EMAIL_VERIFICATION_RATE_LIMIT", 5),
    window_seconds=lambda: current_app.config.get(
        "EMAIL_VERIFICATION_RATE_WINDOW_SECONDS", 900
    ),
)

PASSWORD_RESET_MESSAGE = (
    "If an account exists for that email, a password reset link will be sent."
)


def trader_payload(trader: Trader) -> dict:
    return {
        "id": trader.id,
        "name": trader.name,
        "phone": trader.phone,
        "email": trader.email,
        "email_verified": trader.email_verified,
    }


@bp.post("/register")
def register():
    data = request.get_json(silent=True) or {}
    require_fields(data, "name", "phone", "password")
    name = validate_name(data.get("name"))
    phone = validate_phone(data.get("phone"))
    password = validate_password(data.get("password"))
    email = validate_email(data.get("email"), optional=True)

    if Trader.query.filter_by(phone=phone).first() is not None:
        raise conflict(
            "An account with this phone number already exists. Try logging in.",
            code="phone_taken",
        )
    if email:
        if (
            db.session.query(Trader.id)
            .filter(func.lower(Trader.email) == email)
            .first()
        ):
            raise conflict(
                "An account with this email already exists.", code="email_taken"
            )

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


@bp.post("/password-reset/request")
def request_password_reset():
    data = request.get_json(silent=True) or {}
    require_fields(data, "email")
    email = validate_email(data.get("email"))

    key = str(request.remote_addr)
    allowed, retry_after = _password_reset_limiter.allow(key)
    if not allowed:
        raise ApiError(
            429,
            f"Too many reset requests. Try again in {retry_after} seconds.",
            code="rate_limited",
        )

    frontend_url = current_app.config.get("FRONTEND_URL", "").rstrip("/")
    if (
        not current_app.config.get("SMTP_HOST")
        or not current_app.config.get("SMTP_FROM")
        or not frontend_url
    ):
        logger.error("Password reset email is not configured")
        raise ApiError(
            503,
            "Password reset is temporarily unavailable.",
            code="email_unavailable",
        )

    trader = (
        db.session.query(Trader)
        .filter(
            func.lower(Trader.email) == email,
            Trader.email_verified.is_(True),
        )
        .first()
    )
    if trader is None:
        return jsonify({"message": PASSWORD_RESET_MESSAGE})

    reset_token = secrets.token_urlsafe(32)
    now = utcnow()
    db.session.query(PasswordResetToken).filter_by(trader_id=trader.id).delete(
        synchronize_session=False
    )
    db.session.add(
        PasswordResetToken(
            trader_id=trader.id,
            token_hash=hashlib.sha256(reset_token.encode("utf-8")).hexdigest(),
            expires_at=now + timedelta(minutes=30),
        )
    )
    db.session.commit()

    reset_url = f"{frontend_url}/?reset_token={reset_token}"
    try:
        send_password_reset_email(trader.email, reset_url)
    except (OSError, RuntimeError, ValueError, smtplib.SMTPException) as exc:
        db.session.query(PasswordResetToken).filter_by(
            token_hash=hashlib.sha256(reset_token.encode("utf-8")).hexdigest()
        ).update({"used_at": utcnow()}, synchronize_session=False)
        db.session.commit()
        logger.error(
            "Password reset email delivery failed (%s)", type(exc).__name__
        )

    return jsonify({"message": PASSWORD_RESET_MESSAGE})


@bp.post("/email-verification/request")
@jwt_required()
def request_email_verification():
    data = request.get_json(silent=True) or {}
    require_fields(data, "email", "password")
    email = validate_email(data.get("email"))
    trader = db.session.get(Trader, int(get_jwt_identity()))
    if trader is None:
        raise ApiError(401, "Session expired. Please log in again.", code="invalid_token")
    if not check_password_hash(trader.password_hash, str(data.get("password") or "")):
        raise ApiError(401, "Your current password is incorrect.", code="invalid_credentials")

    key = f"{request.remote_addr}:{trader.id}"
    allowed, retry_after = _email_verification_limiter.allow(key)
    if not allowed:
        raise ApiError(
            429,
            f"Too many verification requests. Try again in {retry_after} seconds.",
            code="rate_limited",
        )

    if trader.email == email and trader.email_verified:
        return jsonify({"message": "That recovery email is already verified."})
    existing = (
        db.session.query(Trader.id)
        .filter(func.lower(Trader.email) == email, Trader.id != trader.id)
        .first()
    )
    if existing:
        raise conflict(
            "That email is already linked to another account.",
            code="email_taken",
        )

    frontend_url = current_app.config.get("FRONTEND_URL", "").rstrip("/")
    if (
        not current_app.config.get("SMTP_HOST")
        or not current_app.config.get("SMTP_FROM")
        or not frontend_url
    ):
        logger.error("Recovery email verification is not configured")
        raise ApiError(
            503,
            "Email verification is temporarily unavailable.",
            code="email_unavailable",
        )

    verification_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(verification_token.encode("utf-8")).hexdigest()
    now = utcnow()
    db.session.query(EmailVerificationToken).filter_by(
        trader_id=trader.id
    ).delete(synchronize_session=False)
    db.session.add(
        EmailVerificationToken(
            trader_id=trader.id,
            email=email,
            token_hash=token_hash,
            expires_at=now + timedelta(minutes=30),
        )
    )
    db.session.commit()

    verify_url = f"{frontend_url}/?verify_email_token={verification_token}"
    try:
        send_email_verification_email(email, verify_url)
    except (OSError, RuntimeError, ValueError, smtplib.SMTPException) as exc:
        db.session.query(EmailVerificationToken).filter_by(
            token_hash=token_hash
        ).update({"used_at": utcnow()}, synchronize_session=False)
        db.session.commit()
        logger.error(
            "Recovery email verification delivery failed (%s)", type(exc).__name__
        )
        raise ApiError(
            503,
            "We couldn't send the verification email. Please try again later.",
            code="email_delivery_failed",
        )

    return jsonify({"message": "Check your email for a verification link."})


@bp.post("/email-verification/confirm")
def confirm_email_verification():
    data = request.get_json(silent=True) or {}
    require_fields(data, "token")
    token = data.get("token")
    if not isinstance(token, str) or len(token) > 256:
        raise bad_request(
            "That verification link is invalid or has expired.",
            code="invalid_verification_token",
        )

    now = utcnow()
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    verification = (
        EmailVerificationToken.query.filter_by(token_hash=token_hash, used_at=None)
        .filter(EmailVerificationToken.expires_at > now)
        .with_for_update()
        .first()
    )
    if verification is None:
        raise bad_request(
            "That verification link is invalid or has expired.",
            code="invalid_verification_token",
        )

    trader = db.session.get(Trader, verification.trader_id)
    if trader is None:
        raise bad_request(
            "That verification link is invalid or has expired.",
            code="invalid_verification_token",
        )
    existing = (
        db.session.query(Trader.id)
        .filter(
            func.lower(Trader.email) == verification.email,
            Trader.id != trader.id,
        )
        .first()
    )
    if existing:
        raise conflict(
            "That email is already linked to another account.",
            code="email_taken",
        )

    verification.used_at = now
    trader.email = verification.email
    trader.email_verified = True
    db.session.query(EmailVerificationToken).filter(
        EmailVerificationToken.trader_id == trader.id,
        EmailVerificationToken.used_at.is_(None),
    ).update({"used_at": now}, synchronize_session=False)
    db.session.commit()
    return jsonify({"message": "Your recovery email is verified."})


@bp.post("/password-reset/confirm")
def confirm_password_reset():
    data = request.get_json(silent=True) or {}
    require_fields(data, "token", "password")
    token = data.get("token")
    if not isinstance(token, str) or len(token) > 256:
        raise bad_request(
            "That reset link is invalid or has expired.",
            code="invalid_reset_token",
        )
    password = validate_password(data.get("password"))

    allowed, retry_after = _password_reset_confirm_limiter.allow(
        str(request.remote_addr)
    )
    if not allowed:
        raise ApiError(
            429,
            f"Too many reset attempts. Try again in {retry_after} seconds.",
            code="rate_limited",
        )

    now = utcnow()
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    reset = (
        PasswordResetToken.query.filter_by(token_hash=token_hash, used_at=None)
        .filter(PasswordResetToken.expires_at > now)
        .with_for_update()
        .first()
    )
    if reset is None:
        raise bad_request(
            "That reset link is invalid or has expired.",
            code="invalid_reset_token",
        )

    trader = db.session.get(Trader, reset.trader_id)
    if trader is None:
        raise bad_request(
            "That reset link is invalid or has expired.",
            code="invalid_reset_token",
        )

    reset.used_at = now
    trader.password_hash = generate_password_hash(password)
    db.session.query(PasswordResetToken).filter(
        PasswordResetToken.trader_id == trader.id,
        PasswordResetToken.used_at.is_(None),
    ).update({"used_at": now}, synchronize_session=False)
    db.session.commit()
    return jsonify({"message": "Your password has been reset. You can now log in."})


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
