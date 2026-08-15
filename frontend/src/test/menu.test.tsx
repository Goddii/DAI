/**
 * The hamburger navigation drawer:
 *   - the trigger is part of the authenticated shell
 *   - the drawer is a LEFT navigation drawer, not a BottomSheet/dialog
 *   - it contains ONLY the two destinations (Dashboard, Customers) — no
 *     account actions, no logout (those live on the account avatar)
 *   - the current route receives the active treatment
 *   - tapping a destination navigates and closes the drawer
 *   - Escape and the backdrop (mobile) close it
 *   - on md+ widths the application content is pushed, not covered
 *   - Customer Detail stays a child of Customers: no menu destination,
 *     back-to-Customers unchanged
 *
 * The api module is mocked; IndexedDB is real. The sync mock echoes `ok`
 * WITHOUT a balance so the derived local balance is never overwritten
 * mid-test (a mock artifact, not app behaviour).
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

/** Queries scoped to the open drawer's navigation landmark. */
function drawer() {
  return within(screen.getByRole('navigation', { name: 'Menu' }))
}

async function waitForDrawerClosed() {
  await waitFor(() => {
    expect(screen.queryByRole('navigation', { name: 'Menu' })).not.toBeInTheDocument()
  })
}

async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open menu' }))
  expect(drawer().getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
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

describe('hamburger navigation drawer', () => {
  it('is a left navigation drawer containing only the two destinations', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    const trigger = screen.getByRole('button', { name: 'Open menu' })
    expect(trigger).toBeInTheDocument()

    await user.click(trigger)
    expect(drawer().getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    expect(drawer().getByRole('link', { name: 'Customers' })).toBeInTheDocument()

    // Navigation only — no account actions, no logout, no modal/dialog.
    expect(screen.queryByRole('link', { name: /Account \/ Settings/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sign out|Log Out/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Focus moves into the drawer on open.
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveFocus()
  })

  it('marks the current destination as active', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    // On the dashboard, Dashboard is the active destination.
    await openDrawer(user)
    expect(drawer().getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    expect(drawer().getByRole('link', { name: 'Customers' })).not.toHaveAttribute('aria-current')
    await user.click(screen.getByRole('button', { name: 'Close menu' }))
    await waitForDrawerClosed()

    // After moving to Customers, the active marker moves with the route.
    await openDrawer(user)
    await user.click(drawer().getByRole('link', { name: 'Customers' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
    })

    await openDrawer(user)
    expect(drawer().getByRole('link', { name: 'Customers' })).toHaveAttribute('aria-current', 'page')
    expect(drawer().getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
  })

  it('navigates to Customers and closes the drawer', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await openDrawer(user)
    await user.click(drawer().getByRole('link', { name: 'Customers' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
      expect(screen.getByLabelText('Search customers')).toBeInTheDocument()
    })
    await waitForDrawerClosed()
    expect(screen.queryByText("Demo's Credit Book")).not.toBeInTheDocument()
  })

  it('navigates back to the Dashboard and closes the drawer', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await openDrawer(user)
    await user.click(drawer().getByRole('link', { name: 'Customers' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
    })

    await openDrawer(user)
    await user.click(drawer().getByRole('link', { name: 'Dashboard' }))

    await waitFor(() => {
      expect(screen.getByText("Demo's Credit Book")).toBeInTheDocument()
    })
    await waitForDrawerClosed()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await openDrawer(user)
    await user.keyboard('{Escape}')
    await waitForDrawerClosed()
  })

  it('closes when the backdrop is tapped (mobile overlay behaviour)', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await openDrawer(user)
    await user.click(screen.getByTestId('menu-backdrop'))
    await waitForDrawerClosed()
  })

  it('pushes the application content on desktop widths while open', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    const wrapper = screen.getByTestId('menu-push-wrapper')
    expect(wrapper).not.toHaveClass('md:pl-[300px]')

    await openDrawer(user)
    expect(wrapper).toHaveClass('md:pl-[300px]')

    await user.click(screen.getByRole('button', { name: 'Close menu' }))
    await waitForDrawerClosed()
    expect(wrapper).not.toHaveClass('md:pl-[300px]')
  })

  it('keeps logout exclusively on the account avatar', async () => {
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    await openDrawer(user)
    expect(screen.queryByRole('button', { name: /Sign out|Log Out/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close menu' }))
    await waitForDrawerClosed()

    // The account surface still owns identity, Settings and Log Out.
    await user.click(screen.getByRole('button', { name: 'Account' }))
    const sheet = within(screen.getByRole('dialog'))
    expect(sheet.getByText('Your account')).toBeInTheDocument()
    expect(sheet.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(sheet.getByRole('button', { name: 'Log Out' })).toBeInTheDocument()
  })

  it('does not surface Customer Detail as a destination and back still works', async () => {
    await seedCustomer('Mary Wanjiku')
    const user = userEvent.setup()
    render(<App />)
    await login(user)

    // Open the customer from the Customers list, as a trader normally would.
    await user.click(screen.getByRole('link', { name: /Customers/ }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
    })
    await user.click(screen.getByText('Mary Wanjiku'))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Mary Wanjiku' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument()
    })

    // The drawer stays available, but the detail page is not a destination.
    await openDrawer(user)
    expect(screen.queryByRole('link', { name: 'Mary Wanjiku' })).not.toBeInTheDocument()
    // Detail is a child of Customers, so Customers carries the active marker.
    expect(drawer().getByRole('link', { name: 'Customers' })).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('button', { name: 'Close menu' }))
    await waitForDrawerClosed()

    // The existing back-to-Customers behaviour is untouched.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
      expect(screen.getByLabelText('Search customers')).toBeInTheDocument()
    })
    expect(screen.queryByText("Demo's Credit Book")).not.toBeInTheDocument()
  })
})