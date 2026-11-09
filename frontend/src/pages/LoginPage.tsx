import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../store/AuthProvider'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

type Mode = 'login' | 'register' | 'forgot' | 'reset'

const RESET_SENT_MESSAGE =
  'If an account exists for that email, a password reset link will be sent.'

export function LoginPage() {
  const { login, register } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const resetToken = searchParams.get('reset_token')
  const [mode, setMode] = useState<Mode>(() => (resetToken ? 'reset' : 'login'))
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function changeMode(nextMode: Mode) {
    setMode(nextMode)
    setError(null)
    setNotice(null)
    if (nextMode !== 'reset' && resetToken) {
      setSearchParams({}, { replace: true })
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    if (mode === 'forgot') {
      if (!email.trim()) {
        setError('Enter the email address on your account.')
        return
      }
      setBusy(true)
      try {
        const response = await api.requestPasswordReset(email.trim())
        setNotice(response.message || RESET_SENT_MESSAGE)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      } finally {
        setBusy(false)
      }
      return
    }

    if (mode === 'reset') {
      if (!resetToken) {
        setError('This reset link is invalid or has expired. Request a new one.')
        return
      }
      if (!password) {
        setError('Enter a new password.')
        return
      }
      if (password !== confirmPassword) {
        setError('The passwords do not match.')
        return
      }
      setBusy(true)
      try {
        const response = await api.resetPassword(resetToken, password)
        setSearchParams({}, { replace: true })
        setPassword('')
        setConfirmPassword('')
        setMode('login')
        setNotice(response.message)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      } finally {
        setBusy(false)
      }
      return
    }

    if (!phone.trim() || !password) {
      setError('Enter your phone number and password.')
      return
    }
    if (mode === 'register' && !name.trim()) {
      setError('Tell us your name (or your shop name).')
      return
    }
    setBusy(true)
    try {
      if (mode === 'register') {
        await register(name.trim(), phone.trim(), password, email.trim() || undefined)
      } else {
        await login(phone.trim(), password)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const heading =
    mode === 'register'
      ? 'Create your account'
      : mode === 'forgot'
        ? 'Forgot your password?'
        : mode === 'reset'
          ? 'Choose a new password'
          : 'Log in to Dai'

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <div className="bg-brand-900 pt-safe">
        <div className="mx-auto flex w-full max-w-[560px] flex-col items-center px-6 pb-12 pt-14 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-white">
            <BookOpen size={26} aria-hidden="true" />
          </div>
          <h1 className="text-[28px] font-bold tracking-tight text-white">Dai</h1>
          <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-brand-100">
            Your credit book. Who owes you money, and how much — answered in seconds.
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[560px] flex-1 px-6 pb-10">
        <form onSubmit={(e) => void submit(e)} className="space-y-4 pt-8">
          <h2 className="text-lg font-semibold text-ink-900">{heading}</h2>

          {mode === 'register' ? (
            <>
              <Input
                label="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Mama Sarah"
                autoComplete="name"
                required
              />
              <Input
                label="Email address (optional)"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                hint="Verify this email in Settings to use it for password resets."
              />
            </>
          ) : null}

          {mode === 'login' || mode === 'register' ? (
            <>
              <Input
                label="Phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 0722 123 456"
                inputMode="tel"
                autoComplete="tel"
                required
              />
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
              />
            </>
          ) : null}

          {mode === 'forgot' ? (
            <>
              <p className="text-sm leading-relaxed text-ink-600">
                Enter the email address linked to your account. We’ll send you a one-time reset link.
              </p>
              <Input
                label="Email address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </>
          ) : null}

          {mode === 'reset' ? (
            <>
              <p className="text-sm leading-relaxed text-ink-600">
                Your reset link works once and expires after 30 minutes.
              </p>
              <Input
                label="New password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                minLength={6}
                maxLength={128}
                required
              />
              <Input
                label="Confirm new password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                maxLength={128}
                required
              />
            </>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-xl bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-800">
              {notice}
            </p>
          ) : null}

          <Button type="submit" fullWidth disabled={busy}>
            {busy
              ? 'Please wait…'
              : mode === 'register'
                ? 'Create Account'
                : mode === 'forgot'
                  ? 'Send Reset Link'
                  : mode === 'reset'
                    ? 'Reset Password'
                    : 'Log In'}
          </Button>

          {mode === 'login' ? (
            <button
              type="button"
              onClick={() => changeMode('forgot')}
              className="w-full py-2 text-center text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              Forgot password?
            </button>
          ) : null}

          {mode === 'login' || mode === 'register' ? (
            <button
              type="button"
              onClick={() => changeMode(mode === 'login' ? 'register' : 'login')}
              className="w-full py-2 text-center text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Log in'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => changeMode('login')}
              className="w-full py-2 text-center text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              Back to Log In
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
