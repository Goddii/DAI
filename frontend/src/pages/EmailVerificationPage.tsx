import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { Button } from '../components/ui/Button'
import { useAuth } from '../store/AuthProvider'

export function EmailVerificationPage() {
  const { trader, refreshTrader } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('verify_email_token')
  const handledToken = useRef<string | null>(null)
  const [busy, setBusy] = useState(Boolean(token))
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!token || handledToken.current === token) return
    handledToken.current = token
    setBusy(true)
    void api
      .confirmEmailVerification(token)
      .then(async ({ message }) => {
        setNotice(message)
        setSearchParams({}, { replace: true })
        if (trader) {
          try {
            await refreshTrader()
          } catch {
            setNotice(`${message} Reload Dai to refresh your account status.`)
          }
        }
      })
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError
            ? err.message
            : 'We could not verify this email. Please try again.',
        )
        setSearchParams({}, { replace: true })
      })
      .finally(() => setBusy(false))
  }, [token, trader, refreshTrader, setSearchParams])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-[440px] rounded-2xl border border-line bg-surface p-6 text-center">
        <h1 className="text-xl font-bold text-ink-950">Recovery email</h1>
        {busy ? (
          <p role="status" className="mt-4 text-sm text-ink-600">
            Verifying your email…
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-4 rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger-700">
            {error}
          </p>
        ) : null}
        {!busy ? (
          <Button className="mt-5" fullWidth onClick={() => navigate('/')}>
            Back to Dai
          </Button>
        ) : null}
      </div>
    </div>
  )
}
