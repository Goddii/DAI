import { useMemo, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, RotateCcw } from 'lucide-react'
import { voidEntryLocal } from '../lib/actions'
import { ApiError } from '../lib/api'
import { type LocalEntry } from '../lib/db'
import { formatKsh } from '../lib/money'
import { Badge } from './ui/Badge'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

interface TransactionHistoryProps {
  entries: LocalEntry[]
  onChanged: () => void
}

function dayLabel(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = startOf(today) - startOf(date)
  if (diff === 0) return 'Today'
  if (diff === 86_400_000) return 'Yesterday'
  return date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function TransactionHistory({ entries, onChanged }: TransactionHistoryProps) {
  const [voiding, setVoiding] = useState<LocalEntry | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const grouped = useMemo(() => {
    const groups: { label: string; entries: LocalEntry[] }[] = []
    for (const entry of entries) {
      const label = dayLabel(entry.created_at)
      const last = groups[groups.length - 1]
      if (last && last.label === label) last.entries.push(entry)
      else groups.push({ label, entries: [entry] })
    }
    return groups
  }, [entries])

  // Balance after each entry, walking the history oldest → newest (voided
  // entries are skipped, matching the derived balance). Rendered as a muted
  // secondary line so the settled-then-new-credit story is easy to follow.
  const balanceAfter = useMemo(() => {
    const map = new Map<string, number>()
    let run = 0
    for (const entry of [...entries].reverse()) {
      if (!entry.voided) run += entry.type === 'CREDIT' ? entry.amount_minor : -entry.amount_minor
      map.set(entry.client_uuid, run)
    }
    return map
  }, [entries])

  async function confirmVoid() {
    if (!voiding) return
    setBusy(true)
    setError(null)
    try {
      await voidEntryLocal(voiding.client_uuid, reason.trim() || null)
      setVoiding(null)
      setReason('')
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not void. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (entries.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-500">
        No transactions yet. Record the first credit above.
      </p>
    )
  }

  return (
    <div>
      {grouped.map((group) => (
        <section key={group.label} className="mb-6">
          <h3 className="px-4 pb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-400">
            {group.label}
          </h3>
          <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
            {group.entries.map((entry) => (
              <li
                key={entry.client_uuid}
                className={`flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0 ${
                  entry.voided ? 'opacity-55' : ''
                }`}
              >
                <span
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    entry.type === 'CREDIT' ? 'bg-brand-50 text-brand-700' : 'bg-positive-50 text-positive-700'
                  }`}
                  aria-hidden="true"
                >
                  {entry.type === 'CREDIT' ? (
                    <ArrowUpCircle size={20} />
                  ) : (
                    <ArrowDownCircle size={20} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[15px] font-semibold text-ink-950">
                      {entry.type === 'CREDIT' ? 'Credit' : 'Payment'}
                    </p>
                    {entry.payment_method && entry.type === 'PAYMENT' ? (
                      <Badge tone="neutral">{paymentMethodLabel(entry.payment_method)}</Badge>
                    ) : null}
                    {entry.voided ? <Badge tone="neutral">Voided</Badge> : null}
                  </div>
                  {entry.note ? (
                    <p className="mt-0.5 truncate text-[14px] text-ink-500">{entry.note}</p>
                  ) : null}
                  {entry.voided && entry.void_reason ? (
                    <p className="mt-0.5 text-[13px] italic text-ink-400">Voided: {entry.void_reason}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <div className="text-right">
                    <p
                      className={`tnum text-[15px] font-bold ${
                        entry.type === 'CREDIT' ? 'text-ink-950' : 'text-positive-700'
                      }`}
                    >
                      {entry.type === 'CREDIT' ? '+' : '\u2212'}
                      {formatKsh(entry.amount_minor)}
                    </p>
                    <p className="tnum mt-0.5 text-[12px] text-ink-400">
                      Balance {formatKsh(balanceAfter.get(entry.client_uuid) ?? 0)}
                    </p>
                  </div>
                  {!entry.voided ? (
                    <button
                      type="button"
                      aria-label={`Void this ${entry.type.toLowerCase()}`}
                      onClick={() => setVoiding(entry)}
                      className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600"
                    >
                      <RotateCcw size={16} />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <BottomSheet open={voiding !== null} onClose={() => setVoiding(null)} title="Void Transaction">
        {voiding ? (
          <div className="space-y-5">
            <p className="text-[15px] leading-relaxed text-ink-700">
              Voiding this {voiding.type === 'CREDIT' ? 'credit' : 'payment'} of{' '}
              <span className="font-semibold text-ink-950">{formatKsh(voiding.amount_minor)}</span>{' '}
              removes it from the balance. It stays in the history, marked as voided.
            </p>
            <Input
              label="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Wrong amount"
            />
            {error ? (
              <p role="alert" className="rounded-xl bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700">
                {error}
              </p>
            ) : null}
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setVoiding(null)} className="flex-1">
                Keep It
              </Button>
              <Button variant="danger" onClick={() => void confirmVoid()} disabled={busy} className="flex-1">
                {busy ? 'Voiding…' : 'Void Transaction'}
              </Button>
            </div>
          </div>
        ) : null}
      </BottomSheet>
    </div>
  )
}

function paymentMethodLabel(method: string): string {
  const map: Record<string, string> = { CASH: 'Cash', MPESA: 'M-Pesa', OTHER: 'Other' }
  return map[method] ?? method
}
