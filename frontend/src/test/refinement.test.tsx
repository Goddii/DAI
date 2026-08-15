/**
 * Refinement pass #2 — the natural market-trader flows:
 *   A. Add a customer who already owes money, in one interaction.
 *   B. A returning customer records more credit in seconds.
 *   C/D. Partial payment, then full settlement ("Paid · settled").
 *   E. New credit after settlement — the history tells the story.
 *   F. Back navigation returns to the Customers list, not browser history.
 *
 * The api module is mocked; IndexedDB is real, so offline-first holds. The
 * sync mock echoes `ok` WITHOUT a balance so the derived local balance is
 * never overwritten mid-test (a mock artifact, not app behaviour).
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

/** Queries scoped to the open bottom sheet (dialog). */
function sheet() {
  const dialog = screen.getByRole('dialog')
  return within(dialog)
}

/** Waits until the sheet (and its "saved" confirmation) has closed. */
async function waitForSheetClosed() {
  await waitFor(
    () => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
    { timeout: 4000 },
  )
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

/** Adds a customer from the dashboard and waits for the DETAIL page to
 * mount — the name as a page heading plus the History heading are
 * detail-only, so this can't resolve against the dashboard underneath. */
async function addCustomer(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  initialAmount = '',
) {
  await user.click(screen.getAllByRole('button', { name: /add customer/i })[0])
  await user.type(sheet().getByLabelText('Name'), name)
  if (initialAmount !== '') {
    await user.type(sheet().getByLabelText('Already owes you (optional)'), initialAmount)
  }
  await user.click(sheet().getByRole('button', { name: 'Add Customer' }))
  await waitFor(() => {
    expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument()
  })
}

/** Records a credit/payment on the current customer detail page. */
async function recordAmount(
  user: ReturnType<typeof userEvent.setup>,
  action: 'Credit' | 'Payment',
  amount: string,
) {
  await user.click(screen.getByRole('button', { name: action }))
  await user.type(sheet().getByLabelText('Amount'), amount)
  await user.click(sheet().getByRole('button', { name: `Record ${action}` }))
  await waitForSheetClosed()
}

beforeEach(async () => {
  localStorage.clear()
  vi.clearAllMocks()
  window.history.pushState({}, '', '/')
  const { clearAllLocalData } = await import('../lib/db')
  await clearAllLocalData()
})

afterEach(() => {
  cleanup()
})

describe('add customer with an existing debt', () => {
  it('Scenario A: one interaction — name + already owes KSh 2,000', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await addCustomer(user, 'John Kamau', '2000')

    // Balance is seeded immediately from the ledger credit.
    expect(screen.getByText('KSh 2,000')).toBeInTheDocument()
    expect(screen.getByText('Outstanding balance')).toBeInTheDocument()

    // The initial amount is a proper credit in the history.
    await waitFor(() => {
      expect(screen.getByText('History')).toBeInTheDocument()
    })
    expect(screen.getAllByText('Credit').length).toBeGreaterThan(0)
    expect(screen.getByText('+KSh 2,000')).toBeInTheDocument()
    // Running balance line makes the ledger explicit.
    expect(screen.getByText('Balance KSh 2,000')).toBeInTheDocument()
  })

  it('creates only the customer when the initial amount is left empty', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await addCustomer(user, 'Mama Fruits')

    expect(screen.getByText('KSh 0')).toBeInTheDocument()
    expect(screen.getByText('Paid · settled')).toBeInTheDocument()
    expect(screen.getByText(/No transactions yet/)).toBeInTheDocument()
  })
})

describe('settle, then new credit — the full relationship', () => {
  it(
    'Scenarios C–E: partial payment, settlement, then fresh credit',
    async () => {
      const user = userEvent.setup()
      render(<App />)
      await login(user)

    // Owe KSh 2,400 from the start.
    await addCustomer(user, 'Peter Otieno', '2400')
    expect(screen.getByText('KSh 2,400')).toBeInTheDocument()

    // Partial payment of KSh 1,200 → 1,200.
    await recordAmount(user, 'Payment', '1200')
    await waitFor(() => {
      expect(screen.getByText('KSh 1,200')).toBeInTheDocument()
    })

    // Full payment → settled.
    await recordAmount(user, 'Payment', '1200')
    await waitFor(() => {
      expect(screen.getByText('KSh 0')).toBeInTheDocument()
      expect(screen.getByText('Paid · settled')).toBeInTheDocument()
    })

    // The settling payment shows the moment the balance hit zero.
    expect(screen.getAllByText('Balance KSh 0').length).toBeGreaterThan(0)

    // New credit after settlement → KSh 400.
    await recordAmount(user, 'Credit', '400')
    await waitFor(() => {
      expect(screen.getByText('KSh 400')).toBeInTheDocument()
    })

    // History reads the story top-down: new credit (400), the payment that
    // settled (0), the earlier payment (1,200), the original debt (2,400).
    const balances = screen.getAllByText(/^Balance KSh /).map((el) => el.textContent)
    expect(balances.slice(0, 2)).toEqual(['Balance KSh 400', 'Balance KSh 0'])
    expect(screen.getByText('+KSh 400')).toBeInTheDocument()
    // Both KSh 1,200 payments render (amount rows) plus the running balance.
    expect(screen.getAllByText(/KSh 1,200/).length).toBeGreaterThanOrEqual(2)
      expect(screen.getByText('+KSh 2,400')).toBeInTheDocument()
    },
    20000,
  )
})

describe('navigation', () => {
  it('back from customer detail returns to the Customers list when opened from there', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    // Add the customer from the CUSTOMERS page, so the origin is /customers.
    await user.click(screen.getByRole('link', { name: /Customers/ }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
    })
    await user.click(screen.getAllByRole('button', { name: /add customer/i })[0])
    await user.type(sheet().getByLabelText('Name'), 'Mary Wanjiku')
    await user.type(sheet().getByLabelText('Already owes you (optional)'), '500')
    await user.click(sheet().getByRole('button', { name: 'Add Customer' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Mary Wanjiku' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument()
    })

    // Back returns to the declared origin (/customers), not browser history.
    await user.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
      expect(screen.getByLabelText('Search customers')).toBeInTheDocument()
    })
    // Not the dashboard.
    expect(screen.queryByText("Demo's Credit Book")).not.toBeInTheDocument()
  })
})
