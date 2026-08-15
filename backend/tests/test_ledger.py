"""Ledger: credit, payment, partial/full payment, zero balance, void."""


def test_record_credit(client, trader_headers, make_customer, credit):
    customer = make_customer(name="Mary Wanjiku")
    data = credit(customer["id"], 85000, note="Tomatoes + onions")
    assert data["entry"]["type"] == "CREDIT"
    assert data["entry"]["amount_minor"] == 85000
    assert data["entry"]["note"] == "Tomatoes + onions"
    assert data["entry"]["voided"] is False
    assert data["balance_minor"] == 85000


def test_record_credit_rejects_zero_or_negative(client, trader_headers, make_customer):
    customer = make_customer()
    for amount in (0, -500, "abc"):
        resp = client.post(
            "/api/ledger/credit",
            json={"customer_id": customer["id"], "amount_minor": amount},
            headers=trader_headers,
        )
        assert resp.status_code == 400, f"amount {amount} should be rejected"


def test_record_credit_requires_own_customer(client, trader_headers, second_trader_headers, make_customer):
    customer = make_customer()
    resp = client.post(
        "/api/ledger/credit",
        json={"customer_id": customer["id"], "amount_minor": 10000},
        headers=second_trader_headers,
    )
    assert resp.status_code == 404


def test_partial_payment(client, trader_headers, make_customer, credit, payment):
    customer = make_customer(name="Mary Wanjiku")
    credit(customer["id"], 500000)  # KSh 5,000
    data = payment(customer["id"], 200000, method="CASH")  # KSh 2,000
    assert data["balance_minor"] == 300000
    assert data["entry"]["payment_method"] == "CASH"


def test_full_payment_settles_to_zero(client, trader_headers, make_customer, credit, payment):
    customer = make_customer(name="Mary Wanjiku")
    credit(customer["id"], 85000)
    data = payment(customer["id"], 85000, method="MPESA")
    assert data["balance_minor"] == 0
    # Customer is still there (not deleted)
    resp = client.get(f"/api/customers/{customer['id']}", headers=trader_headers)
    assert resp.status_code == 200
    assert resp.get_json()["balance_minor"] == 0


def test_multiple_credits_accumulate(client, trader_headers, make_customer, credit):
    customer = make_customer(name="Mary Wanjiku")
    credit(customer["id"], 85000)
    credit(customer["id"], 40000)
    resp = client.get(f"/api/customers/{customer['id']}", headers=trader_headers)
    assert resp.get_json()["balance_minor"] == 125000


def test_payment_rejected_when_nothing_owed(client, trader_headers, make_customer):
    customer = make_customer(name="John")
    resp = client.post(
        "/api/ledger/payment",
        json={"customer_id": customer["id"], "amount_minor": 50000},
        headers=trader_headers,
    )
    assert resp.status_code == 400
    assert "doesn't owe anything" in resp.get_json()["error"]["message"]


def test_payment_rejected_when_exceeds_balance(client, trader_headers, make_customer, credit):
    customer = make_customer(name="Mary Wanjiku")
    credit(customer["id"], 85000)
    resp = client.post(
        "/api/ledger/payment",
        json={"customer_id": customer["id"], "amount_minor": 100000},
        headers=trader_headers,
    )
    assert resp.status_code == 400
    error = resp.get_json()["error"]
    assert error["code"] == "payment_exceeds_balance"
    assert error["details"]["balance_minor"] == 85000


def test_payment_method_validated(client, trader_headers, make_customer, credit):
    customer = make_customer()
    credit(customer["id"], 100000)
    resp = client.post(
        "/api/ledger/payment",
        json={"customer_id": customer["id"], "amount_minor": 10000, "payment_method": "BITCOIN"},
        headers=trader_headers,
    )
    assert resp.status_code == 400


def test_void_credit_reverses_balance(client, trader_headers, make_customer, credit):
    customer = make_customer(name="Mary Wanjiku")
    credit(customer["id"], 85000)
    credit(customer["id"], 40000)
    resp = client.get(f"/api/customers/{customer['id']}/ledger", headers=trader_headers)
    entries = resp.get_json()["entries"]
    first_credit = [e for e in entries if e["note"] is None][0]

    resp = client.post(
        f"/api/ledger/{first_credit['id']}/void",
        json={"reason": "Recorded twice by mistake"},
        headers=trader_headers,
    )
    assert resp.status_code == 200
    assert resp.get_json()["balance_minor"] == 85000

    # Entry still exists in history, marked voided
    resp = client.get(f"/api/customers/{customer['id']}/ledger", headers=trader_headers)
    entry = [e for e in resp.get_json()["entries"] if e["id"] == first_credit["id"]][0]
    assert entry["voided"] is True
    assert entry["void_reason"] == "Recorded twice by mistake"


def test_void_payment_reverses_balance(client, trader_headers, make_customer, credit, payment):
    customer = make_customer()
    credit(customer["id"], 500000)
    payment(customer["id"], 200000)
    resp = client.get(f"/api/customers/{customer['id']}/ledger", headers=trader_headers)
    payment_entry = [e for e in resp.get_json()["entries"] if e["type"] == "PAYMENT"][0]

    resp = client.post(f"/api/ledger/{payment_entry['id']}/void", json={}, headers=trader_headers)
    assert resp.status_code == 200
    assert resp.get_json()["balance_minor"] == 500000


def test_void_unknown_entry(client, trader_headers):
    resp = client.post("/api/ledger/999999/void", json={}, headers=trader_headers)
    assert resp.status_code == 404


def test_void_other_traders_entry(client, trader_headers, second_trader_headers, make_customer, credit):
    customer = make_customer()
    credit(customer["id"], 85000)
    resp = client.get(f"/api/customers/{customer['id']}/ledger", headers=trader_headers)
    entry_id = resp.get_json()["entries"][0]["id"]

    resp = client.post(f"/api/ledger/{entry_id}/void", json={}, headers=second_trader_headers)
    assert resp.status_code == 404


def test_cannot_void_twice(client, trader_headers, make_customer, credit):
    customer = make_customer()
    credit(customer["id"], 85000)
    resp = client.get(f"/api/customers/{customer['id']}/ledger", headers=trader_headers)
    entry_id = resp.get_json()["entries"][0]["id"]
    client.post(f"/api/ledger/{entry_id}/void", json={}, headers=trader_headers)
    resp = client.post(f"/api/ledger/{entry_id}/void", json={}, headers=trader_headers)
    assert resp.status_code == 400
    assert resp.get_json()["error"]["code"] == "already_voided"


def test_customer_with_voided_entries_can_be_paid_again(client, trader_headers, make_customer, credit, payment):
    """After voiding a payment, the balance returns and can be paid again."""
    customer = make_customer()
    credit(customer["id"], 100000)
    data = payment(customer["id"], 100000)  # settled
    resp = client.get(f"/api/customers/{customer['id']}/ledger", headers=trader_headers)
    payment_entry = [e for e in resp.get_json()["entries"] if e["type"] == "PAYMENT"][0]
    client.post(f"/api/ledger/{payment_entry['id']}/void", json={}, headers=trader_headers)

    # Balance restored → payment again allowed
    data = payment(customer["id"], 100000)
    assert data["balance_minor"] == 0
