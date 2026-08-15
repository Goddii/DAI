/**
 * Regression tests for the initial-hydration bug:
 *
 *   After login on a fresh browser (empty IndexedDB, empty outbox), the
 *   dashboard showed "KSh 0 / 0 customers / You're all clear" even though the
 *   server had customers — and only a mutation (add customer) triggered the
 *   server pull that made existing records appear.
 *
 * Root cause: syncNow() returned early when the outbox was empty, skipping
 * reconcileCustomers() — an empty outbox means "nothing to upload", NOT
 * "nothing to download".
 *
 * These tests lock in the required behaviour:
 *   - online + empty local + empty outbox  → server data is hydrated on login
 *   - online + empty account              → genuine empty state still shows
 *   - offline + empty local               → NOT "You're all clear" (unverified)
 *   - existing local + newer server       → merge, no duplicates
 *   - mutation after hydration            → no duplication
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

/** Server state: 4 customers with real balances and history. */
const SERVER_CUSTOMERS = [
  {
    id: 11,
    client_uuid: 'c-11111111-1111-4111-8111-111111111111',
    name: 'Mary Wanjiku',
    phone: '0722 111 111',
    notes: null,
    balance_minor: 125000,
    created_at: '2026-08-10T08:00:00Z',
  },
  {
    id: 12,
    client_uuid: 'c-22222222-2222-4222-8222-222222222222',
    name: 'John Kamau',
    phone: null,
    notes: 'Kiosk near the gate',
    balance_minor: 380000,
    created_at: '2026-08-11T08:00:00Z',
  },
  {
    id: 13,
    client_uuid: 'c-33333333-3333-4333-8333-333333333333',
    name: 'Peter Otieno',
    phone: '0733 333 333',
    notes: null,
    balance_minor: 245000,
    created_at: '2026-08-12T08:00:00Z',
  },
  {
    id: 14,
    client_uuid: 'c-44444444-4444-4444-8444-444444444444',
    name: 'Mama Fruits',
    phone: null,
    notes: null,
    balance_minor: 0,
    created_at: '2026-08-13T08:00:00Z',
  },
]

const LEDGER_BY_ID: Record<number, unknown> = {
  11: {
    customer: SERVER_CUSTOMERS[0],
    balance_minor: 125000,
    entries: [
      {
        id: 101,
        client_uuid: 'e-11111111-1111-4111-8111-111111111111',
        type: 'CREDIT',
        amount_minor: 85000,
        payment_method: null,
        note: 'Tomatoes + onions',
        voided: false,
        void_reason: null,
        created_at: '2026-08-10T09:00:00Z',
      },
      {
        id: 102,
        client_uuid: 'e-22222222-2222-4222-8222-222222222222',
        type: 'CREDIT',
        amount_minor: 40000,
        payment_method: null,
        note: 'Vegetables',
        voided: false,
        void_reason: null,
        created_at: '2026-08-12T09:00:00Z',
      },
    ],
  },
}

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
      dashboard: vi.fn(async () => ({ total_owed_minor: 0, customers_owing: 0, total_customers: 0, top_customers: [] })),
      listCustomers: vi.fn(async () => ({ customers: SERVER_CUSTOMERS, total_owed_minor: 750000 })),
      getLedger: vi.fn(async (id: number) => {
        const data = LEDGER_BY_ID[id]
        if (!data) throw new Error(`unexpected getLedger(${id})`)
        return data
      }),
      sync: vi.fn(async (operations: Record<string, unknown>[]) => ({
        results: operations.map((op) => ({ client_uuid: op.client_uuid, status: 'ok' as const, server_id: 1 })),
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
  window.history.pushState({}, '', '/')
  const { clearAllLocalData } = await import('../lib/db')
  await clearAllLocalData()
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
})

afterEach(() => {
  cleanup()
})

describe('initial server hydration (empty local store, online)', () => {
  it('pulls existing customers into the dashboard on login — no mutation needed', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    // Dashboard hydrates from the server: correct total (1250+3800+2450).
    await waitFor(() => {
      expect(screen.getByText('KSh 7,500')).toBeInTheDocument()
    })
    // The count is a <span> inside the same <p> as its label (JSX strips the
    // whitespace between them; the flex gap provides the visual spacing).
    const countLine = screen.getByText('customers owe you')
    expect(countLine.textContent).toMatch(/^3\s*customers owe you$/)
    expect(screen.queryByText("You're all clear")).not.toBeInTheDocument()

    // The customer list has all server customers.
    await user.click(screen.getByRole('link', { name: /Customers/ }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
    })
    for (const c of SERVER_CUSTOMERS) {
      expect(screen.getByText(c.name)).toBeInTheDocument()
    }
  })

  it('imports server transaction history when a customer is opened', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    // Wait for hydration, then open Mary Wanjiku's detail page.
    await waitFor(() => {
      expect(screen.getByText('KSh 7,500')).toBeInTheDocument()
    })
    await user.click(screen.getByText('Mary Wanjiku'))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Mary Wanjiku' })).toBeInTheDocument()
      expect(screen.getByText('History')).toBeInTheDocument()
    })
    // Her ledger was pulled from the server.
    await waitFor(() => {
      expect(screen.getByText('+KSh 850')).toBeInTheDocument()
      expect(screen.getByText('Tomatoes + onions')).toBeInTheDocument()
    })
  })
})

describe('empty-state honesty', () => {
  it('offline with no local data does NOT claim the account is empty', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await waitFor(() => {
      expect(screen.getByText("Demo's Credit Book")).toBeInTheDocument()
    })
    // Once loaded, the dashboard must NOT say "You're all clear" — the
    // account hasn't been verified. It says records will appear online.
    await waitFor(() => {
      expect(screen.queryByText("You're all clear")).not.toBeInTheDocument()
      expect(screen.getByText(/back online/)).toBeInTheDocument()
    })
  })

  it('a genuinely empty account (verified online) still shows the empty state', async () => {
    // This test overrides the module mock's listCustomers for this test only
    // via vi.mocked — a fresh import of the mocked api returns the empty list.
    const { api } = await import('../lib/api')
    vi.mocked(api.listCustomers).mockResolvedValueOnce({ customers: [], total_owed_minor: 0 })

    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await waitFor(() => {
      expect(screen.getByText('KSh 0')).toBeInTheDocument()
      expect(screen.getByText("You're all clear")).toBeInTheDocument()
    })
  })
})

describe('merge correctness', () => {
  it('existing local data + newer server data merges without duplicates', async () => {
    // Seed a local customer + credit (as if previously used on this device).
    const { createCustomerLocal, recordCreditLocal } = await import('../lib/actions')
    const local = await createCustomerLocal('Local Only Customer', null, null)
    await recordCreditLocal(local.client_uuid, 200000, null) // local balance 2,000

    // The server ALSO has this customer — with newer data (balance 2,500).
    // Reconcile must merge (server authoritative for balance), not duplicate.
    const { api } = await import('../lib/api')
    vi.mocked(api.listCustomers).mockResolvedValueOnce({
      customers: [
        ...SERVER_CUSTOMERS,
        {
          id: 99,
          client_uuid: local.client_uuid,
          name: 'Local Only Customer',
          phone: null,
          notes: 'Updated on another phone',
          balance_minor: 250000,
          created_at: '2026-08-13T08:00:00Z',
        },
      ],
      total_owed_minor: 1000000,
    })

    const user = userEvent.setup()
    render(<App />)
    await login(user)

    // 1250+3800+2450 (server) + 2500 (merged local, server's newer balance).
    await waitFor(() => {
      expect(screen.getByText('KSh 10,000')).toBeInTheDocument()
    })

    // No duplicates: 5 customers (4 + the merged one), each appearing once.
    const { getAllCustomers } = await import('../lib/db')
    const all = await getAllCustomers()
    expect(all).toHaveLength(5)
    const names = all.map((c) => c.name)
    expect(names.filter((n) => n === 'Mary Wanjiku')).toHaveLength(1)
    expect(names.filter((n) => n === 'Local Only Customer')).toHaveLength(1)
    const merged = all.find((c) => c.name === 'Local Only Customer')
    expect(merged?.balance_minor).toBe(250000)
    expect(merged?.synced).toBe(true)
  })

  it('adding a customer after hydration keeps existing records and adds no duplicates', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await waitFor(() => {
      expect(screen.getByText('KSh 7,500')).toBeInTheDocument()
    })

    await user.click(screen.getAllByRole('button', { name: /add customer/i })[0])
    await user.type(sheet().getByLabelText('Name'), 'New Customer')
    await user.type(sheet().getByLabelText('Already owes you (optional)'), '1000')
    await user.click(sheet().getByRole('button', { name: 'Add Customer' }))

    // Lands on the new customer's detail page.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New Customer' })).toBeInTheDocument()
      expect(screen.getByText('KSh 1,000')).toBeInTheDocument()
    })

    const { getAllCustomers } = await import('../lib/db')
    const all = await getAllCustomers()
    expect(all).toHaveLength(5) // 4 server + 1 new — no duplicates
    const names = all.map((c) => c.name)
    expect(names.filter((n) => n === 'Mary Wanjiku')).toHaveLength(1)
  })
})
