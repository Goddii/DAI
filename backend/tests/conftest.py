"""Shared test fixtures.

Tests run against SQLite in-memory by default — fast, deterministic, and
exercising the same SQLAlchemy code paths as PostgreSQL (constraints
included). Row-level locking (WITH FOR UPDATE) only exists on PostgreSQL, so
the concurrency tests and a full parity run need a real database:

    TEST_DATABASE_URL=postgresql+psycopg2://dai:dai@localhost:5432/dai_test \
        python -m pytest -q

See the README for how to start the local Postgres (docker compose up db).
"""

import os

import pytest

from app import create_app
from app.extensions import db as _db
from config import TestConfig


class _PostgresTestConfig(TestConfig):
    TESTING = True
    APP_ENV = "development"
    SQLALCHEMY_DATABASE_URI = os.environ.get("TEST_DATABASE_URL")
    SECRET_KEY = "test-secret-key-that-is-long-enough-for-hmac-sha256"
    JWT_SECRET_KEY = "test-secret-key-that-is-long-enough-for-hmac-sha256"


def _test_config():
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        return _PostgresTestConfig
    return TestConfig


RUNNING_ON_POSTGRES = os.environ.get("TEST_DATABASE_URL", "").startswith("postgresql")


def pytest_collection_modifyitems(config, items):
    """Concurrency tests need real row locking: skip them on the SQLite run."""
    if not RUNNING_ON_POSTGRES:
        skip = pytest.mark.skip(
            reason="requires PostgreSQL — set TEST_DATABASE_URL to run the parity suite"
        )
        for item in items:
            if "postgres" in item.keywords:
                item.add_marker(skip)


@pytest.fixture()
def app():
    """App with per-request sessions (production-like).

    The app context is NOT held open across requests, so Flask-SQLAlchemy
    removes (and rolls back) the session at the end of each request — exactly
    like production. This catches missing-commit bugs that a shared session
    would mask.

    With TEST_DATABASE_URL set (PostgreSQL), every test still gets a clean
    schema: drop_all/create_all run per test, exactly as with SQLite.
    """
    application = create_app(_test_config())
    with application.app_context():
        _db.drop_all()
        _db.create_all()
    yield application
    with application.app_context():
        _db.session.remove()
        _db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def register_trader(client, name="Demo Trader", phone="0700000000", password="secret123"):
    return client.post(
        "/api/auth/register",
        json={"name": name, "phone": phone, "password": password},
    )


def login(client, phone="0700000000", password="secret123"):
    return client.post("/api/auth/login", json={"phone": phone, "password": password})


@pytest.fixture()
def trader_headers(client):
    """Register + login a trader; return the Authorization header."""
    resp = register_trader(client)
    assert resp.status_code == 201, resp.get_json()
    token = resp.get_json()["token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def second_trader_headers(client):
    """A second, independent trader for isolation tests."""
    resp = register_trader(client, name="Other Trader", phone="0711111111")
    token = resp.get_json()["token"]
    return {"Authorization": f"Bearer {token}"}


def auth(client, headers, method, path, **kwargs):
    return getattr(client, method)(path, headers=headers, **kwargs)


@pytest.fixture()
def make_customer(client, trader_headers):
    """Create a customer and return its JSON payload."""
    def _make(name="Mary Wanjiku", phone=None, notes=None):
        body = {"name": name}
        if phone is not None:
            body["phone"] = phone
        if notes is not None:
            body["notes"] = notes
        resp = client.post("/api/customers", json=body, headers=trader_headers)
        assert resp.status_code == 201, resp.get_json()
        return resp.get_json()

    return _make


@pytest.fixture()
def credit(client, trader_headers):
    def _credit(customer_id, amount_minor, note=None):
        body = {"customer_id": customer_id, "amount_minor": amount_minor}
        if note is not None:
            body["note"] = note
        resp = client.post("/api/ledger/credit", json=body, headers=trader_headers)
        assert resp.status_code == 201, resp.get_json()
        return resp.get_json()

    return _credit


@pytest.fixture()
def payment(client, trader_headers):
    def _payment(customer_id, amount_minor, method=None, note=None):
        body = {"customer_id": customer_id, "amount_minor": amount_minor}
        if method is not None:
            body["payment_method"] = method
        if note is not None:
            body["note"] = note
        resp = client.post("/api/ledger/payment", json=body, headers=trader_headers)
        assert resp.status_code == 201, resp.get_json()
        return resp.get_json()

    return _payment
