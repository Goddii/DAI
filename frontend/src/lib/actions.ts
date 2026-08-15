/**
 * User actions (record credit, record payment, add customer, void).
 *
 * Every action writes to the local store FIRST and enqueues a sync
 * operation — the same code path online and offline. The UI never waits
 * on the network; sync happens in the background.
 */

import { ApiError } from './api'
import { formatKsh } from './money'
import {
  balanceFromEntries,
  completeOp,
  deleteCustomer,
  enqueueOp,
  getCustomer,
  getEntriesForCustomer,
  getEntry,
  getPendingOps,
  nowIso,
  saveCustomer,
  upsertEntry,
  type LocalCustomer,
  type LocalEntry,
} from './db'
import { newClientUuid } from './id'
import { isLedgerReconciled, reconcileLedger } from './sync'

export async function createCustomerLocal(
  name: string,
  phone: string | null,
  notes: string | null,
): Promise<LocalCustomer> {
  const clientUuid = newClientUuid()
  const now = nowIso()
  const customer: LocalCustomer = {
    client_uuid: clientUuid,
    name,
    phone,
    notes,
    server_id: null,
    created_at: now,
    updated_at: now,
    balance_minor: 0,
    synced: false,
  }
  await saveCustomer(customer)
  await enqueueOp({
    client_uuid: clientUuid,
    op: 'create_customer',
    payload: { name, phone, notes },
    status: 'pending',
    error: null,
    server_id: null,
    queued_at: now,
  })
  return customer
}

export interface RecordResult {
  entry: LocalEntry
  balance_minor: number
}

/**
 * Add a customer, optionally with an amount they already owe.
 *
 * The initial amount is recorded as a proper ledger CREDIT — never a
 * mutable balance field. Locally the operations are applied in order
 * (customer, then credit), and the outbox FIFO (auto-increment sequence)
 * guarantees the create op syncs before the credit op. The server's
 * client_uuid idempotency means a retry never double-creates either.
 *
 * Returns the customer and, when an initial amount was given, the credit
 * entry that seeds the balance.
 */
export async function createCustomerWithInitialCreditLocal(
  name: string,
  phone: string | null,
  notes: string | null,
  initialAmountMinor: number | null,
): Promise<{ customer: LocalCustomer; initialEntry: LocalEntry | null }> {
  const customer = await createCustomerLocal(name, phone, notes)
  if (!initialAmountMinor || initialAmountMinor <= 0) {
    return { customer, initialEntry: null }
  }
  try {
    const { entry } = await recordCreditLocal(customer.client_uuid, initialAmountMinor, null)
    return { customer, initialEntry: entry }
  } catch (err) {
    // Atomicity: never leave a customer whose initial credit failed. Roll the
    // customer back (and its pending create op) so the local store stays
    // consistent — the server never saw either, thanks to client UUIDs.
    await deleteCustomer(customer.client_uuid)
    await completeOp(customer.client_uuid)
    throw err
  }
}

/**
 * Update a customer locally. If a create op is still pending, patch its
 * payload so the server gets the latest details; otherwise queue an
 * update_customer op (idempotent by nature).
 */
export async function updateCustomerLocal(
  clientUuid: string,
  fields: { name: string; phone: string | null; notes: string | null },
): Promise<LocalCustomer> {
  const customer = await getCustomer(clientUuid)
  if (!customer) throw new ApiError(404, "That customer doesn't exist.", 'customer_not_found')

  const updated: LocalCustomer = {
    ...customer,
    name: fields.name,
    phone: fields.phone,
    notes: fields.notes,
    updated_at: nowIso(),
    synced: false,
  }
  await saveCustomer(updated)

  const pending = await getPendingOps()
  const createOp = pending.find((o) => o.op === 'create_customer' && o.client_uuid === clientUuid)
  if (createOp) {
    await enqueueOp({
      ...createOp,
      payload: { name: fields.name, phone: fields.phone, notes: fields.notes },
    })
  } else {
    await enqueueOp({
      client_uuid: newClientUuid(),
      op: 'update_customer',
      payload: {
        customer_client_uuid: clientUuid,
        name: fields.name,
        phone: fields.phone,
        notes: fields.notes,
      },
      status: 'pending',
      error: null,
      server_id: null,
      queued_at: nowIso(),
    })
  }
  return updated
}

export async function recordCreditLocal(
  customerUuid: string,
  amountMinor: number,
  note: string | null,
): Promise<RecordResult> {
  const customer = await getCustomer(customerUuid)
  if (!customer) throw new ApiError(404, "That customer doesn't exist.", 'customer_not_found')

  // The ledger is the authority for the balance written back to
  // customer.balance_minor — but only if it's actually present. A customer
  // hydrated via the summary endpoint has a balance yet no local entries
  // until their ledger is pulled; reconcile first so the new credit is added
  // to the real balance, not an empty store. Offline this no-ops and the
  // locally recorded entries are used as-is.
  if (customer.server_id && !isLedgerReconciled(customer.server_id)) {
    await reconcileLedger(customer.server_id)
  }

  const clientUuid = newClientUuid()
  const now = nowIso()
  const entry: LocalEntry = {
    client_uuid: clientUuid,
    customer_client_uuid: customerUuid,
    type: 'CREDIT',
    amount_minor: amountMinor,
    payment_method: null,
    note,
    voided: false,
    void_reason: null,
    server_id: null,
    created_at: now,
    synced: false,
  }
  await upsertEntry(entry)
  await enqueueOp({
    client_uuid: clientUuid,
    op: 'credit',
    payload: { customer_client_uuid: customerUuid, amount_minor: amountMinor, note },
    status: 'pending',
    error: null,
    server_id: null,
    queued_at: now,
  })

  const balance = balanceFromEntries(await getEntriesForCustomer(customerUuid))
  await saveCustomer({ ...customer, balance_minor: balance })
  return { entry, balance_minor: balance }
}

export async function recordPaymentLocal(
  customerUuid: string,
  amountMinor: number,
  paymentMethod: 'CASH' | 'MPESA' | 'OTHER' | null,
  note: string | null,
): Promise<RecordResult> {
  const customer = await getCustomer(customerUuid)
  if (!customer) throw new ApiError(404, "That customer doesn't exist.", 'customer_not_found')

  // The ledger is the authority — but only if it's actually present. A
  // customer hydrated via the summary endpoint (reconcileCustomers) has a
  // balance yet no local ledger entries until their ledger is pulled, so
  // validating against the empty entries store would falsely reject a valid
  // payment. Reconcile first; offline this no-ops and entries already
  // recorded locally are used as-is.
  if (customer.server_id && !isLedgerReconciled(customer.server_id)) {
    await reconcileLedger(customer.server_id)
  }

  const current = balanceFromEntries(await getEntriesForCustomer(customerUuid))
  if (current <= 0) {
    // Genuinely zero only when the ledger was actually verified. If the pull
    // never succeeded (offline with no local entries), the balance is
    // unknown — never claim "owes nothing" and never approve an unverifiable
    // payment. Same principle as the dashboard: don't confuse "not loaded"
    // with "no data".
    if (customer.server_id && !isLedgerReconciled(customer.server_id)) {
      throw new ApiError(
        400,
        "Can't verify this customer's balance right now. Go online once to sync, then try again.",
        'balance_unverified',
      )
    }
    throw new ApiError(400, `${customer.name} doesn't owe anything right now.`, 'no_outstanding_balance')
  }
  if (amountMinor > current) {
    throw new ApiError(
      400,
      `That payment is more than what's owed. Current balance is ${formatKsh(current)}.`,
      'payment_exceeds_balance',
    )
  }

  const clientUuid = newClientUuid()
  const now = nowIso()
  const entry: LocalEntry = {
    client_uuid: clientUuid,
    customer_client_uuid: customerUuid,
    type: 'PAYMENT',
    amount_minor: amountMinor,
    payment_method: paymentMethod,
    note,
    voided: false,
    void_reason: null,
    server_id: null,
    created_at: now,
    synced: false,
  }
  await upsertEntry(entry)
  await enqueueOp({
    client_uuid: clientUuid,
    op: 'payment',
    payload: {
      customer_client_uuid: customerUuid,
      amount_minor: amountMinor,
      payment_method: paymentMethod,
      note,
    },
    status: 'pending',
    error: null,
    server_id: null,
    queued_at: now,
  })

  const balance = balanceFromEntries(await getEntriesForCustomer(customerUuid))
  await saveCustomer({ ...customer, balance_minor: balance })
  return { entry, balance_minor: balance }
}

export async function voidEntryLocal(entryUuid: string, reason: string | null): Promise<void> {
  const entry = await getEntry(entryUuid)
  if (!entry) throw new ApiError(404, "That transaction doesn't exist.", 'entry_not_found')
  if (entry.voided) throw new ApiError(400, 'That transaction has already been voided.', 'already_voided')

  const now = nowIso()
  await upsertEntry({ ...entry, voided: true, void_reason: reason })

  // If the entry hasn't synced yet, drop its pending op instead of voiding on
  // the server (the server never saw it). Otherwise queue a void op.
  if (!entry.synced) {
    await completeOp(entryUuid)
    const customer = await getCustomer(entry.customer_client_uuid)
    if (customer) {
      const balance = balanceFromEntries(await getEntriesForCustomer(customer.client_uuid))
      await saveCustomer({ ...customer, balance_minor: balance })
    }
    return
  }

  await enqueueOp({
    client_uuid: newClientUuid(),
    op: 'void',
    payload: { entry_client_uuid: entryUuid, reason },
    status: 'pending',
    error: null,
    server_id: null,
    queued_at: now,
  })
  const customer = await getCustomer(entry.customer_client_uuid)
  if (customer) {
    const balance = balanceFromEntries(await getEntriesForCustomer(customer.client_uuid))
    await saveCustomer({ ...customer, balance_minor: balance })
  }
}

