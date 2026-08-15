"""Product-level acceptance scenario (spec §39).

Trader creates Mary Wanjiku, records credits and a payment, sees the exact
balances, history shows every transaction, the balance survives a
"close/reopen", and an offline-recorded credit syncs exactly once.

This is the most important test in the suite: it proves the core promise —
"who owes me money, and how much" — end to end through the API.
"""

import uuid

from tests.conftest import register_trader


def test_full_acceptance_scenario(client):
    # --- Trader signs up -------------------------------------------------
    resp = register_trader(client)
    assert resp.status_code == 201
    headers = {"Authorization": f"Bearer {resp.get_json()['token']}"}

    # --- 1. Create Mary Wanjiku ------------------------------------------
    resp = client.post("/api/customers", json={"name": "Mary Wanjiku"}, headers=headers)
    assert resp.status_code == 201
    mary = resp.get_json()
    mary_id = mary["id"]
    assert mary["balance_minor"] == 0

    # --- 2. Record KSh 850 credit ----------------------------------------
    resp = client.post(
        "/api/ledger/credit",
        json={"customer_id": mary_id, "amount_minor": 85000, "note": "Tomatoes + onions"},
        headers=headers,
    )
    assert resp.get_json()["balance_minor"] == 85000

    # --- 3. Record KSh 400 credit ----------------------------------------
    resp = client.post(
        "/api/ledger/credit",
        json={"customer_id": mary_id, "amount_minor": 40000, "note": "Vegetables"},
        headers=headers,
    )
    assert resp.get_json()["balance_minor"] == 125000

    # --- 4. Record KSh 500 payment via M-Pesa -----------------------------
    resp = client.post(
        "/api/ledger/payment",
        json={"customer_id": mary_id, "amount_minor": 50000, "payment_method": "MPESA"},
        headers=headers,
    )
    assert resp.get_json()["balance_minor"] == 75000

    # --- 5. History shows all three transactions --------------------------
    resp = client.get(f"/api/customers/{mary_id}/ledger", headers=headers)
    data = resp.get_json()
    assert data["balance_minor"] == 75000
    assert len(data["entries"]) == 3
    types = {e["type"] for e in data["entries"]}
    assert types == {"CREDIT", "PAYMENT"}
    payment_entry = [e for e in data["entries"] if e["type"] == "PAYMENT"][0]
    assert payment_entry["payment_method"] == "MPESA"

    # --- 6. Close/reopen: balance remains correct -------------------------
    # A brand-new request (fresh session) still derives the same balance.
    resp = client.get(f"/api/customers/{mary_id}", headers=headers)
    assert resp.get_json()["balance_minor"] == 75000
    dash = client.get("/api/dashboard/summary", headers=headers).get_json()
    assert dash["total_owed_minor"] == 75000
    assert dash["customers_owing"] == 1

    # --- 7. "Offline": record KSh 250 credit with a client UUID -----------
    offline_credit_uuid = str(uuid.uuid4())
    ops = [
        {
            "op": "credit",
            "client_uuid": offline_credit_uuid,
            # The client references the customer by its known server id via the
            # API path in real life; here we prove the sync path with the
            # customer's client_uuid (as a fully-offline client would).
            "customer_client_uuid": mary["client_uuid"],
            "amount_minor": 25000,
            "note": "Offline sale",
        }
    ]
    # --- 8. Restore network: sync exactly once ----------------------------
    resp = client.post("/api/sync", json={"operations": ops}, headers=headers)
    results = resp.get_json()["results"]
    assert results[0]["status"] == "ok"
    assert results[0]["balance_minor"] == 100000

    # Retry (network hiccup / duplicate request): must NOT double-post
    resp = client.post("/api/sync", json={"operations": ops}, headers=headers)
    assert resp.get_json()["results"][0]["duplicate"] is True

    # --- 9. Final balance: KSh 1,000 --------------------------------------
    resp = client.get(f"/api/customers/{mary_id}", headers=headers)
    assert resp.get_json()["balance_minor"] == 100000

    # History: exactly 4 entries (3 + the synced offline credit), no dupes
    resp = client.get(f"/api/customers/{mary_id}/ledger", headers=headers)
    entries = resp.get_json()["entries"]
    assert len(entries) == 4
    assert sum(1 for e in entries if e["client_uuid"] == offline_credit_uuid) == 1
