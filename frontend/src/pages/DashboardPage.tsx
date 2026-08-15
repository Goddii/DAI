import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Wallet, WifiOff } from 'lucide-react'
import { Header } from '../components/layout/Header'
import { RecordCreditSheet } from '../components/RecordCreditSheet'
import { RecordPaymentSheet } from '../components/RecordPaymentSheet'
import { AddCustomerButton, AddCustomerSheet } from '../components/AddCustomerSheet'
import { EmptyState } from '../components/ui/EmptyState'
import { CustomerRow } from '../components/ui/CustomerRow'
import { Button } from '../components/ui/Button'
import { Skeleton } from '../components/ui/Skeleton'
import { formatKsh } from '../lib/money'
import { useAuth } from '../store/AuthProvider'
import { useSync } from '../store/SyncProvider'

export function DashboardPage() {
  const { trader } = useAuth()
  const { customers, loaded, online, hydrated } = useSync()
  const navigate = useNavigate()
  const [showCredit, setShowCredit] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const owing = useMemo(() => customers.filter((c) => c.balance_minor > 0), [customers])
  const totalOwed = useMemo(
    () => owing.reduce((sum, c) => sum + c.balance_minor, 0),
    [owing],
  )
  const top = useMemo(
    () => [...owing].sort((a, b) => b.balance_minor - a.balance_minor).slice(0, 5),
    [owing],
  )

  // The empty state is only trustworthy once the server has been reached
  // (hydrated). With no local data and no verification yet, we must not show
  // "KSh 0 / You're all clear" — that would confuse "not loaded" with
  // "no data".
  const unverified = loaded && customers.length === 0 && !hydrated
  const hydrating = unverified && online
  const offlineEmpty = unverified && !online

  const firstName = trader?.name?.split(' ')[0] ?? ''

  return (
    <div className="min-h-dvh">
      <Header />

      <div className="px-4 pt-5">
        {/* The one question, answered immediately — navy brand panel. The
            trader's ledger name lives here, separate from the Dai brand. */}
        <div className="rounded-2xl bg-brand-900 px-5 pb-6 pt-5 text-white shadow-card">
          <p className="text-[13px] font-semibold text-brand-200">
            {firstName ? `${firstName}'s Credit Book` : 'Your Credit Book'}
          </p>
          <p className="mt-4 text-sm font-medium text-brand-100">Owes you right now</p>
          {loaded && !unverified ? (
            <p className="tnum mt-1 text-[40px] font-bold leading-tight tracking-tight text-white">
              {formatKsh(totalOwed)}
            </p>
          ) : (
            <Skeleton className="mt-2 h-11 w-56 bg-white/25" />
          )}
          {loaded && !unverified ? (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-brand-100">
              <Users size={16} aria-hidden="true" />
              <span className="tnum font-semibold text-white">{owing.length}</span>
              {owing.length === 1 ? 'customer owes you' : 'customers owe you'}
            </p>
          ) : (
            <Skeleton className="mt-3 h-5 w-44 bg-white/25" />
          )}
        </div>

        {/* Quick actions */}
        <div className="mt-5 flex gap-3">
          <Button onClick={() => setShowCredit(true)} className="flex-1">
            + Record Credit
          </Button>
          <Button variant="secondary" onClick={() => setShowPayment(true)} className="flex-1">
            Record Payment
          </Button>
        </div>

        {/* Needs attention */}
        <section className="mt-8" aria-labelledby="attention-heading">
          <div className="flex items-center justify-between">
            <h2 id="attention-heading" className="text-[17px] font-semibold text-ink-950">
              Needs attention
            </h2>
            <AddCustomerButton onClick={() => setShowAdd(true)} />
          </div>

          {!loaded || hydrating ? (
            <div className="mt-3 space-y-2">
              <Skeleton className="h-[60px] w-full rounded-2xl" />
              <Skeleton className="h-[60px] w-full rounded-2xl" />
              <Skeleton className="h-[60px] w-full rounded-2xl" />
            </div>
          ) : offlineEmpty ? (
            <div className="mt-4">
              <EmptyState
                icon={<WifiOff size={28} aria-hidden="true" />}
                title="Your credit book isn't loaded yet"
                body="You're offline and nothing has been saved on this phone yet. Your records will appear here once you're back online."
              />
            </div>
          ) : owing.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                icon={<Wallet size={28} aria-hidden="true" />}
                title="You're all clear"
                body="Nobody currently owes you money. When you give credit, it will show up here."
                action={<AddCustomerButton onClick={() => setShowAdd(true)} />}
              />
            </div>
          ) : (
            <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">
              {top.map((c) => (
                <CustomerRow
                  key={c.client_uuid}
                  clientUuid={c.client_uuid}
                  name={c.name}
                  balanceMinor={c.balance_minor}
                  note={c.notes}
                  phone={c.phone}
                  from="/"
                />
              ))}
            </div>
          )}
        </section>

        {loaded && !unverified && customers.length === 0 ? (
          <p className="mt-8 text-center text-sm text-ink-500">
            {online ? 'Add your first customer to start tracking credit.' : 'Go online once to add your first customer.'}
          </p>
        ) : null}
      </div>

      <RecordCreditSheet open={showCredit} onClose={() => setShowCredit(false)} />
      <RecordPaymentSheet open={showPayment} onClose={() => setShowPayment(false)} />
      <AddCustomerSheet
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={(customer) => navigate(`/customers/${customer.client_uuid}`, { state: { from: '/' } })}
      />
    </div>
  )
}
