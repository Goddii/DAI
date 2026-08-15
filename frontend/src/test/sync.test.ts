import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCustomerLocal,
  createCustomerWithInitialCreditLocal,
  recordCreditLocal,
} from '../lib/actions'
import { api, ApiError } from '../lib/api'
import { clearAllLocalData, getAllCustomers, getPendingOps } from '../lib/db'
import { syncNow } from '../lib/sync'

describe('sync engine', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    await clearAllLocalData()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('pushes pending ops and clears the outbox on success', async () => {
    const syncSpy = vi.spyOn(api, 'sync').mockResolvedValue({
      results: [
        { client_uuid: 'customer-1', status: 'ok', server_id: 10 },
        { client_uuid: 'credit-1', status: 'ok', server_id: 101, balance_minor: 85000 },
      ],
    })
    vi.spyOn(api, 'listCustomers').mockResolvedValue({
      customers: [],
      total_owed_minor: 0,
    })

    await createCustomerLocal('Mary Wanjiku', null, null)
    const customers = await getAllCustomers()
    const customerUuid = customers[0].client_uuid
    await recordCreditLocal(customerUuid, 85000, null)

    // Align the mocked result uuids with the real ones
    const ops = await getPendingOps()
    const results = ops.map((op) => ({
      client_uuid: op.client_uuid,
      status: 'ok' as const,
      server_id: op.op === 'create_customer' ? 10 : 101,
      balance_minor: op.op === 'credit' ? 85000 : undefined,
    }))
    syncSpy.mockResolvedValue({ results })

    const report = await syncNow()
    expect(report.completed).toBe(2)
    expect(report.failed).toHaveLength(0)
    expect(await getPendingOps()).toHaveLength(0)
  })

  it('keeps ops pending when the network is down', async () => {
    vi.spyOn(api, 'sync').mockRejectedValue(new ApiError(0, 'offline', 'network'))

    await createCustomerLocal('John Kamau', null, null)
    const report = await syncNow()
    expect(report.offline).toBe(true)
    expect(await getPendingOps()).toHaveLength(1)
  })

  it('marks failed ops with a message and keeps them for review', async () => {
    vi.spyOn(api, 'sync').mockResolvedValue({
      results: [
        {
          client_uuid: 'whatever',
          status: 'error',
          message: "That payment is more than what's owed.",
        },
      ],
    })
    vi.spyOn(api, 'listCustomers').mockResolvedValue({
      customers: [],
      total_owed_minor: 0,
    })

    await createCustomerLocal('Mary Wanjiku', null, null)
    const ops = await getPendingOps()
    vi.spyOn(api, 'sync').mockResolvedValue({
      results: ops.map((op) => ({
        client_uuid: op.client_uuid,
        status: 'error' as const,
        message: "That payment is more than what's owed.",
      })),
    })

    const report = await syncNow()
    expect(report.failed).toHaveLength(1)
    expect(report.failed[0].error).toContain("more than what's owed")
    expect(await getPendingOps()).toHaveLength(1)
  })

  it('reconciles customers from the server after a successful push', async () => {
    await createCustomerLocal('Local Mary', null, null)
    const ops = await getPendingOps()
    const localUuid = ops[0].client_uuid
    const localCreated = new Date().toISOString()

    // Server confirms the local customer and has one more.
    vi.spyOn(api, 'sync').mockResolvedValue({
      results: [{ client_uuid: localUuid, status: 'ok', server_id: 10 }],
    })
    vi.spyOn(api, 'listCustomers').mockResolvedValue({
      customers: [
        {
          id: 10,
          client_uuid: localUuid,
          name: 'Local Mary',
          phone: null,
          notes: null,
          balance_minor: 0,
          created_at: localCreated,
        },
        {
          id: 7,
          client_uuid: 'server-customer-1',
          name: 'Server Mary',
          phone: null,
          notes: null,
          balance_minor: 0,
          created_at: localCreated,
        },
      ],
      total_owed_minor: 0,
    })

    await syncNow()

    const customers = await getAllCustomers()
    expect(customers).toHaveLength(2)
    const local = customers.find((c) => c.client_uuid === localUuid)
    expect(local?.synced).toBe(true)
    expect(local?.server_id).toBe(10)
    expect(customers.some((c) => c.name === 'Server Mary' && c.synced)).toBe(true)
  })

  it('reconciles server data even when the outbox is empty (initial hydration)', async () => {
    // Fresh browser: empty local store, empty outbox, online. The absence of
    // pending uploads must NOT skip the server pull.
    const syncSpy = vi.spyOn(api, 'sync')
    vi.spyOn(api, 'listCustomers').mockResolvedValue({
      customers: [
        {
          id: 11,
          client_uuid: 'c-1',
          name: 'Mary Wanjiku',
          phone: null,
          notes: null,
          balance_minor: 125000,
          created_at: '2026-08-10T08:00:00Z',
        },
        {
          id: 12,
          client_uuid: 'c-2',
          name: 'John Kamau',
          phone: null,
          notes: null,
          balance_minor: 380000,
          created_at: '2026-08-10T08:00:00Z',
        },
      ],
      total_owed_minor: 505000,
    })

    const report = await syncNow()
    expect(report.reconciled).toBe(true)
    expect(report.pushed).toBe(0)
    expect(syncSpy).not.toHaveBeenCalled() // nothing to upload

    const customers = await getAllCustomers()
    expect(customers).toHaveLength(2)
    expect(customers.find((c) => c.name === 'Mary Wanjiku')?.balance_minor).toBe(125000)
    expect(customers.every((c) => c.synced)).toBe(true)
  })

  it('reports reconciliation failure honestly (not a verified-empty account)', async () => {
    vi.spyOn(api, 'listCustomers').mockRejectedValue(new ApiError(0, 'offline', 'network'))

    const report = await syncNow()
    expect(report.reconciled).toBe(false)
    expect(await getAllCustomers()).toHaveLength(0)
  })

  it('syncs an offline customer + initial credit exactly once, without duplication', async () => {
    const { customer } = await createCustomerWithInitialCreditLocal('Mama Fruits', null, null, 200000)
    const ops = await getPendingOps()
    expect(ops.map((o) => o.op)).toEqual(['create_customer', 'credit'])

    // First sync: the server confirms both, echoing the credit's balance.
    const syncSpy = vi.spyOn(api, 'sync').mockResolvedValue({
      results: ops.map((op) => ({
        client_uuid: op.client_uuid,
        status: 'ok' as const,
        server_id: op.op === 'create_customer' ? 10 : 101,
        balance_minor: op.op === 'credit' ? 200000 : 0,
      })),
    })
    vi.spyOn(api, 'listCustomers').mockResolvedValue({
      customers: [],
      total_owed_minor: 0,
    })

    const report = await syncNow()
    expect(report.completed).toBe(2)
    expect(await getPendingOps()).toHaveLength(0)

    // A retry has nothing left to push — the initial credit cannot duplicate.
    const retry = await syncNow()
    expect(retry.pushed).toBe(0)
    expect(syncSpy).toHaveBeenCalledTimes(1)
    expect(customer.client_uuid.length).toBeGreaterThan(0)
  })
})
