import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { HandCoins, Pencil, Plus, UserX } from 'lucide-react'
import { Header } from '../components/layout/Header'
import { RecordCreditSheet } from '../components/RecordCreditSheet'
import { RecordPaymentSheet } from '../components/RecordPaymentSheet'
import { TransactionHistory } from '../components/TransactionHistory'
import { Badge } from '../components/ui/Badge'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Input, Textarea } from '../components/ui/Input'
import { Skeleton } from '../components/ui/Skeleton'
import { updateCustomerLocal } from '../lib/actions'
import {
  balanceFromEntries,
  getCustomer,
  getEntriesForCustomer,
  type LocalCustomer,
  type LocalEntry,
} from '../lib/db'
import { formatKsh } from '../lib/money'
import { reconcileLedger } from '../lib/sync'
import { useSync } from '../store/SyncProvider'

export function CustomerDetailPage() {
  const { clientUuid } = useParams<{ clientUuid: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { online, reloadLocal, scheduleSync } = useSync()

  // Contextual back: return to whichever screen the trader opened this
  // customer from (dashboard "/" or customers "/customers"), declared via
  // router state — never browser history, which is unreliable after a refresh
  // or deep link. Fall back to the Customers list when no origin is present.
  const backTo = (location.state as { from?: string } | null)?.from ?? '/customers'

  const [customer, setCustomer] = useState<LocalCustomer | null>(null)
  const [entries, setEntries] = useState<LocalEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [showCredit, setShowCredit] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [showEdit, setShowEdit] = useState(false)

  const reload = useCallback(async () => {
    if (!clientUuid) return
    const [cust, ents] = await Promise.all([
      getCustomer(clientUuid),
      getEntriesForCustomer(clientUuid),
    ])
    if (cust) setCustomer(cust)
    setEntries(ents)
    setLoaded(true)
  }, [clientUuid])

  useEffect(() => {
    void reload()
  }, [reload])

  // When online and the customer has a server id, pull the authoritative ledger.
  useEffect(() => {
    if (online && customer?.server_id) {
      void reconcileLedger(customer.server_id).then(() => void reload())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, customer?.server_id])

  const balance = useMemo(() => balanceFromEntries(entries), [entries])

  if (!loaded) {
    return (
      <div className="min-h-dvh">
        <Header title="Customer" backTo={backTo} />
        <div className="space-y-3 px-4 pt-6">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="min-h-dvh">
        <Header title="Customer" backTo={backTo} />
        <EmptyState
          icon={<UserX size={28} aria-hidden="true" />}
          title="Customer not found"
          body="This customer doesn't exist in your credit book."
          action={<Button onClick={() => navigate('/customers')}>Back to Customers</Button>}
        />
      </div>
    )
  }

  const onChanged = async () => {
    await reload()
    await reloadLocal()
    scheduleSync()
  }

  return (
    <div className="min-h-dvh">
      <Header
        title="Customer"
        backTo={backTo}
        right={
          <button
            type="button"
            aria-label="Edit customer"
            onClick={() => setShowEdit(true)}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-700 transition-colors duration-150 hover:bg-brand-50 active:bg-brand-100"
          >
            <Pencil size={20} />
          </button>
        }
      />

      <div className="px-4 pt-6">
        <h1 className="text-[22px] font-bold tracking-tight text-ink-950">{customer.name}</h1>
        {customer.phone ? (
          <p className="tnum mt-1 text-sm text-ink-500">{customer.phone}</p>
        ) : null}

        <div className="mt-4 rounded-2xl border border-line bg-surface p-5">
          <p className="text-sm font-medium text-ink-500">Owes you</p>
          <p className="tnum mt-1 text-[40px] font-bold leading-tight tracking-tight text-ink-950">
            {formatKsh(balance)}
          </p>
          <div className="mt-2">
            {balance === 0 ? (
              <Badge tone="positive">Paid · settled</Badge>
            ) : (
              <Badge tone="attention">Outstanding balance</Badge>
            )}
          </div>
        </div>

        <div className="mt-4 flex gap-3">
          <Button onClick={() => setShowCredit(true)} className="flex-1">
            <Plus size={20} aria-hidden="true" />
            Credit
          </Button>
          <Button variant="secondary" onClick={() => setShowPayment(true)} className="flex-1">
            <HandCoins size={20} aria-hidden="true" />
            Payment
          </Button>
        </div>

        <h2 className="mb-2 mt-8 px-1 text-[17px] font-semibold text-ink-950">History</h2>
      </div>

      <TransactionHistory entries={entries} onChanged={() => void onChanged()} />

      <RecordCreditSheet
        open={showCredit}
        onClose={() => setShowCredit(false)}
        customerClientUuid={customer.client_uuid}
        onRecorded={() => void onChanged()}
      />
      <RecordPaymentSheet
        open={showPayment}
        onClose={() => setShowPayment(false)}
        customerClientUuid={customer.client_uuid}
        onRecorded={() => void onChanged()}
      />
      <EditCustomerSheet
        open={showEdit}
        onClose={() => setShowEdit(false)}
        customer={customer}
        onSaved={() => void onChanged()}
      />
    </div>
  )
}

function EditCustomerSheet({
  open,
  onClose,
  customer,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  customer: LocalCustomer
  onSaved: () => void
}) {
  const [name, setName] = useState(customer.name)
  const [phone, setPhone] = useState(customer.phone ?? '')
  const [notes, setNotes] = useState(customer.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(customer.name)
      setPhone(customer.phone ?? '')
      setNotes(customer.notes ?? '')
      setError(null)
    }
  }, [open, customer])

  async function save() {
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updateCustomerLocal(customer.client_uuid, {
        name: name.trim(),
        phone: phone.trim() || null,
        notes: notes.trim() || null,
      })
      onClose()
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Edit Customer">
      <div className="space-y-5">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={error} />
        <Input label="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button fullWidth onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save Changes'}
        </Button>
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
