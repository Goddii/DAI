/**
 * Payment guard regression tests (the stale/empty-ledger bug).
 *
 * A customer hydrated via the summary endpoint (reconcileCustomers) has a
 * correct balance_minor but NO local ledger entries until reconcileLedger()
 * runs — which used to happen only on CustomerDetailPage. Recording a
 * payment from the Dashboard's global button then validated against an
 * empty entries store and falsely failed with "{name} doesn't owe anything
 * right now", while the sheet showed the real balance above.
 *
 * The guard now reconciles the ledger before validating (online), and
 * refuses to guess when the balance can't be verified (offline, no local
 * entries) instead of falsely approving or rejecting.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

/** Server state: one summary-hydrated customer with KSh 1,000 outstanding. */
const MARY = {
  id: 11,
  client_uuid: 'c-11111111-1111-4111-8111-111111111111',
  name: 'Mary Wanjiku',
  phone: '0722 123 456',
  notes: null,
  balance_minor: 100000,
  created_at: '2026-08-10T08:00:00Z',
}

/** Her ledger, as the server would return it for id 11. */
const MARY_LEDGER = {
  customer: MARY,
  balance_minor: 100000,
  entries: [
    {
      id: 101,
      client_uuid: 'e-11111111-1111-4111-8111-111111111111',
      type: 'CREDIT',
      amount_minor: 100000,
      payment_method: null,
      note: 'Stock',
      voided: false,
      void_reason: null,
      created_at: '2026-08-10T09:00:00Z',
    },
  ],
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
      dashboard: vi.fn(async () => ({
        total_owed_minor: 0,
        customers_owing: 0,
        total_customers: 0,
        top_customers: [],
      })),
      // Base: no server customers. Tests that need hydration override the
      // FIRST call with mockResolvedValueOnce so the post-payment reconcile
      // (which would echo a stale balance) cannot clobber the local result.
      listCustomers: vi.fn(async () => ({ customers: [], total_owed_minor: 0 })),
      getLedger: vi.fn(async (id: number) => {
        if (id !== 11) throw new Error(`unexpected getLedger(${id})`)
        return MARY_LEDGER
      }),
      sync: vi.fn(async (operations: Record<string, unknown>[]) => ({
        results: operations.map((op) => ({
          client_uuid: op.client_uuid,
          status: 'ok' as const,
          server_id: 1,
          // No balance echoed — the derived local balance is the truth here.
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

/** Hydrate Mary via the summary endpoint (the bug's precondition), then wait. */
async function loginWithHydratedMary(user: ReturnType<typeof userEvent.setup>) {
  const { api } = await import('../lib/api')
  vi.mocked(api.listCustomers).mockResolvedValueOnce({
    customers: [MARY],
    total_owed_minor: 100000,
  })
  render(<App />)
  await login(user)
  await waitFor(() => {
    expect(screen.getByText('Mary Wanjiku')).toBeInTheDocument()
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

describe('payment guard: ledger reconciled before validating', () => {
  it('records a payment from the Dashboard global button on a summary-hydrated customer (the reported bug)', async () => {
    const user = userEvent.setup()
    await loginWithHydratedMary(user)

    // Open the GLOBAL payment sheet (not via the customer's detail page).
    await user.click(screen.getByRole('button', { name: 'Record Payment' }))
    await user.selectOptions(sheet().getByRole('combobox'), MARY.client_uuid)

    // The sheet shows the real balance from the summary…
    expect(sheet().getByText('KSh 1,000')).toBeInTheDocument()

    // …and the payment goes through: the guard pulls the ledger first.
    await user.type(sheet().getByLabelText('Amount'), '500')
    await user.click(sheet().getByRole('button', { name: 'Record Payment' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    const { api } = await import('../lib/api')
    expect(vi.mocked(api.getLedger)).toHaveBeenCalledWith(11)

    // Dashboard reflects the new balance — no false "doesn't owe anything".
    await waitFor(() => {
      expect(screen.getAllByText('KSh 500').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText(/doesn't owe anything/i)).not.toBeInTheDocument()
  })

  it('shows an honest "can\'t verify" message offline with no local entries — not a false rejection or approval', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    // Seed the summary-hydrated customer directly (offline hydration can't run).
    const { saveCustomer } = await import('../lib/db')
    await saveCustomer({
      client_uuid: MARY.client_uuid,
      name: MARY.name,
      phone: MARY.phone,
      notes: null,
      server_id: MARY.id,
      created_at: MARY.created_at,
      updated_at: MARY.created_at,
      balance_minor: MARY.balance_minor,
      synced: true,
    })
    // Offline: the ledger pull fails (one-shot so the base mock is restored
    // for later tests in this file).
    const { api } = await import('../lib/api')
    vi.mocked(api.getLedger).mockRejectedValueOnce(new Error('offline'))

    const user = userEvent.setup()
    render(<App />)
    await login(user)
    await waitFor(() => {
      expect(screen.getByText('Mary Wanjiku')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Record Payment' }))
    await user.selectOptions(sheet().getByRole('combobox'), MARY.client_uuid)
    await user.type(sheet().getByLabelText('Amount'), '500')
    await user.click(sheet().getByRole('button', { name: 'Record Payment' }))

    // The honest message, not the misleading zero-balance one.
    await waitFor(() => {
      expect(sheet().getByText(/can't verify this customer's balance/i)).toBeInTheDocument()
    })
    expect(sheet().queryByText(/doesn't owe anything/i)).not.toBeInTheDocument()
    // Nothing was recorded (no silent approval).
    const { countPendingOps } = await import('../lib/db')
    expect(await countPendingOps()).toBe(0)
  })

  it('recording a payment from the customer detail page still works (existing path)', async () => {
    const user = userEvent.setup()
    await loginWithHydratedMary(user)

    // Open Mary from the dashboard (detail page reconciles her ledger).
    await user.click(screen.getByText('Mary Wanjiku'))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Payment' }))
    await user.type(sheet().getByLabelText('Amount'), '300')
    await user.click(sheet().getByRole('button', { name: 'Record Payment' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    // 1,000 − 300 = 700.
    await waitFor(() => {
      expect(screen.getAllByText('KSh 700').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText(/doesn't owe anything/i)).not.toBeInTheDocument()
  })
})
