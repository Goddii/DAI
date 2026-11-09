import { useEffect, useState } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { Header } from '../components/layout/Header'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Skeleton } from '../components/ui/Skeleton'
import { getPendingOps, type OutboxOp } from '../lib/db'
import { formatKsh } from '../lib/money'
import { useAuth } from '../store/AuthProvider'
import { useSync } from '../store/SyncProvider'

export function SettingsPage() {
  const { trader } = useAuth()
  const { online, pendingCount, syncing, lastSyncAt, syncAll } = useSync()
  const [failedOps, setFailedOps] = useState<OutboxOp[]>([])
  const [busy, setBusy] = useState(false)
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailNotice, setEmailNotice] = useState<string | null>(null)

  useEffect(() => {
    void loadFailed()
  }, [pendingCount, online, syncing])

  useEffect(() => {
    setRecoveryEmail(trader?.email ?? '')
  }, [trader?.email])

  async function loadFailed() {
    const ops = await getPendingOps()
    setFailedOps(ops.filter((o) => o.status === 'error'))
  }

  async function retrySync() {
    setBusy(true)
    try {
      await syncAll()
      await loadFailed()
    } finally {
      setBusy(false)
    }
  }

  async function requestEmailVerification(e: React.FormEvent) {
    e.preventDefault()
    setEmailBusy(true)
    setEmailError(null)
    setEmailNotice(null)
    try {
      const { message } = await api.requestEmailVerification(
        recoveryEmail.trim(),
        currentPassword,
      )
      setEmailNotice(message)
      setCurrentPassword('')
    } catch (err) {
      setEmailError(
        err instanceof ApiError
          ? err.message
          : 'We could not update your recovery email. Please try again.',
      )
    } finally {
      setEmailBusy(false)
    }
  }

  return (
    <div className="min-h-dvh">
      <Header />

      <div className="space-y-6 px-4 pt-5">
        <h1 className="text-[22px] font-bold tracking-tight text-ink-950">Settings</h1>
        {/* Profile */}
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-400">Account</h2>
          {trader ? (
            <div className="mt-3 space-y-1">
              <p className="text-[17px] font-semibold text-ink-950">{trader.name}</p>
              <p className="tnum text-sm text-ink-500">{trader.phone}</p>
            </div>
          ) : (
            <Skeleton className="mt-3 h-10 w-48" />
          )}
        </section>

        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-400">
            Password recovery
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            {trader?.email_verified
              ? 'Your recovery email is verified.'
              : trader?.email
                ? 'Verify your email before it can be used to reset your password.'
                : 'Add and verify an email so you can reset your password if you forget it.'}
          </p>
          <form onSubmit={(e) => void requestEmailVerification(e)} className="mt-4 space-y-3">
            <Input
              label="Recovery email"
              type="email"
              value={recoveryEmail}
              onChange={(e) => setRecoveryEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
            <Input
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            {emailError ? (
              <p role="alert" className="rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger-700">
                {emailError}
              </p>
            ) : null}
            {emailNotice ? (
              <p role="status" className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
                {emailNotice}
              </p>
            ) : null}
            <Button type="submit" fullWidth disabled={emailBusy}>
              {emailBusy ? 'Please wait…' : 'Send verification link'}
            </Button>
          </form>
        </section>

        {/* Sync status — automatic; nothing for the trader to press here. */}
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-400">Syncing</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            Your credit book syncs on its own whenever you&apos;re online. You don&apos;t need to do anything.
          </p>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink-500">Connection</span>
              <Badge tone={online ? 'positive' : 'attention'}>{online ? 'Online' : 'Offline'}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-500">Waiting to sync</span>
              <span className="tnum font-semibold text-ink-950">{pendingCount}</span>
            </div>
            {lastSyncAt ? (
              <div className="flex items-center justify-between">
                <span className="text-ink-500">Last synced</span>
                <span className="tnum text-ink-700">{new Date(lastSyncAt).toLocaleTimeString('en-KE')}</span>
              </div>
            ) : null}
          </div>
        </section>

        {/* Failed operations — the only place a manual retry exists, and only
            when something actually needs the trader's attention. */}
        {failedOps.length > 0 ? (
          <section className="rounded-2xl border border-danger-100 bg-danger-50 p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-danger-700">
                Needs your attention
              </h2>
              <Button
                variant="danger"
                size="md"
                onClick={() => void retrySync()}
                disabled={busy || syncing || !online}
              >
                <RefreshCw size={15} className={syncing || busy ? 'animate-spin' : ''} aria-hidden="true" />
                {syncing || busy ? 'Retrying…' : 'Retry'}
              </Button>
            </div>
            <ul className="mt-3 space-y-3">
              {failedOps.map((op) => (
                <li key={op.client_uuid} className="flex items-start gap-2.5 text-sm">
                  <TriangleAlert size={16} className="mt-0.5 shrink-0 text-danger-600" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-danger-700">{opLabel(op)}</p>
                    <p className="mt-0.5 text-danger-700/90">{op.error}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] text-danger-700/80">
              Fix the issue (e.g. a payment larger than the balance), then tap Retry. Nothing is lost — these
              changes are still saved on this phone.
            </p>
          </section>
        ) : null}
      </div>
    </div>
  )
}

function opLabel(op: OutboxOp): string {
  const amount = typeof op.payload.amount_minor === 'number' ? formatKsh(op.payload.amount_minor) : ''
  switch (op.op) {
    case 'create_customer':
      return `Add customer "${String(op.payload.name ?? '')}"`
    case 'update_customer':
      return 'Update customer'
    case 'credit':
      return `Credit ${amount}`
    case 'payment':
      return `Payment ${amount}`
    case 'void':
      return 'Void transaction'
  }
}
