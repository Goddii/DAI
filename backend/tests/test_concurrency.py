"""Concurrency invariants (PostgreSQL only).

Row-level locking (WITH FOR UPDATE in _lock_customer) only exists on
PostgreSQL — SQLite serializes whole writes without it. These tests prove
the locking actually protects the ledger:

  7. concurrent payments on one customer can never overpay the balance;
  8. a concurrent credit + payment on one customer always leaves a
     consistent, never-negative balance.

They are skipped by default (SQLite run) and executed by the PostgreSQL
parity run: TEST_DATABASE_URL=... python -m pytest -q
"""

import threading

import pytest

from tests.conftest import RUNNING_ON_POSTGRES

pytestmark = pytest.mark.postgres


def _run_in_threads(client, targets):
    """Start one thread per target at the same moment; return the results."""
    barrier = threading.Barrier(len(targets), timeout=10)
    results = [None] * len(targets)
    errors: list[BaseException] = []

    def worker(i):
        try:
            barrier.wait()
            results[i] = targets[i]()
        except BaseException as exc:  # pragma: no cover - failure reporting
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(len(targets))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert not errors, f"worker threads failed: {errors}"
    return results


def test_concurrent_payments_cannot_overpay(client, trader_headers, make_customer, credit):
    customer = make_customer()
    credit(customer["id"], 100000)  # balance KSh 1,000

    def pay():
        resp = client.post(
            "/api/ledger/payment",
            json={"customer_id": customer["id"], "amount_minor": 80000},
            headers=trader_headers,
        )
        return resp.status_code

    statuses = _run_in_threads(client, [pay, pay])

    # With row locking exactly one payment fits the balance; the other is
    # rejected. Both succeeding (overpayment) is a locking regression.
    assert sorted(statuses) == [201, 400], f"unexpected statuses: {statuses}"

    resp = client.get(f"/api/customers/{customer['id']}/ledger", headers=trader_headers)
    data = resp.get_json()
    payments = [e for e in data["entries"] if e["type"] == "PAYMENT"]
    assert len(payments) == 1
    assert data["balance_minor"] == 20000  # 1000 - 800, never negative


def test_concurrent_credit_and_payment_stay_consistent(
    client, trader_headers, make_customer
):
    customer = make_customer()

    def credit_thread():
        resp = client.post(
            "/api/ledger/credit",
            json={"customer_id": customer["id"], "amount_minor": 100000},
            headers=trader_headers,
        )
        return resp.status_code

    def payment_thread():
        resp = client.post(
            "/api/ledger/payment",
            json={"customer_id": customer["id"], "amount_minor": 80000},
            headers=trader_headers,
        )
        return resp.status_code

    credit_status, payment_status = _run_in_threads(client, [credit_thread, payment_thread])

    # Ordering is nondeterministic but the ledger must stay consistent:
    #   - payment before credit  → payment rejected, balance 1000
    #   - credit before payment   → payment accepted, balance 200
    assert credit_status == 201
    assert payment_status in (201, 400), f"unexpected payment status: {payment_status}"

    resp = client.get(f"/api/customers/{customer['id']}/ledger", headers=trader_headers)
    data = resp.get_json()
    payments = [e for e in data["entries"] if e["type"] == "PAYMENT"]
    assert len(payments) == (1 if payment_status == 201 else 0)
    expected = 100000 - (80000 if payment_status == 201 else 0)
    assert data["balance_minor"] == expected
    assert data["balance_minor"] >= 0