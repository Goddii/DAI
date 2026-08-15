"""Balance calculations — exactness of derived balances.

All amounts are integer minor units (cents). The reference scenario from the
spec: credit 850 + credit 400 − payment 500 = 750.
"""

from tests.conftest import login, register_trader


def _setup(client, trader_headers, make_customer, credit, payment):
    customer = make_customer(name="Mary Wanjiku")
    credit(customer["id"], 85000)
    credit(customer["id"], 40000)
    payment(customer["id"], 50000, method="MPESA")
    return customer


def test_reference_scenario_balance_is_exact(client, trader_headers, make_customer, credit, payment):
    customer = _setup(client, trader_headers, make_customer, credit, payment)
    resp = client.get(f"/api/customers/{customer['id']}", headers=trader_headers)
    assert resp.get_json()["balance_minor"] == 75000


def test_reference_scenario_dashboard(client, trader_headers, make_customer, credit, payment):
    _setup(client, trader_headers, make_customer, credit, payment)
    resp = client.get("/api/dashboard/summary", headers=trader_headers)
    data = resp.get_json()
    assert data["total_owed_minor"] == 75000
    assert data["customers_owing"] == 1
    assert data["total_customers"] == 1
    assert data["top_customers"][0]["name"] == "Mary Wanjiku"
    assert data["top_customers"][0]["balance_minor"] == 75000


def test_dashboard_counts_only_owing_customers(client, trader_headers, make_customer, credit, payment):
    mary = make_customer(name="Mary Wanjiku")
    john = make_customer(name="John Kamau")
    paid = make_customer(name="Paid Up")
    credit(mary["id"], 200000)
    credit(john["id"], 50000)
    credit(paid["id"], 100000)
    payment(paid["id"], 100000)  # settles to zero

    resp = client.get("/api/dashboard/summary", headers=trader_headers)
    data = resp.get_json()
    assert data["total_owed_minor"] == 250000
    assert data["customers_owing"] == 2
    assert data["total_customers"] == 3
    assert data["top_customers"][0]["name"] == "Mary Wanjiku"


def test_balance_with_voided_entries(client, trader_headers, make_customer, credit, payment):
    customer = make_customer()
    credit(customer["id"], 100000)
    credit(customer["id"], 50000)
    data = payment(customer["id"], 30000)
    assert data["balance_minor"] == 120000

    # Void the first credit (KSh 1,000)
    resp = client.get(f"/api/customers/{customer['id']}/ledger", headers=trader_headers)
    first_credit = [e for e in resp.get_json()["entries"] if e["type"] == "CREDIT"][-1]
    client.post(f"/api/ledger/{first_credit['id']}/void", json={}, headers=trader_headers)

    resp = client.get(f"/api/customers/{customer['id']}", headers=trader_headers)
    assert resp.get_json()["balance_minor"] == 20000  # 1000 + 500 - 300 - 1000(voided)


def test_large_amounts_exact(client, trader_headers, make_customer, credit, payment):
    """No float drift: large totals must be exact integers."""
    customer = make_customer()
    credit(customer["id"], 123456789)
    credit(customer["id"], 987654321)
    # 123456789 + 987654321 = 1,111,111,110; - 111,111,111 = 999,999,999
    data = payment(customer["id"], 111111111)
    assert data["balance_minor"] == 999999999
    resp = client.get(f"/api/customers/{customer['id']}", headers=trader_headers)
    assert resp.get_json()["balance_minor"] == 999999999
