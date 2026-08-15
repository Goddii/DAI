import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Users, WifiOff } from 'lucide-react'
import { AddCustomerButton, AddCustomerSheet } from '../components/AddCustomerSheet'
import { Header } from '../components/layout/Header'
import { CustomerRow } from '../components/ui/CustomerRow'
import { EmptyState } from '../components/ui/EmptyState'
import { Skeleton } from '../components/ui/Skeleton'
import { formatKsh } from '../lib/money'
import { useSync } from '../store/SyncProvider'

export function CustomersPage() {
  const { customers, loaded, online, hydrated } = useSync()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return customers
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q),
    )
  }, [customers, query])

  const totalOwed = useMemo(
    () => customers.filter((c) => c.balance_minor > 0).reduce((s, c) => s + c.balance_minor, 0),
    [customers],
  )

  // Same honesty rule as the dashboard: "0 customers" is only meaningful once
  // the server has been reached (hydrated).
  const unverified = loaded && customers.length === 0 && !hydrated
  const hydrating = unverified && online
  const offlineEmpty = unverified && !online

  return (
    <div className="min-h-dvh">
      <Header right={<AddCustomerButton onClick={() => setShowAdd(true)} />} />

      <div className="px-4 pt-5">
        <h1 className="text-[22px] font-bold tracking-tight text-ink-950">Customers</h1>
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5">
          <Search size={18} className="shrink-0 text-ink-400" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customers…"
            aria-label="Search customers"
            className="h-11 w-full min-w-0 bg-transparent text-base text-ink-900 placeholder:text-ink-300 focus:outline-none"
          />
        </div>
        {loaded && !unverified ? (
          <p className="tnum mt-3 text-sm text-ink-500">
            {customers.length} {customers.length === 1 ? 'customer' : 'customers'} ·{' '}
            <span className="font-semibold text-ink-700">{`${formatKsh(totalOwed)} owed in total`}</span>
          </p>
        ) : null}
      </div>

      {!loaded || hydrating ? (
        <div className="mt-4 space-y-2 px-4">
          <Skeleton className="h-[60px] w-full rounded-2xl" />
          <Skeleton className="h-[60px] w-full rounded-2xl" />
          <Skeleton className="h-[60px] w-full rounded-2xl" />
        </div>
      ) : offlineEmpty ? (
        <EmptyState
          icon={<WifiOff size={28} aria-hidden="true" />}
          title="Your customers aren't loaded yet"
          body="You're offline and nothing has been saved on this phone yet. Your customers will appear here once you're back online."
        />
      ) : filtered.length === 0 && customers.length === 0 ? (
        <EmptyState
          icon={<Users size={28} aria-hidden="true" />}
          title="You haven't added any customers yet"
          body={
            online
              ? 'Add your first customer to start tracking credit.'
              : 'You are offline. Go online once to add your first customer.'
          }
          action={<AddCustomerButton onClick={() => setShowAdd(true)} />}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={28} aria-hidden="true" />}
          title="No matches"
          body={`No customers match "${query}". Try a different name or phone number.`}
        />
      ) : (
        <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
          {filtered.map((c) => (
            <CustomerRow
              key={c.client_uuid}
              clientUuid={c.client_uuid}
              name={c.name}
              balanceMinor={c.balance_minor}
              note={c.notes}
              phone={c.phone}
              from="/customers"
            />
          ))}
        </div>
      )}

      <AddCustomerSheet
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={(customer) => navigate(`/customers/${customer.client_uuid}`, { state: { from: '/customers' } })}
      />
    </div>
  )
}
