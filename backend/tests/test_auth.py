"""Authentication: registration, login, protected routes, isolation."""

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
