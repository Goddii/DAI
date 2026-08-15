import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCustomerLocal,
  createCustomerWithInitialCreditLocal,
  recordCreditLocal,
  recordPaymentLocal,
  voidEntryLocal,
} from '../lib/actions'
import { api, ApiError } from '../lib/api'
import {
  balanceForCustomer,
  clearAllLocalData,
  getEntriesForCustomer,
  getPendingOps,
  saveCustomer,
  type LocalCustomer,
} from '../lib/db'

// fake-indexeddb is installed globally via setup.ts
describe('local actions (offline-first core)', () => {
  let customerUuid: string

  beforeEach(async () => {
    await clearAllLocalData()
    customerUuid = (await createCustomerLocal('Mary Wanjiku', null, null)).client_uuid
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records a credit and derives the balance', async () => {
    const { balance_minor } = await recordCreditLocal(customerUuid, 85000, 'Tomatoes + onions')
    expect(balance_minor).toBe(85000)
    expect(await balanceForCustomer(customerUuid)).toBe(85000)

    await recordCreditLocal(customerUuid, 40000, 'Vegetables')
    expect(await balanceForCustomer(customerUuid)).toBe(125000)
  })

  it('records a partial payment', async () => {
    await recordCreditLocal(customerUuid, 500000, null)
    const { balance_minor } = await recordPaymentLocal(customerUuid, 200000, 'MPESA', null)
    expect(balance_minor).toBe(300000)
  })

  it('rejects a payment larger than the balance', async () => {
    await recordCreditLocal(customerUuid, 85000, null)
    await expect(recordPaymentLocal(customerUuid, 100000, 'CASH', null)).rejects.toThrow(
      ApiError,
    )
  })

  it('rejects a payment when nothing is owed', async () => {
    await expect(recordPaymentLocal(customerUuid, 5000, 'CASH', null)).rejects.toThrow(
      ApiError,
    )
  })

  it('settles to zero on a full payment and keeps the customer', async () => {
    await recordCreditLocal(customerUuid, 85000, null)
    const { balance_minor } = await recordPaymentLocal(customerUuid, 85000, 'MPESA', null)
    expect(balance_minor).toBe(0)
  })

  it('queues outbox ops for every recorded action', async () => {
    await recordCreditLocal(customerUuid, 10000, null)
    const ops = await getPendingOps()
    expect(ops.map((o) => o.op)).toEqual(['create_customer', 'credit'])
    expect(ops[1].payload.amount_minor).toBe(10000)
    expect(ops[1].client_uuid).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('voids an entry and reverses the balance', async () => {
    await recordCreditLocal(customerUuid, 85000, null)
    const entries = await getEntriesForCustomer(customerUuid)
    await voidEntryLocal(entries[0].client_uuid, 'Wrong amount')
    expect(await balanceForCustomer(customerUuid)).toBe(0)
    const [entry] = await getEntriesForCustomer(customerUuid)
    expect(entry.voided).toBe(true)
    expect(entry.void_reason).toBe('Wrong amount')
  })

  it('voiding an unsynced entry drops its pending op (no server void needed)', async () => {
    await recordCreditLocal(customerUuid, 85000, null)
    const entries = await getEntriesForCustomer(customerUuid)
    await voidEntryLocal(entries[0].client_uuid, 'Mistake')
    const ops = await getPendingOps()
    expect(ops.filter((o) => o.op === 'credit').length).toBe(0)
  })

  it('creates a customer with an initial credit in one call', async () => {
    const { customer, initialEntry } = await createCustomerWithInitialCreditLocal(
      'Mama Fruits',
      null,
      null,
      200000,
    )
    // The initial amount is a proper ledger CREDIT, not a balance field.
    expect(initialEntry).not.toBeNull()
    expect(initialEntry?.type).toBe('CREDIT')
    expect(initialEntry?.amount_minor).toBe(200000)
    expect(await balanceForCustomer(customer.client_uuid)).toBe(200000)
    expect(await getEntriesForCustomer(customer.client_uuid)).toHaveLength(1)
  })

  it('creates only the customer when no initial amount is given', async () => {
    const { customer, initialEntry } = await createCustomerWithInitialCreditLocal(
      'John Kamau',
      null,
      null,
      null,
    )
    expect(initialEntry).toBeNull()
    expect(await balanceForCustomer(customer.client_uuid)).toBe(0)
    expect(await getEntriesForCustomer(customer.client_uuid)).toHaveLength(0)
  })

  it('queues the customer create before the initial credit (FIFO outbox order)', async () => {
    await createCustomerWithInitialCreditLocal('Mama Fruits', null, null, 200000)
    // The beforeEach created another customer; the last two ops belong to
    // this one, in the order the server must apply them.
    const ops = await getPendingOps()
    const lastTwo = ops.slice(-2)
    expect(lastTwo.map((o) => o.op)).toEqual(['create_customer', 'credit'])
    expect(lastTwo[1].payload.customer_client_uuid).toBe(lastTwo[0].client_uuid)
    expect(lastTwo[1].payload.amount_minor).toBe(200000)
  })
})

// ---------------------------------------------------------------------------
// Payment/credit guard with server-backed customers (the hydration gap)
//
// A customer hydrated via the summary endpoint (reconcileCustomers) has a
// correct balance_minor but NO local ledger entries until reconcileLedger()
// runs. Before the fix, recordPaymentLocal validated against that empty
// entries store and falsely rejected every payment with "doesn't owe
// anything right now" — while the sheet showed the real balance above.
// The guard now reconciles the ledger first, and refuses to guess when the
// balance can't be verified (offline, no local entries).
// ---------------------------------------------------------------------------

describe('payment/credit guard (server-backed customers)', () => {
  /** A customer hydrated from the summary: server_id set, entries absent. */
  function serverCustomer(serverId: number, balanceMinor: number): LocalCustomer {
    return {
      client_uuid: `server-cust-${serverId}`,
      name: 'Mary Wanjiku',
      phone: null,
      notes: null,
      server_id: serverId,
      created_at: '2026-08-10T08:00:00Z',
      updated_at: '2026-08-10T08:00:00Z',
      balance_minor: balanceMinor,
      synced: true,
    }
  }

  interface EntryDto {
    id: number
    client_uuid: string
    type: 'CREDIT' | 'PAYMENT'
    amount_minor: number
    payment_method: string | null
    note: string | null
    voided: boolean
    void_reason: string | null
    created_at: string
  }

  function ledgerWith(serverId: number, balanceMinor: number, entries: EntryDto[]) {
    return {
      customer: {
        id: serverId,
        client_uuid: `server-cust-${serverId}`,
        name: 'Mary Wanjiku',
        phone: null,
        notes: null,
        balance_minor: balanceMinor,
        created_at: '2026-08-10T08:00:00Z',
      },
      balance_minor: balanceMinor,
      entries,
    }
  }

  const credit = (clientUuid: string, amountMinor: number): EntryDto => ({
    id: 1001,
    client_uuid: clientUuid,
    type: 'CREDIT',
    amount_minor: amountMinor,
    payment_method: null,
    note: null,
    voided: false,
    void_reason: null,
    created_at: '2026-08-10T09:00:00Z',
  })

  beforeEach(async () => {
    await clearAllLocalData()
    vi.restoreAllMocks()
  })

  it('reconciles the ledger before validating a payment on a server customer (the reported bug)', async () => {
    // Summary-hydrated customer: balance 1,000, but zero local entries.
    await saveCustomer(serverCustomer(11, 100000))
    const getLedger = vi.spyOn(api, 'getLedger').mockResolvedValue(
      ledgerWith(11, 100000, [credit('entry-11', 100000)]),
    )

    // The exact scenario: a KSh 500 payment from the global sheet.
    const { balance_minor } = await recordPaymentLocal('server-cust-11', 50000, 'MPESA', null)

    expect(getLedger).toHaveBeenCalledWith(11)
    expect(balance_minor).toBe(50000) // 1,000 − 500
    // The entries are now present, so the derived balance is real.
    expect(await balanceForCustomer('server-cust-11')).toBe(50000)
  })

  it('does NOT falsely claim the customer owes nothing when the balance cannot be verified (offline)', async () => {
    await saveCustomer(serverCustomer(12, 100000))
    // Offline: the ledger pull fails.
    vi.spyOn(api, 'getLedger').mockRejectedValue(new ApiError(0, 'offline', 'network'))

    const err = await recordPaymentLocal('server-cust-12', 50000, 'MPESA', null).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe('balance_unverified')
    expect((err as ApiError).message).toMatch(/go online.*sync/i)
    expect((err as ApiError).message).not.toMatch(/doesn't owe anything/i)
  })

  it('still rejects a payment larger than the balance after the ledger is reconciled', async () => {
    await saveCustomer(serverCustomer(13, 100000))
    vi.spyOn(api, 'getLedger').mockResolvedValue(
      ledgerWith(13, 100000, [credit('entry-13', 100000)]),
    )

    await expect(recordPaymentLocal('server-cust-13', 150000, 'CASH', null)).rejects.toThrow(
      /more than what's owed/i,
    )
  })

  it('reconciles before recording credit so the written-back balance is accurate', async () => {
    await saveCustomer(serverCustomer(14, 100000))
    const getLedger = vi.spyOn(api, 'getLedger').mockResolvedValue(
      ledgerWith(14, 100000, [credit('entry-14', 100000)]),
    )

    // The new KSh 250 credit lands on top of the existing KSh 1,000.
    const { balance_minor } = await recordCreditLocal('server-cust-14', 25000, null)
    expect(getLedger).toHaveBeenCalledWith(14)
    expect(balance_minor).toBe(125000)
    expect(await balanceForCustomer('server-cust-14')).toBe(125000)
  })

  it('still rejects when a reconciled ledger is genuinely zero', async () => {
    await saveCustomer(serverCustomer(15, 0))
    // The ledger was pulled and really has no entries — a verified zero.
    vi.spyOn(api, 'getLedger').mockResolvedValue(ledgerWith(15, 0, []))

    await expect(recordPaymentLocal('server-cust-15', 5000, 'CASH', null)).rejects.toThrow(
      /doesn't owe anything right now/i,
    )
  })
})
