import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LoginPage } from '../pages/LoginPage'
import { EmailVerificationPage } from '../pages/EmailVerificationPage'
import { AuthProvider } from '../store/AuthProvider'

const {
  requestPasswordReset,
  resetPassword,
  confirmEmailVerification,
  register,
} = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  confirmEmailVerification: vi.fn(),
  register: vi.fn(),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      requestPasswordReset,
      resetPassword,
      confirmEmailVerification,
      register,
    },
  }
})

function renderLogin(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => cleanup())

describe('password reset', () => {
  it('lets a user request a reset link', async () => {
    const user = userEvent.setup()
    requestPasswordReset.mockResolvedValue({
      message: 'If an account exists for that email, a password reset link will be sent.',
    })
    renderLogin()

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    await user.type(screen.getByLabelText('Email address'), 'trader@example.com')
    await user.click(screen.getByRole('button', { name: 'Send Reset Link' }))

    await waitFor(() => {
      expect(requestPasswordReset).toHaveBeenCalledWith('trader@example.com')
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'If an account exists for that email',
    )
  })

  it('accepts a reset link and changes the password', async () => {
    const user = userEvent.setup()
    resetPassword.mockResolvedValue({
      message: 'Your password has been reset. You can now log in.',
    })
    renderLogin('/?reset_token=one-time-token')

    await user.type(screen.getByLabelText('New password'), 'new-secret')
    await user.type(screen.getByLabelText('Confirm new password'), 'new-secret')
    await user.click(screen.getByRole('button', { name: 'Reset Password' }))

    await waitFor(() => {
      expect(resetPassword).toHaveBeenCalledWith('one-time-token', 'new-secret')
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your password has been reset',
    )
  })

  it('verifies a recovery email from its one-time link', async () => {
    const user = userEvent.setup()
    confirmEmailVerification.mockResolvedValue({
      message: 'Your recovery email is verified.',
    })
    render(
      <MemoryRouter initialEntries={['/?verify_email_token=email-token']}>
        <AuthProvider>
          <EmailVerificationPage />
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(screen.getByText('Your recovery email is verified.')).toBeInTheDocument(),
    )
    expect(confirmEmailVerification).toHaveBeenCalledWith('email-token')
    await user.click(screen.getByRole('button', { name: 'Back to Dai' }))
  })

  it('asks new signups for an optional recovery email', async () => {
    const user = userEvent.setup()
    register.mockResolvedValue({
      token: 'test-token',
      trader: { id: 1, name: 'Trader', phone: '0700000000', email: 'trader@example.com' },
    })
    renderLogin()

    await user.click(screen.getByRole('button', { name: 'New here? Create an account' }))
    expect(screen.getByLabelText('Email address (optional)')).toBeInTheDocument()
  })
})
