"""Offline sync: idempotency, retries, partial sync, multiple pending ops."""

import uuid

from tests.conftest import register_trader


def _u():
    return str(uuid.uuid4())


def test_sync_create_customer_and_credit(client, trader_headers):
    customer_uuid = _u()
    credit_uuid = _u()
    ops = [
        {"op": "create_customer", "client_uuid": customer_uuid, "name": "Mary Wanjiku", "phone": "0722111001"},
        {"op": "credit", "client_uuid": credit_uuid, "customer_client_uuid": customer_uuid, "amount_minor": 85000, "note": "Tomatoes + onions"},
    ]
    resp = client.post("/api/sync", json={"operations": ops}, headers=trader_headers)
    assert resp.status_code == 200
    results = {r["client_uuid"]: r for r in resp.get_json()["results"]}
    assert results[customer_uuid]["status"] == "ok"
    assert results[credit_uuid]["status"] == "ok"
    assert results[credit_uuid]["balance_minor"] == 85000

    # Verify via the normal API
    list_resp = client.get("/api/customers?q=mary", headers=trader_headers)
    customers = list_resp.get_json()["customers"]
    assert len(customers) == 1
    assert customers[0]["balance_minor"] == 85000


def test_sync_is_idempotent_on_duplicate_batch(client, trader_headers):
    """Re-sending the exact same operations must NOT create duplicates."""
    customer_uuid = _u()
    credit_uuid = _u()
    ops = [
        {"op": "create_customer", "client_uuid": customer_uuid, "name": "John Kamau"},
        {"op": "credit", "client_uuid": credit_uuid, "customer_client_uuid": customer_uuid, "amount_minor": 30000},
    ]
    for _ in range(2):
        resp = client.post("/api/sync", json={"operations": ops}, headers=trader_headers)
        assert resp.status_code == 200

    list_resp = client.get("/api/customers", headers=trader_headers)
    customers = list_resp.get_json()["customers"]
    assert len(customers) == 1
    assert customers[0]["balance_minor"] == 30000

    ledger_resp = client.get(f"/api/customers/{customers[0]['id']}/ledger", headers=trader_headers)
    assert len(ledger_resp.get_json()["entries"]) == 1


def test_sync_retry_after_interrupted_batch(client, trader_headers):
    """A failed op in the middle doesn't break later ops (partial sync)."""
    customer_uuid = _u()
    credit_uuid = _u()
    bad_uuid = _u()
    ops = [
        # Unknown op type → error, but the rest must still apply
        {"op": "teleport", "client_uuid": bad_uuid},
        {"op": "create_customer", "client_uuid": customer_uuid, "name": "Peter Otieno"},
        {"op": "credit", "client_uuid": credit_uuid, "customer_client_uuid": customer_uuid, "amount_minor": 245000},
    ]
    resp = client.post("/api/sync", json={"operations": ops}, headers=trader_headers)
    results = {r["client_uuid"]: r for r in resp.get_json()["results"]}
    assert results[bad_uuid]["status"] == "error"
    assert results[customer_uuid]["status"] == "ok"
    assert results[credit_uuid]["status"] == "ok"

    list_resp = client.get("/api/customers", headers=trader_headers)
    assert len(list_resp.get_json()["customers"]) == 1


def test_sync_payment_that_exceeds_balance_reported_per_op(client, trader_headers):
    """Server-side balance guard during sync rejects overpayment, per-op."""
    customer_uuid = _u()
    ops = [
        {"op": "create_customer", "client_uuid": customer_uuid, "name": "Mary Wanjiku"},
        {"op": "credit", "client_uuid": _u(), "customer_client_uuid": customer_uuid, "amount_minor": 85000},
        {"op": "payment", "client_uuid": _u(), "customer_client_uuid": customer_uuid, "amount_minor": 500000, "payment_method": "MPESA"},
    ]
    resp = client.post("/api/sync", json={"operations": ops}, headers=trader_headers)
    results = resp.get_json()["results"]
    assert results[0]["status"] == "ok"
    assert results[1]["status"] == "ok"
    assert results[2]["status"] == "error"
    assert "more than what's owed" in results[2]["message"]


def test_sync_multiple_pending_operations(client, trader_headers):
    """A full offline session: two customers, several credits, partial payment."""
    customer_uuid_a = _u()
    customer_uuid_b = _u()
    ops = [
        {"op": "create_customer", "client_uuid": customer_uuid_a, "name": "Mary Wanjiku"},
        {"op": "create_customer", "client_uuid": customer_uuid_b, "name": "John Kamau"},
        {"op": "credit", "client_uuid": _u(), "customer_client_uuid": customer_uuid_a, "amount_minor": 85000},
        {"op": "credit", "client_uuid": _u(), "customer_client_uuid": customer_uuid_a, "amount_minor": 40000},
        {"op": "credit", "client_uuid": _u(), "customer_client_uuid": customer_uuid_b, "amount_minor": 80000},
        {"op": "payment", "client_uuid": _u(), "customer_client_uuid": customer_uuid_a, "amount_minor": 50000, "payment_method": "MPESA"},
    ]
    resp = client.post("/api/sync", json={"operations": ops}, headers=trader_headers)
    results = resp.get_json()["results"]
    assert all(r["status"] == "ok" for r in results)

    dash = client.get("/api/dashboard/summary", headers=trader_headers).get_json()
    assert dash["total_owed_minor"] == 155000  # 750 + 800
    assert dash["customers_owing"] == 2


def test_sync_void_offline_entry(client, trader_headers):
    customer_uuid = _u()
    credit_uuid = _u()
    void_uuid = _u()
    ops = [
        {"op": "create_customer", "client_uuid": customer_uuid, "name": "Mary Wanjiku"},
        {"op": "credit", "client_uuid": credit_uuid, "customer_client_uuid": customer_uuid, "amount_minor": 85000},
    ]
    client.post("/api/sync", json={"operations": ops}, headers=trader_headers)

    # Trader voids the credit while offline, then syncs the void op
    ops2 = [{"op": "void", "client_uuid": void_uuid, "entry_client_uuid": credit_uuid, "reason": "Wrong amount"}]
    resp = client.post("/api/sync", json={"operations": ops2}, headers=trader_headers)
    results = resp.get_json()["results"]
    assert results[0]["status"] == "ok"
    assert results[0]["balance_minor"] == 0

    # Idempotent: voiding again is fine (already voided → duplicate ok)
    resp = client.post("/api/sync", json={"operations": ops2}, headers=trader_headers)
    assert resp.get_json()["results"][0]["status"] == "ok"
    assert resp.get_json()["results"][0]["duplicate"] is True


def test_sync_missing_customer_reference_fails(client, trader_headers):
    resp = client.post(
        "/api/sync",
        json={"operations": [{"op": "credit", "client_uuid": _u(), "customer_client_uuid": _u(), "amount_minor": 10000}]},
        headers=trader_headers,
    )
    results = resp.get_json()["results"]
    assert results[0]["status"] == "error"
    assert "hasn't been saved yet" in results[0]["message"]


def test_sync_requires_auth(client):
    resp = client.post("/api/sync", json={"operations": []})
    assert resp.status_code == 401


def test_sync_isolation_between_traders(client, trader_headers, second_trader_headers):
    """Trader A's synced data must be invisible to Trader B."""
    customer_uuid = _u()
    client.post(
        "/api/sync",
        json={"operations": [{"op": "create_customer", "client_uuid": customer_uuid, "name": "Mary Wanjiku"}]},
        headers=trader_headers,
    )
    resp = client.get("/api/customers", headers=second_trader_headers)
    assert resp.get_json()["customers"] == []


def test_sync_rejects_non_list(client, trader_headers):
    resp = client.post("/api/sync", json={"operations": "nope"}, headers=trader_headers)
    assert resp.status_code == 400
