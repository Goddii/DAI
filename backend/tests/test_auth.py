"""Authentication: registration, login, protected routes, isolation."""

from datetime import timedelta
from urllib.parse import parse_qs, urlparse

from app.extensions import db
from app.models import EmailVerificationToken, PasswordResetToken, Trader, utcnow
from tests.conftest import login, register_trader


def test_register_creates_trader_and_token(client):
    resp = register_trader(client)
    assert resp.status_code == 201
    data = resp.get_json()
    assert data["token"]
    assert data["trader"]["phone"] == "0700000000"
    assert data["trader"]["name"] == "Demo Trader"
    assert "password" not in data["trader"]
    assert "password_hash" not in data["trader"]


def test_register_accepts_normalized_optional_email(client):
    resp = client.post(
        "/api/auth/register",
        json={
            "name": "Email Trader",
            "phone": "0700000002",
            "password": "secret123",
            "email": "  Trader@Example.COM ",
        },
    )
    assert resp.status_code == 201
    assert resp.get_json()["trader"]["email"] == "trader@example.com"
    assert resp.get_json()["trader"]["email_verified"] is False


def test_register_rejects_invalid_email(client):
    resp = client.post(
        "/api/auth/register",
        json={
            "name": "Email Trader",
            "phone": "0700000002",
            "password": "secret123",
            "email": "not-an-email",
        },
    )
    assert resp.status_code == 400
    assert resp.get_json()["error"]["code"] == "invalid_email"


def test_register_rejects_duplicate_email_case_insensitively(client):
    payload = {
        "name": "Email Trader",
        "phone": "0700000002",
        "password": "secret123",
        "email": "trader@example.com",
    }
    assert client.post("/api/auth/register", json=payload).status_code == 201
    payload.update(phone="0700000003", email="TRADER@example.com")
    assert client.post("/api/auth/register", json=payload).status_code == 409


def test_register_requires_fields(client):
    resp = client.post("/api/auth/register", json={"name": "X"})
    assert resp.status_code == 400
    assert "phone" in resp.get_json()["error"]["details"]["fields"]


def test_register_rejects_duplicate_phone(client):
    assert register_trader(client).status_code == 201
    resp = register_trader(client)
    assert resp.status_code == 409


def test_register_rejects_short_password(client):
    resp = client.post(
        "/api/auth/register",
        json={"name": "X", "phone": "0700000000", "password": "123"},
    )
    assert resp.status_code == 400


def test_register_normalizes_phone(client):
    resp = client.post(
        "/api/auth/register",
        json={"name": "X", "phone": " 0722 123-456 ", "password": "secret123"},
    )
    assert resp.status_code == 201
    assert resp.get_json()["trader"]["phone"] == "0722123456"


def test_login_success(client):
    register_trader(client)
    resp = login(client)
    assert resp.status_code == 200
    assert resp.get_json()["token"]


def test_login_wrong_password(client):
    register_trader(client)
    resp = login(client, password="wrong-password")
    assert resp.status_code == 401
    assert "wrong phone number or password" in resp.get_json()["error"]["message"].lower()


def test_login_unknown_phone(client):
    resp = login(client, phone="0799999999")
    assert resp.status_code == 401


def test_login_rate_limited(client):
    register_trader(client)
    for _ in range(1000):
        resp = login(client, password="wrong")
        if resp.status_code == 429:
            break
    assert resp.status_code == 429
    assert "try again" in resp.get_json()["error"]["message"].lower()


def test_protected_route_requires_token(client):
    resp = client.get("/api/dashboard/summary")
    assert resp.status_code == 401


def test_protected_route_rejects_garbage_token(client):
    resp = client.get("/api/dashboard/summary", headers={"Authorization": "Bearer not-a-token"})
    assert resp.status_code == 401


def test_me_returns_trader(client, trader_headers):
    resp = client.get("/api/auth/me", headers=trader_headers)
    assert resp.status_code == 200
    assert resp.get_json()["trader"]["phone"] == "0700000000"


def test_logout_returns_204(client, trader_headers):
    resp = client.post("/api/auth/logout", headers=trader_headers)
    assert resp.status_code == 204


def test_password_reset_request_is_generic_for_unknown_email(client):
    client.application.config.update(
        SMTP_HOST="smtp.example.com",
        SMTP_FROM="Dai <no-reply@example.com>",
    )
    resp = client.post(
        "/api/auth/password-reset/request",
        json={"email": "unknown@example.com"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["message"] == (
        "If an account exists for that email, a password reset link will be sent."
    )


def test_password_reset_does_not_use_unverified_email(client, monkeypatch):
    client.application.config.update(
        SMTP_HOST="smtp.example.com",
        SMTP_FROM="Dai <no-reply@example.com>",
    )
    client.post(
        "/api/auth/register",
        json={
            "name": "Unverified Trader",
            "phone": "0799999907",
            "password": "old-password",
            "email": "unverified@example.com",
        },
    )
    sent = []
    monkeypatch.setattr(
        "app.blueprints.auth_bp.send_password_reset_email",
        lambda *_args: sent.append(True),
    )
    resp = client.post(
        "/api/auth/password-reset/request",
        json={"email": "unverified@example.com"},
    )
    assert resp.status_code == 200
    assert sent == []
    with client.application.app_context():
        assert PasswordResetToken.query.count() == 0


def test_password_reset_request_sends_one_time_link(client, monkeypatch):
    client.application.config.update(
        SMTP_HOST="smtp.example.com",
        SMTP_FROM="Dai <no-reply@example.com>",
        FRONTEND_URL="https://dai.example.com",
    )
    client.post(
        "/api/auth/register",
        json={
            "name": "Reset Trader",
            "phone": "0799999902",
            "password": "old-password",
            "email": "reset@example.com",
        },
    )
    with client.application.app_context():
        trader = Trader.query.filter_by(phone="0799999902").one()
        trader.email_verified = True
        db.session.commit()
    sent = {}

    def capture_email(recipient, reset_url):
        sent.update(recipient=recipient, reset_url=reset_url)

    monkeypatch.setattr(
        "app.blueprints.auth_bp.send_password_reset_email", capture_email
    )
    resp = client.post(
        "/api/auth/password-reset/request",
        json={"email": "RESET@example.com"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["message"].startswith("If an account exists")
    assert sent["recipient"] == "reset@example.com"
    query = parse_qs(urlparse(sent["reset_url"]).query)
    assert query["reset_token"]
    token = query["reset_token"][0]
    with client.application.app_context():
        reset_record = PasswordResetToken.query.one()
        assert reset_record.token_hash != token
        assert reset_record.used_at is None

    reset_resp = client.post(
        "/api/auth/password-reset/confirm",
        json={"token": token, "password": "new-password"},
    )
    assert reset_resp.status_code == 200
    assert login(client, phone="0799999902", password="old-password").status_code == 401
    assert login(client, phone="0799999902", password="new-password").status_code == 200

    reused_resp = client.post(
        "/api/auth/password-reset/confirm",
        json={"token": token, "password": "another-password"},
    )
    assert reused_resp.status_code == 400
    assert reused_resp.get_json()["error"]["code"] == "invalid_reset_token"


def test_existing_trader_can_verify_recovery_email(client, monkeypatch):
    registration = client.post(
        "/api/auth/register",
        json={
            "name": "Existing Trader",
            "phone": "0799999905",
            "password": "old-password",
        },
    )
    headers = {
        "Authorization": f"Bearer {registration.get_json()['token']}"
    }
    client.application.config.update(
        SMTP_HOST="smtp.example.com",
        SMTP_FROM="Dai <no-reply@example.com>",
        FRONTEND_URL="https://dai.example.com",
    )
    sent = {}
    monkeypatch.setattr(
        "app.blueprints.auth_bp.send_email_verification_email",
        lambda recipient, verify_url: sent.update(
            recipient=recipient, verify_url=verify_url
        ),
    )

    request_resp = client.post(
        "/api/auth/email-verification/request",
        headers=headers,
        json={"email": "existing@example.com", "password": "old-password"},
    )
    assert request_resp.status_code == 200
    assert sent["recipient"] == "existing@example.com"
    with client.application.app_context():
        trader = Trader.query.filter_by(phone="0799999905").one()
        assert trader.email is None
        assert trader.email_verified is False
    token = parse_qs(urlparse(sent["verify_url"]).query)["verify_email_token"][0]

    verify_resp = client.post(
        "/api/auth/email-verification/confirm",
        json={"token": token},
    )
    assert verify_resp.status_code == 200
    me_resp = client.get("/api/auth/me", headers=headers)
    assert me_resp.get_json()["trader"]["email"] == "existing@example.com"
    assert me_resp.get_json()["trader"]["email_verified"] is True
    with client.application.app_context():
        verification = EmailVerificationToken.query.one()
        assert verification.used_at is not None


def test_recovery_email_verification_requires_current_password(client):
    registration = client.post(
        "/api/auth/register",
        json={
            "name": "Existing Trader",
            "phone": "0799999906",
            "password": "old-password",
        },
    )
    headers = {"Authorization": f"Bearer {registration.get_json()['token']}"}
    resp = client.post(
        "/api/auth/email-verification/request",
        headers=headers,
        json={"email": "existing@example.com", "password": "wrong-password"},
    )
    assert resp.status_code == 401
    assert resp.get_json()["error"]["code"] == "invalid_credentials"


def test_password_reset_mail_failure_revokes_token_without_revealing_email(
    client, monkeypatch, caplog
):
    import logging
    import smtplib

    client.application.config.update(
        SMTP_HOST="smtp.example.com",
        SMTP_FROM="Dai <no-reply@example.com>",
    )
    client.post(
        "/api/auth/register",
        json={
            "name": "Mail Failure Trader",
            "phone": "0799999904",
            "password": "old-password",
            "email": "private-address@example.com",
        },
    )
    with client.application.app_context():
        trader = Trader.query.filter_by(phone="0799999904").one()
        trader.email_verified = True
        db.session.commit()

    def fail_delivery(_recipient, _url):
        raise smtplib.SMTPException("delivery refused")

    monkeypatch.setattr(
        "app.blueprints.auth_bp.send_password_reset_email", fail_delivery
    )
    with caplog.at_level(logging.ERROR):
        resp = client.post(
            "/api/auth/password-reset/request",
            json={"email": "private-address@example.com"},
        )
    assert resp.status_code == 200
    assert "private-address@example.com" not in caplog.text
    with client.application.app_context():
        assert PasswordResetToken.query.one().used_at is not None


def test_password_reset_link_expires(client, monkeypatch):
    client.application.config.update(
        SMTP_HOST="smtp.example.com",
        SMTP_FROM="Dai <no-reply@example.com>",
    )
    client.post(
        "/api/auth/register",
        json={
            "name": "Expired Trader",
            "phone": "0799999903",
            "password": "old-password",
            "email": "expired@example.com",
        },
    )
    with client.application.app_context():
        trader = Trader.query.filter_by(phone="0799999903").one()
        trader.email_verified = True
        db.session.commit()
    sent = {}
    monkeypatch.setattr(
        "app.blueprints.auth_bp.send_password_reset_email",
        lambda _recipient, reset_url: sent.update(reset_url=reset_url),
    )
    client.post(
        "/api/auth/password-reset/request",
        json={"email": "expired@example.com"},
    )
    token = parse_qs(urlparse(sent["reset_url"]).query)["reset_token"][0]
    with client.application.app_context():
        reset = PasswordResetToken.query.one()
        reset.expires_at = utcnow() - timedelta(seconds=1)
        db.session.commit()
    resp = client.post(
        "/api/auth/password-reset/confirm",
        json={"token": token, "password": "new-password"},
    )
    assert resp.status_code == 400
    assert resp.get_json()["error"]["code"] == "invalid_reset_token"


def test_failed_login_is_logged_without_the_password(client, caplog):
    import logging

    # Unique phone: the module-level limiter is shared across tests, so the
    # rate-limit test's bucket for 0700000000 may still be hot.
    register_trader(client, phone="0799999901")
    with caplog.at_level(logging.WARNING):
        resp = login(client, phone="0799999901", password="topsecret-pass")
        assert resp.status_code == 401

    messages = [r.getMessage() for r in caplog.records]
    assert any("Failed login" in m and "0799999901" in m for m in messages)
    assert all("topsecret-pass" not in m for m in messages)


def test_rate_limited_login_is_logged(client, caplog):
    import logging

    register_trader(client)
    with caplog.at_level(logging.WARNING):
        for _ in range(100):
            resp = login(client, password="wrong")
            if resp.status_code == 429:
                break
        assert resp.status_code == 429

    messages = [r.getMessage() for r in caplog.records]
    assert any("Rate-limited login" in m for m in messages)
