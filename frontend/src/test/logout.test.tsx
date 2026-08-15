/**
 * Authenticated app shell tests (refinement pass):
 *   - the account control is discoverable and shows trader identity
 *   - logout clears auth state and returns to the login screen
 *   - protected routes are inaccessible after logout
 *   - the "Sync & settings" row navigates to Settings
 *
 * Logout safety (financial data is never destroyed by Log Out):
 *   - offline with unsynced changes, logout is blocked and data stays intact
 *   - pending changes sync first, and logout completes only when the server
 *     confirmed them
 *   - network failure, server rejection, and partial sync failure all block
 *     logout, keep the local records, and allow a retry
 *   - a retry re-sends the SAME operation (client uuid) — no duplicates
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createCustomerLocal, recordCreditLocal, recordPaymentLocal } from '../lib/actions'
import { api } from '../lib/api'
import { countPendingOps, getAllCustomers, getPendingOps } from '../lib/db'

/** Queries scoped to the open bottom sheet (dialog). */
function sheet() {
  const dialog = screen.getByRole('dialog')
  return within(dialog)
}

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      login: vi.fn(async () => ({
        token: 'test-token',
        trader: { id: 1, name: 'Demo Trader', phone: '0700000000', email: null },
      })),
      register: vi.fn(async () => ({
        token: 'test-token',
        trader: { id: 1, name: 'Demo Trader', phone: '0700000000', email: null },
      })),
      me: vi.fn(async () => ({
        trader: { id: 1, name: 'Demo Trader', phone: '0700000000', email: null },
      })),
      logout: vi.fn(async () => undefined),
      dashboard: vi.fn(async () => ({
        total_owed_minor: 0,
        customers_owing: 0,
        total_customers: 0,
        top_customers: [],
      })),
      listCustomers: vi.fn(async () => ({ customers: [], total_owed_minor: 0 })),
      getLedger: vi.fn(async (id: number) => {
        throw new Error(`unexpected getLedger(${id})`)
      }),
      sync: vi.fn(async (operations: Record<string, unknown>[]) => ({
        results: operations.map((op) => ({
          client_uuid: op.client_uuid as string,
          status: 'ok' as const,
          server_id: 1,
          balance_minor: 0,
        })),
      })),
    },
  }
})

async function login(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Phone number'), '0700000000')
  await user.type(screen.getByLabelText('Password'), 'secret123')
  await user.click(screen.getByRole('button', { name: 'Log In' }))
  await waitFor(() => {
    expect(screen.getByText("Demo's Credit Book")).toBeInTheDocument()
  })
}

beforeEach(async () => {
  localStorage.clear()
  vi.clearAllMocks()
  // Restore the default "accept everything" sync result — per-test mocks are
  // installed before render so the mount-time auto-sync sees them too.
  vi.mocked(api.sync).mockImplementation(async (operations: Record<string, unknown>[]) => ({
    results: operations.map((op) => ({
      client_uuid: op.client_uuid as string,
      status: 'ok' as const,
      server_id: 1,
      balance_minor: 0,
    })),
  }))
  window.history.pushState({}, '', '/')
  const { clearAllLocalData } = await import('../lib/db')
  await clearAllLocalData()
  // Ensure the browser is reported online for tests that don't override it.
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
})

afterEach(() => {
  cleanup()
})

describe('authenticated app shell', () => {
  it('shows the Dai wordmark and a discoverable account control with trader identity', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    // Shell: Dai is the app identity, the ledger name is business context.
    // (Scoped to the header banner — the closed navigation drawer's brand
    // row also reads "Dai".)
    expect(within(screen.getByRole('banner')).getByText('Dai')).toBeInTheDocument()
    expect(screen.getByText("Demo's Credit Book")).toBeInTheDocument()

    // Account control: initials avatar on every authenticated screen.
    const account = screen.getByRole('button', { name: 'Account' })
    expect(account).toHaveTextContent('DT') // Demo Trader

    await user.click(account)
    expect(sheet().getByText('Your account')).toBeInTheDocument()
    expect(sheet().getByText('Demo Trader')).toBeInTheDocument()
    expect(sheet().getByText('0700000000')).toBeInTheDocument()

    // Log out is available right here — no digging through Settings.
    expect(sheet().getByRole('button', { name: 'Log Out' })).toBeInTheDocument()
  })

  it('logs out, clears auth state, and protects routes afterwards', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.click(sheet().getByRole('button', { name: 'Log Out' }))

    // Back on the login screen.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Log In' })).toBeInTheDocument()
    })

    // Auth state is cleared.
    expect(localStorage.getItem('dai_token')).toBeNull()
    expect(localStorage.getItem('dai_trader')).toBeNull()
    const { getToken } = await import('../lib/api')
    expect(getToken()).toBeNull()

    // Stale authenticated UI is gone.
    expect(screen.queryByText("Demo's Credit Book")).not.toBeInTheDocument()

    // Authenticated routes are not accessible after logout.
    window.history.pushState({}, '', '/customers')
    expect(screen.getByRole('button', { name: 'Log In' })).toBeInTheDocument()
    window.history.pushState({}, '', '/customers/some-uuid')
    expect(screen.getByRole('button', { name: 'Log In' })).toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('reaches Settings from the account sheet', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.click(sheet().getByRole('button', { name: 'Settings' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    })
    // The sheet closed and the shell header is still there.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument()
  })
})

describe('logout safety: unsynced data is never destroyed', () => {
  // Pending operations are created through the same lib functions the record
  // sheets call — before the app mounts, so SyncProvider's initial load sees
  // them and no navigation race interferes with the logout interactions.
  async function seedCustomer(name = 'Mary Wanjiku') {
    await createCustomerLocal(name, null, null)
  }

  async function seedCustomerWithCredit() {
    const customer = await createCustomerLocal('Mary Wanjiku', null, null)
    await recordCreditLocal(customer.client_uuid, 100000, null)
  }

  async function seedThreeOps() {
    const customer = await createCustomerLocal('Mary Wanjiku', null, null)
    await recordCreditLocal(customer.client_uuid, 100000, null)
    await recordPaymentLocal(customer.client_uuid, 10000, 'CASH', null)
  }

  it('syncs pending changes first, then logs out once the server confirms them', async () => {
    await seedCustomer()
    expect(await countPendingOps()).toBe(1)

    const user = userEvent.setup()
    render(<App />)
    await login(user)

    // Log Out: sync runs (accepts everything), the outbox is verified clean,
    // then logout completes and the local account data is cleared.
    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.click(sheet().getByRole('button', { name: 'Log Out' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Log In' })).toBeInTheDocument()
    })
    expect(vi.mocked(api.sync)).toHaveBeenCalled()
    expect(localStorage.getItem('dai_token')).toBeNull()
    expect(await getAllCustomers()).toHaveLength(0)
    expect(await countPendingOps()).toBe(0)
  })

  it('blocks logout when the network is unavailable and keeps every record', async () => {
    // The phone is offline before anything else happens.
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    await seedCustomer()
    expect(await countPendingOps()).toBe(1)

    const user = userEvent.setup()
    render(<App />)
    await login(user)

    // The account sheet explains that changes are saved but not synced yet —
    // without threatening deletion.
    await user.click(screen.getByRole('button', { name: 'Account' }))
    expect(sheet().getByText(/not synced yet/)).toBeInTheDocument()
    await user.click(sheet().getByRole('button', { name: 'Log Out' }))

    // A clear, non-technical recovery message instead of a silent delete.
    expect(
      await screen.findByText(/haven't synced yet\. Stay logged in and try again/, {}, { timeout: 3000 }),
    ).toBeInTheDocument()

    // Still logged in.
    expect(screen.queryByRole('button', { name: 'Log In' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument()
    expect(localStorage.getItem('dai_token')).not.toBeNull()

    // Local data is intact: customer, entries and the outbox operation.
    expect(await getAllCustomers()).toHaveLength(1)
    expect(await countPendingOps()).toBe(1)

    // The sync attempt reported offline — nothing was pushed or discarded.
    expect(vi.mocked(api.sync)).not.toHaveBeenCalled()
  })

  it('blocks logout when the server rejects an operation and keeps it recoverable', async () => {
    await seedCustomer()

    // The server rejects every operation (e.g. a payment beyond the balance).
    // Installed before render so the mount-time auto-sync sees it too.
    vi.mocked(api.sync).mockImplementation(async (operations) => ({
      results: operations.map((op) => ({
        client_uuid: op.client_uuid as string,
        status: 'error' as const,
        message: 'The server rejected this change.',
      })),
    }))

    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.click(sheet().getByRole('button', { name: 'Log Out' }))

    // Logout is blocked, the trader stays logged in…
    await waitFor(() => {
      expect(sheet().getByText(/haven't synced yet\. Stay logged in and try again/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Log In' })).not.toBeInTheDocument()

    // …and the rejected operation remains in the outbox as a recoverable
    // failed op (status 'error'), with the local customer still present.
    const ops = await getPendingOps()
    expect(ops).toHaveLength(1)
    expect(ops[0].status).toBe('error')
    expect(ops[0].error).toContain('rejected')
    expect(await getAllCustomers()).toHaveLength(1)
  })

  it('blocks logout on partial sync failure without duplicating successful ops', async () => {
    await seedThreeOps()
    expect(await countPendingOps()).toBe(3)

    // The server accepts the customer and the credit but rejects the payment.
    // Installed before render so the mount-time auto-sync sees it too.
    vi.mocked(api.sync).mockImplementation(async (operations) => ({
      results: operations.map((op) =>
        op.op === 'payment'
          ? { client_uuid: op.client_uuid as string, status: 'error' as const, message: 'Payment rejected.' }
          : { client_uuid: op.client_uuid as string, status: 'ok' as const, server_id: 10, balance_minor: 0 },
      ),
    }))

    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.click(sheet().getByRole('button', { name: 'Log Out' }))

    // Partial success is NOT enough: logout is blocked.
    await waitFor(() => {
      expect(sheet().getByText(/haven't synced yet\. Stay logged in and try again/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Log In' })).not.toBeInTheDocument()

    // Only the failed payment remains in the outbox; the successful customer
    // and credit were completed exactly once (no duplicates locally).
    const ops = await getPendingOps()
    expect(ops).toHaveLength(1)
    expect(ops[0].op).toBe('payment')
    expect(ops[0].status).toBe('error')
    expect(await getAllCustomers()).toHaveLength(1)
  })

  it('lets the trader retry after a blocked logout — same operation, no duplicates', async () => {
    await seedCustomer()

    // First attempt: the server rejects the operation. Installed before
    // render so the mount-time auto-sync sees it too.
    vi.mocked(api.sync).mockImplementation(async (operations) => ({
      results: operations.map((op) => ({
        client_uuid: op.client_uuid as string,
        status: 'error' as const,
        message: 'The server rejected this change.',
      })),
    }))

    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.click(sheet().getByRole('button', { name: 'Log Out' }))
    await waitFor(() => {
      expect(sheet().getByText(/haven't synced yet\. Stay logged in and try again/)).toBeInTheDocument()
    })

    // The outbox still holds the operation with its original client uuid.
    const [pendingOp] = await getPendingOps()
    expect(pendingOp).toBeDefined()
    expect(pendingOp.status).toBe('error')

    // Network heals: the server now accepts the same operation.
    vi.mocked(api.sync).mockImplementation(async (operations) => ({
      results: operations.map((op) => ({
        client_uuid: op.client_uuid as string,
        status: 'ok' as const,
        server_id: 10,
        balance_minor: 0,
      })),
    }))

    // Retry from the blocked panel: sync succeeds, outbox is clean, logout
    // may now complete.
    await user.click(sheet().getByRole('button', { name: 'Try Again' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Log In' })).toBeInTheDocument()
    })
    expect(await getAllCustomers()).toHaveLength(0)
    expect(await countPendingOps()).toBe(0)

    // Idempotency: every attempt sent the SAME client uuid — a retry never
    // re-queued the operation under a new identity.
    const sentUuids = vi
      .mocked(api.sync)
      .mock.calls.flatMap(([operations]) => operations.map((o) => o.client_uuid))
    expect(sentUuids.length).toBeGreaterThan(0)
    expect(new Set(sentUuids).size).toBe(1)
    expect(sentUuids[0]).toBe(pendingOp.client_uuid)
  })

  it('syncs an operation the UI state has not seen — the outbox decides, not React state', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    // The app loaded with an empty outbox, so SyncProvider's state says 0.
    // An operation written straight to IndexedDB afterwards (e.g. a record
    // flow that bypassed the provider's reload) leaves that state stale.
    expect(await countPendingOps()).toBe(0)
    await createCustomerLocal('Mary Wanjiku', null, null)
    expect(await countPendingOps()).toBe(1)

    // The server rejects it. Logout must still attempt the sync and block.
    vi.mocked(api.sync).mockImplementation(async (operations) => ({
      results: operations.map((op) => ({
        client_uuid: op.client_uuid as string,
        status: 'error' as const,
        message: 'The server rejected this change.',
      })),
    }))

    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.click(sheet().getByRole('button', { name: 'Log Out' }))

    // Sync was attempted with the op the UI state knew nothing about…
    const sentUuids = vi
      .mocked(api.sync)
      .mock.calls.flatMap(([operations]) => operations.map((o) => o.client_uuid))
    expect(sentUuids).toHaveLength(1)

    // …logout is blocked, the trader stays logged in, and the record and
    // outbox operation are intact.
    await waitFor(() => {
      expect(sheet().getByText(/haven't synced yet\. Stay logged in and try again/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Log In' })).not.toBeInTheDocument()
    expect(localStorage.getItem('dai_token')).not.toBeNull()
    expect(await getAllCustomers()).toHaveLength(1)
    const [op] = await getPendingOps()
    expect(op.status).toBe('error')
  })

  it('keeps the credit book fully usable after a blocked logout', async () => {
    // Offline with pending changes.
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    await seedCustomerWithCredit()
    expect(await countPendingOps()).toBe(2)

    const user = userEvent.setup()
    render(<App />)
    await login(user)

    // The dashboard still shows the local credit book.
    await waitFor(() => {
      expect(screen.getByText('Mary Wanjiku')).toBeInTheDocument()
    })
    // Total owed panel and the customer row both show the balance.
    expect(screen.getAllByText('KSh 1,000').length).toBeGreaterThan(0)

    // Log Out is blocked…
    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.click(sheet().getByRole('button', { name: 'Log Out' }))
    await waitFor(() => {
      expect(sheet().getByText(/haven't synced yet\. Stay logged in and try again/)).toBeInTheDocument()
    })

    // …and closing the sheet returns to the same, fully usable dashboard.
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('Mary Wanjiku')).toBeInTheDocument()
    expect(screen.getAllByText('KSh 1,000').length).toBeGreaterThan(0)

    // Nothing disappeared: customer, entries and outbox all intact.
    expect(await getAllCustomers()).toHaveLength(1)
    expect(await countPendingOps()).toBe(2)
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument()
  })
})