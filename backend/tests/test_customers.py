"""Customers: create, update, search, ownership isolation."""


def test_create_customer(client, make_customer):
    data = make_customer(name="Mama Fruits")
    assert data["name"] == "Mama Fruits"
    assert data["balance_minor"] == 0
    assert data["client_uuid"]


def test_create_customer_with_optional_fields(client, make_customer):
    data = make_customer(name="John Kamau", phone="0722111001", notes="Buys sukuma")
    assert data["phone"] == "0722111001"
    assert data["notes"] == "Buys sukuma"


def test_create_customer_rejects_blank_name(client, trader_headers):
    resp = client.post("/api/customers", json={"name": "  "}, headers=trader_headers)
    assert resp.status_code == 400


def test_create_customer_rejects_bad_phone(client, trader_headers):
    resp = client.post(
        "/api/customers", json={"name": "X", "phone": "not-a-phone"}, headers=trader_headers
    )
    assert resp.status_code == 400


def test_list_customers_with_balances(client, trader_headers, make_customer, credit):
    a = make_customer(name="Mary Wanjiku")
    b = make_customer(name="John Kamau")
    credit(a["id"], 85000)
    credit(b["id"], 30000)
    credit(a["id"], 40000)
    payment_body = {"customer_id": a["id"], "amount_minor": 50000}
    client.post("/api/ledger/payment", json=payment_body, headers=trader_headers)

    resp = client.get("/api/customers", headers=trader_headers)
    assert resp.status_code == 200
    data = resp.get_json()
    by_name = {c["name"]: c for c in data["customers"]}
    assert by_name["Mary Wanjiku"]["balance_minor"] == 75000
    assert by_name["John Kamau"]["balance_minor"] == 30000
    assert data["total_owed_minor"] == 105000


def test_search_by_name(client, trader_headers, make_customer):
    make_customer(name="Mary Wanjiku")
    make_customer(name="John Kamau")
    make_customer(name="Mama Fruits")

    resp = client.get("/api/customers?q=mary", headers=trader_headers)
    names = [c["name"] for c in resp.get_json()["customers"]]
    assert names == ["Mary Wanjiku"]

    resp = client.get("/api/customers?q=MAMA", headers=trader_headers)
    names = [c["name"] for c in resp.get_json()["customers"]]
    assert names == ["Mama Fruits"]


def test_search_by_phone(client, trader_headers, make_customer):
    make_customer(name="Mary Wanjiku", phone="0722111001")
    resp = client.get("/api/customers?q=0722111001", headers=trader_headers)
    assert [c["name"] for c in resp.get_json()["customers"]] == ["Mary Wanjiku"]


def test_search_rejects_oversized_query(client, trader_headers):
    resp = client.get("/api/customers?q=" + "x" * 5000, headers=trader_headers)
    assert resp.status_code == 400
    assert resp.get_json()["error"]["code"] == "invalid_search"


def test_get_customer(client, trader_headers, make_customer, credit):
    customer = make_customer()
    credit(customer["id"], 85000)
    resp = client.get(f"/api/customers/{customer['id']}", headers=trader_headers)
    assert resp.status_code == 200
    assert resp.get_json()["balance_minor"] == 85000


def test_get_customer_404_for_other_trader(client, trader_headers, second_trader_headers, make_customer):
    customer = make_customer()
    resp = client.get(f"/api/customers/{customer['id']}", headers=second_trader_headers)
    assert resp.status_code == 404


def test_update_customer(client, trader_headers, make_customer):
    customer = make_customer(name="Old Name")
    resp = client.patch(
        f"/api/customers/{customer['id']}",
        json={"name": "New Name", "notes": "Updated note"},
        headers=trader_headers,
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["name"] == "New Name"
    assert data["notes"] == "Updated note"


def test_cannot_update_other_traders_customer(client, trader_headers, second_trader_headers, make_customer):
    customer = make_customer()
    resp = client.patch(
        f"/api/customers/{customer['id']}",
        json={"name": "Hacked"},
        headers=second_trader_headers,
    )
    assert resp.status_code == 404


def test_customer_ledger_history(client, trader_headers, make_customer, credit, payment):
    customer = make_customer(name="Mary Wanjiku")
    credit(customer["id"], 85000, note="Tomatoes + onions")
    credit(customer["id"], 40000, note="Vegetables")
    payment(customer["id"], 50000, method="MPESA")

    resp = client.get(f"/api/customers/{customer['id']}/ledger", headers=trader_headers)
    data = resp.get_json()
    assert data["balance_minor"] == 75000
    assert len(data["entries"]) == 3
    # Newest first
    assert data["entries"][0]["type"] == "PAYMENT"
    assert data["entries"][2]["type"] == "CREDIT"
    assert data["entries"][2]["note"] == "Tomatoes + onions"
