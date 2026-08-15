/**
 * Local offline store (IndexedDB via `idb`).
 *
 * The local database mirrors the server model and is the UI's source of
 * truth — the app renders from here whether online or offline. The sync
 * engine pushes `outbox` operations to the server and reconciles the local
 * copy with server state.
 *
 * Stores:
 *   customers  keyPath client_uuid  { client_uuid, name, phone, notes,
 *                                    server_id, created_at, updated_at,
 *                                    balance_minor (cached for display) }
 *   entries    keyPath client_uuid  { client_uuid, customer_client_uuid,
 *                                    type, amount_minor, payment_method,
 *                                    note, voided, void_reason, server_id,
 *                                    created_at, synced }
 *   outbox     keyPath client_uuid  { client_uuid, op, payload, status,
 *                                    error, server_id, queued_at }
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface LocalCustomer {
  client_uuid: string
  name: string
  phone: string | null
  notes: string | null
  server_id: number | null
  created_at: string
  updated_at: string
  balance_minor: number
  synced: boolean
}

export interface LocalEntry {
  client_uuid: string
  customer_client_uuid: string
  type: 'CREDIT' | 'PAYMENT'
  amount_minor: number
  payment_method: string | null
  note: string | null
  voided: boolean
  void_reason: string | null
  server_id: number | null
  created_at: string
  synced: boolean
}

export type OutboxOpType = 'create_customer' | 'update_customer' | 'credit' | 'payment' | 'void'

export interface OutboxOp {
  client_uuid: string
  op: OutboxOpType
  payload: Record<string, unknown>
  status: 'pending' | 'error'
  error: string | null
  server_id: number | null
  queued_at: string
}

interface DaiSchema extends DBSchema {
  customers: { key: string; value: LocalCustomer; indexes: { by_name: string } }
  entries: {
    key: string
    value: LocalEntry
    indexes: { by_customer: string; by_created: string }
  }
  // Auto-increment id = FIFO insertion order. The sync engine MUST process
  // ops in this order (a customer create precedes its credits), so ordering
  // is by sequence, never by timestamp (two ops can share a millisecond).
  outbox: {
    key: number
    value: OutboxOp & { id: number }
    indexes: { by_uuid: string; by_status: string }
  }
}

const DB_NAME = 'dai-ledger'
const DB_VERSION = 2

let _dbPromise: Promise<IDBPDatabase<DaiSchema>> | null = null

function getDb(): Promise<IDBPDatabase<DaiSchema>> {
  if (!_dbPromise) {
    _dbPromise = openDB<DaiSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const customers = db.createObjectStore('customers', { keyPath: 'client_uuid' })
          customers.createIndex('by_name', 'name')

          const entries = db.createObjectStore('entries', { keyPath: 'client_uuid' })
          entries.createIndex('by_customer', 'customer_client_uuid')
          entries.createIndex('by_created', 'created_at')
        }
        // v2: outbox keyed by auto-increment id for reliable FIFO order.
        if (oldVersion < 2 && db.objectStoreNames.contains('outbox')) {
          db.deleteObjectStore('outbox')
        }
        const outbox = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
        outbox.createIndex('by_uuid', 'client_uuid', { unique: true })
        outbox.createIndex('by_status', 'status')
      },
    })
  }
  return _dbPromise
}

export function nowIso(): string {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function getAllCustomers(): Promise<LocalCustomer[]> {
  const db = await getDb()
  const all = await db.getAll('customers')
  return all.sort((a, b) => a.name.localeCompare(b.name))
}

export async function getCustomer(clientUuid: string): Promise<LocalCustomer | undefined> {
  const db = await getDb()
  return db.get('customers', clientUuid)
}

export async function upsertCustomer(customer: LocalCustomer): Promise<void> {
  const db = await getDb()
  await db.put('customers', customer)
}

export async function saveCustomer(customer: LocalCustomer): Promise<void> {
  const db = await getDb()
  await db.put('customers', customer)
}

export async function deleteCustomer(clientUuid: string): Promise<void> {
  const db = await getDb()
  await db.delete('customers', clientUuid)
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export async function getEntriesForCustomer(customerUuid: string): Promise<LocalEntry[]> {
  const db = await getDb()
  const all = await db.getAllFromIndex('entries', 'by_customer', customerUuid)
  return all.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function upsertEntry(entry: LocalEntry): Promise<void> {
  const db = await getDb()
  await db.put('entries', entry)
}

export async function getEntry(clientUuid: string): Promise<LocalEntry | undefined> {
  const db = await getDb()
  return db.get('entries', clientUuid)
}

/** Derived balance for one customer: sum of non-voided credits minus payments. */
export async function balanceForCustomer(customerUuid: string): Promise<number> {
  const entries = await getEntriesForCustomer(customerUuid)
  return balanceFromEntries(entries)
}

export function balanceFromEntries(entries: LocalEntry[]): number {
  return entries.reduce((sum, e) => {
    if (e.voided) return sum
    return sum + (e.type === 'CREDIT' ? e.amount_minor : -e.amount_minor)
  }, 0)
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

export async function enqueueOp(op: OutboxOp): Promise<void> {
  const db = await getDb()
  // No id provided → the store assigns the next auto-increment sequence.
  await db.put('outbox', op as OutboxOp & { id: number })
}

export async function getPendingOps(): Promise<OutboxOp[]> {
  const db = await getDb()
  // getAll returns records in key (auto-increment id) order = FIFO insertion.
  return db.getAll('outbox')
}

export async function countPendingOps(): Promise<number> {
  const ops = await getPendingOps()
  return ops.filter((o) => o.status === 'pending').length
}

async function findByUuid(clientUuid: string) {
  const db = await getDb()
  return db.getFromIndex('outbox', 'by_uuid', clientUuid)
}

export async function completeOp(clientUuid: string): Promise<void> {
  const db = await getDb()
  const op = await findByUuid(clientUuid)
  if (op) await db.delete('outbox', op.id)
}

export async function failOp(clientUuid: string, message: string): Promise<void> {
  const db = await getDb()
  const op = await findByUuid(clientUuid)
  if (op) {
    await db.put('outbox', { ...op, status: 'error', error: message })
  }
}

export async function clearOutbox(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('outbox', 'readwrite')
  await tx.store.clear()
}

/** Delete everything (used on logout). */
export async function clearAllLocalData(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['customers', 'entries', 'outbox'], 'readwrite')
  await Promise.all([tx.objectStore('customers').clear(), tx.objectStore('entries').clear(), tx.objectStore('outbox').clear()])
  await tx.done
}
