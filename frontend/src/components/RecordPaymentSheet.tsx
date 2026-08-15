import { useEffect, useMemo, useState } from 'react'
import { Check, HandCoins } from 'lucide-react'
import { recordPaymentLocal } from '../lib/actions'
import { ApiError } from '../lib/api'
import { formatKsh, parseAmountToMinor } from '../lib/money'
import { useSync } from '../store/SyncProvider'
import { AmountInput } from './ui/AmountInput'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Chip } from './ui/Chip'

interface RecordPaymentSheetProps {
  open: boolean
  onClose: () => void
  /** When set, the customer is fixed; otherwise the trader picks one. */
  customerClientUuid?: string
  onRecorded?: () => void
}

const METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'MPESA', label: 'M-Pesa' },
  { value: 'OTHER', label: 'Other' },
] as const

export function RecordPaymentSheet({ open, onClose, customerClientUuid, onRecorded }: RecordPaymentSheetProps) {
  const { customers, reloadLocal, scheduleSync } = useSync()
  const [customerUuid, setCustomerUuid] = useState(customerClientUuid ?? '')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'CASH' | 'MPESA' | 'OTHER'>('CASH')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (open) {
      setCustomerUuid(customerClientUuid ?? '')
      setAmount('')
      setMethod('CASH')
      setError(null)
      setSaving(false)
      setDone(false)
    }
  }, [open, customerClientUuid])

  const selected = customers.find((c) => c.client_uuid === customerUuid)
  const outstanding = selected?.balance_minor ?? 0

  const canQuickPay = useMemo(
    () => outstanding > 0 && selected !== undefined,
    [outstanding, selected],
  )

  async function submit(presetAmount?: number) {
    if (!customerUuid) {
      setError('Choose a customer first.')
      return
    }
    const amountMinor = presetAmount ?? parseAmountToMinor(amount)
    if (amountMinor === null || amountMinor <= 0) {
      setError('Enter the amount, e.g. 500')
      return
    }
    if (amountMinor > outstanding) {
      setError(`That payment is more than what's owed (${formatKsh(outstanding)}).`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await recordPaymentLocal(customerUuid, amountMinor, method, null)
      setDone(true)
      await reloadLocal()
      scheduleSync()
      onRecorded?.()
      setTimeout(onClose, 700)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Record Payment">
      <div className="space-y-5">
        {selected ? (
          <div className="flex items-center justify-between rounded-xl bg-canvas px-4 py-3">
            <div>
              <p className="text-sm text-ink-500">Receiving from</p>
              <p className="text-[15px] font-semibold text-ink-950">{selected.name}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-ink-500">Owes you</p>
              <p className="tnum text-[15px] font-bold text-ink-950">{formatKsh(outstanding)}</p>
            </div>
          </div>
        ) : (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">Customer</label>
            <select
              value={customerUuid}
              onChange={(e) => setCustomerUuid(e.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-base text-ink-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
            >
              <option value="">Choose a customer…</option>
              {customers.map((c) => (
                <option key={c.client_uuid} value={c.client_uuid}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-2">
          {canQuickPay && (
            <button
              type="button"
              onClick={() => void submit(outstanding)}
              className="tnum flex-1 rounded-xl border border-positive-100 bg-positive-50 px-3 py-3 text-center text-[15px] font-semibold text-positive-700 transition-colors hover:bg-positive-100 active:bg-positive-100"
            >
              Pay all · {formatKsh(outstanding)}
            </button>
          )}
        </div>

        <AmountInput
          value={amount}
          onChange={(v) => {
            setAmount(v)
            setError(null)
          }}
          error={error}
          autoFocus
        />

        <div>
          <p className="mb-1.5 text-sm font-medium text-ink-700">Payment method</p>
          <div className="flex gap-2">
            {METHODS.map((m) => (
              <Chip key={m.value} selected={method === m.value} onClick={() => setMethod(m.value)}>
                {m.label}
              </Chip>
            ))}
          </div>
        </div>

        {done ? (
          <div className="flex items-center justify-center gap-2 rounded-xl bg-positive-50 py-3.5 text-[15px] font-semibold text-positive-700">
            <Check size={18} aria-hidden="true" />
            Payment saved
          </div>
        ) : (
          <Button fullWidth onClick={() => void submit()} disabled={saving || !customerUuid}>
            {saving ? 'Saving…' : 'Record Payment'}
          </Button>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2 text-center text-sm font-medium text-ink-500 hover:text-ink-700"
        >
          Cancel
        </button>
      </div>
    </BottomSheet>
  )
}

export function RecordPaymentButton({
  onClick,
}: {
  onClick: () => void
}) {
  return (
    <Button variant="secondary" onClick={onClick} fullWidth>
      <HandCoins size={20} aria-hidden="true" />
      Record Payment
    </Button>
  )
}
