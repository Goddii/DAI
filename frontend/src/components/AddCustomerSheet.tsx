import { useEffect, useState } from 'react'
import { Check, UserPlus } from 'lucide-react'
import { createCustomerWithInitialCreditLocal } from '../lib/actions'
import { ApiError } from '../lib/api'
import { parseAmountToMinor } from '../lib/money'
import { type LocalCustomer } from '../lib/db'
import { useSync } from '../store/SyncProvider'
import { AmountInput } from './ui/AmountInput'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Input, Textarea } from './ui/Input'

interface AddCustomerSheetProps {
  open: boolean
  onClose: () => void
  onAdded?: (customer: LocalCustomer) => void
}

export function AddCustomerSheet({ open, onClose, onAdded }: AddCustomerSheetProps) {
  const { reloadLocal, scheduleSync } = useSync()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [initialAmount, setInitialAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setPhone('')
      setInitialAmount('')
      setNotes('')
      setError(null)
      setSaving(false)
      setDone(false)
    }
  }, [open])

  async function submit() {
    if (!name.trim()) {
      setError('Give the customer a name — a nickname is fine.')
      return
    }
    let initialMinor: number | null = null
    if (initialAmount.trim() !== '') {
      const parsed = parseAmountToMinor(initialAmount)
      if (parsed === null) {
        setError('Enter how much they already owe, e.g. 2,000 — or leave it empty.')
        return
      }
      // KSh 0 means "they owe nothing yet" — create only the customer.
      initialMinor = parsed > 0 ? parsed : null
    }
    setSaving(true)
    setError(null)
    try {
      const { customer } = await createCustomerWithInitialCreditLocal(
        name.trim(),
        phone.trim() || null,
        notes.trim() || null,
        initialMinor,
      )
      setDone(true)
      await reloadLocal()
      scheduleSync()
      onAdded?.(customer)
      setTimeout(onClose, 700)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Add Customer">
      <div className="space-y-5">
        <Input
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          placeholder="e.g. Mama Fruits"
          error={error}
          autoFocus
        />
        <Input
          label="Phone (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. 0722 123 456"
          inputMode="tel"
        />
        <AmountInput
          label="Already owes you (optional)"
          value={initialAmount}
          onChange={(v) => {
            setInitialAmount(v)
            setError(null)
          }}
          autoFocus={false}
        />
        <p className="-mt-3 text-[13px] text-ink-500">
          If they owe you something right now, enter it — it becomes their first credit. Leave empty if they
          don&apos;t owe anything yet.
        </p>
        <Textarea
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Sells at the kiosk near the gate"
        />

        {done ? (
          <div className="flex items-center justify-center gap-2 rounded-xl bg-positive-50 py-3.5 text-[15px] font-semibold text-positive-700">
            <Check size={18} aria-hidden="true" />
            Customer added
          </div>
        ) : (
          <Button fullWidth onClick={() => void submit()} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Add Customer'}
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

export function AddCustomerButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" size="md" onClick={onClick}>
      <UserPlus size={18} aria-hidden="true" />
      Add Customer
    </Button>
  )
}
