"""Amount validation hardening.

Money is integer minor units and nothing else: floats, decimals, booleans
and malformed values are rejected — never truncated or coerced. Malformed
references (customer_id, pagination) must produce a clean 400, not a 500.
"""

import pytest


@pytest.mark.parametrize(
    "bad",
    [
        12.5,  # fractional minor units must not truncate to 12
        "12.5",
        "1e3",
        0,
        -1,
        -500,
        "abc",
        [],
        {},
        True,
        False,
        None,
        100_000_000_001,  # above the max
    ],
)
def test_credit_rejects_every_non_integer_amount(client, trader_headers, make_customer, bad):
    customer = make_customer()
    resp = client.post(
        "/api/ledger/credit",
        json={"customer_id": customer["id"], "amount_minor": bad},
        headers=trader_headers,
    )
    assert resp.status_code == 400, f"amount {bad!r} should be rejected"
    assert resp.get_json()["error"]["code"] == "invalid_amount"


@pytest.mark.parametrize("bad", [12.5, "12.5", 0, -1, "abc", True, None, []])
def test_payment_rejects_every_non_integer_amount(client, trader_headers, make_customer, credit, bad):
    customer = make_customer()
    credit(customer["id"], 100000)
    resp = client.post(
        "/api/ledger/payment",
        json={"customer_id": customer["id"], "amount_minor": bad},
        headers=trader_headers,
    )
    assert resp.status_code == 400, f"amount {bad!r} should be rejected"


@pytest.mark.parametrize("good", [1, 100, "100", 999999999])
def test_credit_accepts_whole_number_amounts(client, trader_headers, make_customer, good):
    customer = make_customer()
    resp = client.post(
        "/api/ledger/credit",
        json={"customer_id": customer["id"], "amount_minor": good},
        headers=trader_headers,
    )
    assert resp.status_code == 201, f"amount {good!r} should be accepted"


def test_float_amount_is_never_truncated(client, trader_headers, make_customer):
    """12.5 must be rejected — a silent 12.0 would lose KSh 0.50."""
    customer = make_customer()
    resp = client.post(
        "/api/ledger/credit",
        json={"customer_id": customer["id"], "amount_minor": 12.5},
        headers=trader_headers,
    )
    assert resp.status_code == 400
    ledger = client.get(
        f"/api/customers/{customer['id']}/ledger", headers=trader_headers
    ).get_json()
    assert ledger["entries"] == []
    assert ledger["balance_minor"] == 0


def test_sync_rejects_float_amount_per_op(client, trader_headers):
    from uuid import uuid4

    customer_uuid = str(uuid4())
    credit_uuid = str(uuid4())
    ops = [
        {"op": "create_customer", "client_uuid": customer_uuid, "name": "Mary Wanjiku"},
        {"op": "credit", "client_uuid": credit_uuid, "customer_client_uuid": customer_uuid, "amount_minor": 85000.5},
    ]
    resp = client.post("/api/sync", json={"operations": ops}, headers=trader_headers)
    results = {r["client_uuid"]: r for r in resp.get_json()["results"]}
    assert results[customer_uuid]["status"] == "ok"
    assert results[credit_uuid]["status"] == "error"
    # The float amount must not have been applied.
    customers = client.get("/api/customers", headers=trader_headers).get_json()["customers"]
    assert customers[0]["balance_minor"] == 0


@pytest.mark.parametrize("bad", ["abc", 1.5, True, [], {}])
def test_malformed_customer_id_is_400_not_500(client, trader_headers, bad):
    resp = client.post(
        "/api/ledger/credit",
        json={"customer_id": bad, "amount_minor": 10000},
        headers=trader_headers,
    )
    assert resp.status_code == 400, f"customer_id {bad!r} must be a clean 400"
    assert resp.get_json()["error"]["code"] == "invalid_customer_id"


@pytest.mark.parametrize("bad", ["abc", "1.5", ""])
def test_malformed_pagination_is_400_not_500(client, trader_headers, make_customer, credit, bad):
    customer = make_customer()
    credit(customer["id"], 10000)
    resp = client.get(
        f"/api/customers/{customer['id']}/ledger?limit={bad}", headers=trader_headers
    )
    assert resp.status_code == 400, f"limit={bad!r} must be a clean 400"
    resp = client.get(
        f"/api/customers/{customer['id']}/ledger?offset={bad}", headers=trader_headers
    )
    assert resp.status_code == 400, f"offset={bad!r} must be a clean 400"


def test_pagination_clamps_out_of_range_values(client, trader_headers, make_customer, credit):
    customer = make_customer()
    credit(customer["id"], 10000)
    resp = client.get(
        f"/api/customers/{customer['id']}/ledger?limit=-2&offset=-5",
        headers=trader_headers,
    )
    assert resp.status_code == 200
    resp = client.get(
        f"/api/customers/{customer['id']}/ledger?limit=9999",
        headers=trader_headers,
    )
    assert resp.status_code == 200
    assert len(resp.get_json()["entries"]) == 1