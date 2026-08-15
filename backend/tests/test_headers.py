"""Security headers and proxy handling."""


def test_security_headers_on_every_response(client):
    resp = client.get("/api/health")
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert resp.headers["Referrer-Policy"] == "no-referrer"
    assert "camera=()" in resp.headers["Permissions-Policy"]


def test_security_headers_on_errors_too(client):
    resp = client.get("/api/customers")  # 401, but headers still apply
    assert resp.status_code == 401
    assert resp.headers["X-Content-Type-Options"] == "nosniff"


def test_proxy_fix_trusts_single_hop_forwarded_for(client):
    """Behind a proxy the login limiter must key on the real client IP."""
    resp = client.get(
        "/api/health",
        headers={"X-Forwarded-For": "203.0.113.7"},
        environ_base={"REMOTE_ADDR": "10.0.0.5"},
    )
    assert resp.status_code == 200


def test_login_rate_limit_keys_on_forwarded_ip(client, app):
    """Two different X-Forwarded-For IPs must not share a rate-limit bucket."""
    from werkzeug.security import generate_password_hash

    from app.extensions import db
    from app.models import Trader

    with app.app_context():
        trader = Trader(
            name="Limiter",
            phone="0799000001",
            password_hash=generate_password_hash("secret123"),
        )
        db.session.add(trader)
        db.session.commit()

    body = {"phone": "0799000001", "password": "wrong-password"}
    for i in range(10):  # more than the test limit of 5
        resp = client.post(
            "/api/auth/login",
            json=body,
            headers={"X-Forwarded-For": f"203.0.113.{i + 1}"},
        )
    # Exhausting 10 distinct IPs must NOT trip the shared limit.
    assert resp.status_code == 401