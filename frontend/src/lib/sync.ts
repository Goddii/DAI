/**
 * Sync engine.
 *
 * 1. pushOutbox — send pending operations to /sync. The server is
 *    idempotent by client_uuid, so retries and duplicate requests never
 *    double-post. Successful ops are removed from the outbox; failed ops
 *    stay with an error message so the UI can surface them.
 * 2. reconcile — ALWAYS pull server state back into the local store
 *    (customers + balances), whether or not anything was pushed. An empty
 *    outbox means "nothing to upload" — it does NOT mean "nothing to
 *    download": a fresh browser or cleared IndexedDB still needs its
 *    server-side data hydrated on login.
 */

import { api, ApiError } from './api'
import {
  completeOp,
  failOp,
  getCustomer,
  getEntriesForCustomer,
  getPendingOps,
  nowIso,
  saveCustomer,
  upsertEntry,
  type LocalCustomer,
  type LocalEntry,
  type OutboxOp,
} from './db'

export interface SyncReport {
  pushed: number
  completed: number
  failed: OutboxOp[]
  reconciled: boolean
  offline: boolean
}

let syncing = false

/**
 * Server ids whose ledger has been pulled from the server this session.
 *
 * The customer summary (reconcileCustomers) hydrates `balance_minor` but
 * NOT the per-customer ledger entries — those only appear via
 * reconcileLedger(). recordPaymentLocal / recordCreditLocal must not
 * validate against an empty entries store as if it were a zero balance, so
 * they reconcile first when a server-backed customer's ledger was never
 * pulled this session. This set tracks that, and is reset on each login
 * (SyncProvider mount) and by logout (SyncProvider unmounts).
 */
const reconciledLedgers = new Set<number>()

/** True when this customer's ledger has been pulled from the server this session. */
export function isLedgerReconciled(serverId: number): boolean {
  return reconciledLedgers.has(serverId)
}

/** Clear the per-session ledger-reconciliation markers (fresh login). */
export function resetLedgerReconciliation(): void {
  reconciledLedgers.clear()
}

/** Push pending operations to the server, then reconcile. */
export async function syncNow(): Promise<SyncReport> {
  if (syncing) return { pushed: 0, completed: 0, failed: [], reconciled: false, offline: false }
  syncing = true
  try {
    const pending = await getPendingOps()
    let pushed = 0
    let completed = 0
    const failed: OutboxOp[] = []

    if (pending.length > 0) {
      const wireOps = pending.map((op) => ({ op: op.op, client_uuid: op.client_uuid, ...op.payload }))
      let results
      try {
        results = (await api.sync(wireOps)).results
      } catch (err) {
        // Network-level failure: nothing was pushed, everything stays pending.
        const offline = err instanceof ApiError && err.status === 0
        return { pushed: pending.length, completed: 0, failed: [], reconciled: false, offline }
      }
      pushed = pending.length

      const byUuid = new Map(results.map((r) => [r.client_uuid, r]))
      for (const op of pending) {
        const result = byUuid.get(op.client_uuid)
        if (result && result.status === 'ok') {
          await completeOp(op.client_uuid)
          await applyServerResult(op, result.server_id, result.balance_minor)
          completed += 1
        } else {
          const message = result?.message ?? 'Could not sync. Please try again.'
          await failOp(op.client_uuid, message)
          failed.push({ ...op, status: 'error', error: message })
        }
      }
    }

    // Always pull server state (initial hydration, and merge after a push).
    // `reconciled` is only true when the pull actually succeeded — a failed
    // pull must not be reported as a verified-empty account.
    const reconciled = await reconcileCustomers()
    return { pushed, completed, failed, reconciled, offline: false }
  } finally {
    syncing = false
  }
}

async function applyServerResult(op: OutboxOp, serverId?: number, balanceMinor?: number): Promise<void> {
  if (op.op === 'create_customer') {
    const customer = await getCustomer(op.client_uuid)
    if (customer && serverId !== undefined) {
      await saveCustomer({ ...customer, server_id: serverId, synced: true, updated_at: nowIso() })
    }
  } else {
    // credit / payment / void — refresh the affected customer's balance from server
    const customerUuid = op.payload.customer_client_uuid as string | undefined
    if (customerUuid) {
      const customer = await getCustomer(customerUuid)
      if (customer) {
        await saveCustomer({
          ...customer,
          balance_minor: balanceMinor ?? customer.balance_minor,
          synced: true,
        })
      }
    }
  }
}

/**
 * Pull customers (with balances) from the server and merge into the local
 * store (upsert by client_uuid — never duplicates). Returns true only when
 * the server was actually reached, so callers can distinguish "verified
 * empty" from "couldn't check".
 */
export async function reconcileCustomers(): Promise<boolean> {
  let data
  try {
    data = await api.listCustomers()
  } catch {
    return false // offline or error — local data stays, nothing verified
  }
  for (const dto of data.customers) {
    const existing = await getCustomer(dto.client_uuid)
    const customer: LocalCustomer = {
      client_uuid: dto.client_uuid,
      name: dto.name,
      phone: dto.phone,
      notes: dto.notes,
      server_id: dto.id,
      created_at: existing?.created_at ?? dto.created_at,
      updated_at: existing?.updated_at ?? dto.created_at,
      balance_minor: dto.balance_minor,
      synced: true,
    }
    await saveCustomer(customer)
  }
  return true
}

/**
 * Pull one customer's ledger from the server and merge into the local store.
 * Server entries carry client_uuids, so merging is safe and idempotent.
 *
 * On success the customer's server id is marked as reconciled for this
 * session, so payment/credit guards know the local entries are complete
 * (an empty local entries store is then a genuine zero balance, not
 * "not loaded yet"). Offline the pull no-ops and nothing is marked.
 */
export async function reconcileLedger(customerServerId: number): Promise<void> {
  let data
  try {
    data = await api.getLedger(customerServerId)
  } catch {
    return
  }
  reconciledLedgers.add(customerServerId)
  const customer = await getCustomer(data.customer.client_uuid)
  const localEntries = await getEntriesForCustomer(data.customer.client_uuid)
  const localByUuid = new Map(localEntries.map((e) => [e.client_uuid, e]))

  for (const dto of data.entries) {
    const existing = localByUuid.get(dto.client_uuid)
    const entry: LocalEntry = {
      client_uuid: dto.client_uuid,
      customer_client_uuid: data.customer.client_uuid,
      type: dto.type,
      amount_minor: dto.amount_minor,
      payment_method: dto.payment_method,
      note: dto.note,
      voided: dto.voided,
      void_reason: dto.void_reason,
      server_id: dto.id,
      created_at: existing?.created_at ?? dto.created_at,
      synced: true,
    }
    await upsertEntry(entry)
  }
  if (customer) {
    await saveCustomer({
      ...customer,
      server_id: data.customer.id,
      balance_minor: data.balance_minor,
      synced: true,
    })
  }
}

/** True when the browser reports connectivity. */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}
