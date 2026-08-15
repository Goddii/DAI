"""Health and readiness endpoints."""

from types import SimpleNamespace

from sqlalchemy.exc import OperationalError

from app.extensions import db


def test_health_is_live(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.get_json() == {"status": "ok"}


def test_ready_when_database_reachable(client):
    resp = client.get("/api/ready")
    assert resp.status_code == 200
    assert resp.get_json() == {"status": "ready"}


def test_ready_returns_503_when_database_unreachable(client, app, monkeypatch):
    def boom(*args, **kwargs):
        raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    monkeypatch.setattr(
        db, "session", SimpleNamespace(execute=boom, remove=lambda: None)
    )
    resp = client.get("/api/ready")
    assert resp.status_code == 503
    # Never leak internal details to the caller.
    assert resp.get_json() == {"status": "not_ready"}