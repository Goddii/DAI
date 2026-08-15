/**
 * Contextual back navigation from Customer Detail.
 *
 * The detail page's Back button must return to whichever screen the trader
 * actually opened the customer from — the Dashboard ("/") or the Customers
 * list ("/customers") — carried via router state, never browser history.
 * With no origin state (direct link, refresh), it falls back to "/customers".
 *
 * The api module is mocked; IndexedDB is real. The sync mock echoes `ok`
 * WITHOUT a balance so the derived local balance is never overwritten
 * mid-test (a mock artifact, not app behaviour).
 */

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

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

/** Seeds a local customer with a KSh 500 balance (as if used previously). */
async function seedCustomer(name = 'Mary Wanjiku'): Promise<string> {
  const { createCustomerLocal, recordCreditLocal } = await import('../lib/actions')
  const customer = await createCustomerLocal(name, null, null)
  await recordCreditLocal(customer.client_uuid, 50000, null)
  return customer.client_uuid
}

/** Waits for the customer DETAIL page to be the mounted screen. */
async function waitForDetail(name: string) {
  await waitFor(() => {
    expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument()
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

describe('contextual back from customer detail', () => {
  it('opens a customer from the Dashboard "Needs attention" list and back returns to the Dashboard', async () => {
    await seedCustomer('Mary Wanjiku')
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    // The seeded customer appears in "Needs attention".
    await waitFor(() => {
      expect(screen.getByText('Mary Wanjiku')).toBeInTheDocument()
    })
    await user.click(screen.getByText('Mary Wanjiku'))
    await waitForDetail('Mary Wanjiku')

    // Back returns to the Dashboard, not the Customers list.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => {
      expect(screen.getByText("Demo's Credit Book")).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: 'Customers' })).not.toBeInTheDocument()
  })

  it('opens a customer from the Customers list and back returns to the Customers list', async () => {
    await seedCustomer('Mary Wanjiku')
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await user.click(screen.getByRole('link', { name: /Customers/ }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
    })
    await user.click(screen.getByText('Mary Wanjiku'))
    await waitForDetail('Mary Wanjiku')

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
      expect(screen.getByLabelText('Search customers')).toBeInTheDocument()
    })
    // Not the dashboard.
    expect(screen.queryByText("Demo's Credit Book")).not.toBeInTheDocument()
  })

  it('falls back to /customers when there is no origin state (refresh / direct link)', async () => {
    const uuid = await seedCustomer('Mary Wanjiku')
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    // Simulate a refresh / deep link: navigate to the detail route with NO
    // router state (pushState + popstate — the browser-history equivalent).
    act(() => {
      window.history.pushState({}, '', `/customers/${uuid}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitForDetail('Mary Wanjiku')

    // No origin → the declared default: back lands on the Customers list.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
    })
  })

  it('adding a customer from the Dashboard, then back, returns to the Dashboard', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await user.click(screen.getAllByRole('button', { name: /add customer/i })[0])
    await user.type(sheet().getByLabelText('Name'), 'John Kamau')
    await user.click(sheet().getByRole('button', { name: 'Add Customer' }))
    await waitForDetail('John Kamau')

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => {
      expect(screen.getByText("Demo's Credit Book")).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: 'Customers' })).not.toBeInTheDocument()
  })

  it('adding a customer from the Customers page, then back, returns to the Customers list', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await user.click(screen.getByRole('link', { name: /Customers/ }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
    })
    await user.click(screen.getAllByRole('button', { name: /add customer/i })[0])
    await user.type(sheet().getByLabelText('Name'), 'John Kamau')
    await user.click(sheet().getByRole('button', { name: 'Add Customer' }))
    await waitForDetail('John Kamau')

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
      expect(screen.getByLabelText('Search customers')).toBeInTheDocument()
    })
    expect(screen.queryByText("Demo's Credit Book")).not.toBeInTheDocument()
  })
})
