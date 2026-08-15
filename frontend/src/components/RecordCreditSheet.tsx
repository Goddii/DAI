import { useEffect, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { recordCreditLocal } from '../lib/actions'
import { ApiError } from '../lib/api'
import { parseAmountToMinor } from '../lib/money'
import { useSync } from '../store/SyncProvider'
import { AmountInput } from './ui/AmountInput'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Textarea } from './ui/Input'

interface RecordCreditSheetProps {
  open: boolean
  onClose: () => void
  /** When set, the customer is fixed; otherwise the trader picks one. */
  customerClientUuid?: string
  onRecorded?: () => void
}

export function RecordCreditSheet({ open, onClose, customerClientUuid, onRecorded }: RecordCreditSheetProps) {
  const { customers, reloadLocal, scheduleSync } = useSync()
  const [customerUuid, setCustomerUuid] = useState(customerClientUuid ?? '')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (open) {
      setCustomerUuid(customerClientUuid ?? '')
      setAmount('')
      setNote('')
      setError(null)
      setSaving(false)
      setDone(false)
    }
  }, [open, customerClientUuid])

  async function submit() {
    if (!customerUuid) {
      setError('Choose a customer first.')
      return
    }
    const amountMinor = parseAmountToMinor(amount)
    if (amountMinor === null || amountMinor <= 0) {
      setError('Enter the amount, e.g. 850')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await recordCreditLocal(customerUuid, amountMinor, note.trim() || null)
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

  const selected = customers.find((c) => c.client_uuid === customerUuid)

  return (
    <BottomSheet open={open} onClose={onClose} title="Record Credit">
      <div className="space-y-5">
        {selected ? (
          <p className="text-[15px] text-ink-700">
            Credit for <span className="font-semibold text-ink-950">{selected.name}</span>
          </p>
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

        <AmountInput
          value={amount}
          onChange={(v) => {
            setAmount(v)
            setError(null)
          }}
          error={error}
          autoFocus
        />

        <Textarea
          label="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Tomatoes + onions"
        />

        {done ? (
          <div className="flex items-center justify-center gap-2 rounded-xl bg-positive-50 py-3.5 text-[15px] font-semibold text-positive-700">
            <Check size={18} aria-hidden="true" />
            Credit saved
          </div>
        ) : (
          <Button fullWidth onClick={() => void submit()} disabled={saving || !customerUuid}>
            {saving ? 'Saving…' : 'Record Credit'}
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

export function RecordCreditButton({
  onClick,
}: {
  onClick: () => void
}) {
  return (
    <Button onClick={onClick} fullWidth>
      <Plus size={20} aria-hidden="true" />
      Record Credit
    </Button>
  )
}
