"""CORS behavior: only configured origins, credentialed, cache-safe."""


def test_allowed_origin_gets_echoed_headers(client):
    resp = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert resp.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert resp.headers["Access-Control-Allow-Credentials"] == "true"
    assert resp.headers.get("Vary") == "Origin"


def test_disallowed_origin_gets_no_cors_headers(client):
    resp = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "Access-Control-Allow-Origin" not in resp.headers


def test_no_origin_gets_no_cors_headers(client):
    resp = client.get("/api/health")
    assert "Access-Control-Allow-Origin" not in resp.headers


def test_preflight_for_allowed_origin(client):
    resp = client.options(
        "/api/customers",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert resp.status_code == 204
    assert resp.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert "PATCH" in resp.headers["Access-Control-Allow-Methods"]
    assert "Authorization" in resp.headers["Access-Control-Allow-Headers"]


def test_preflight_for_disallowed_origin_is_refused(client):
    resp = client.options(
        "/api/customers",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert resp.status_code == 204
    assert "Access-Control-Allow-Origin" not in resp.headers