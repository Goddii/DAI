import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatKsh } from '../../lib/money'

interface CustomerRowProps {
  clientUuid: string
  name: string
  balanceMinor: number
  note?: string | null
  phone?: string | null
  /**
   * Origin screen — where the trader tapped in from (dashboard "/" or
   * customers "/customers"). Passed to the detail page via router state so
   * its Back button returns there, without depending on browser history.
   */
  from: string
}

/**
 * One customer in the list: name (strong), current balance (tabular), a
 * useful secondary line when one exists, and a chevron. 56px+ tall for
 * comfortable tapping. Compact and scannable — name left, money right.
 */
export function CustomerRow({ clientUuid, name, balanceMinor, note, phone, from }: CustomerRowProps) {
  const owes = balanceMinor > 0
  const secondary = note?.trim() || phone?.trim() || null
  return (
    <Link
      to={`/customers/${clientUuid}`}
      state={{ from }}
      className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-brand-50/60 active:bg-brand-100/70"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[16px] font-semibold text-ink-950">{name}</p>
        {secondary ? (
          <p className="tnum mt-0.5 truncate text-[13px] text-ink-500">{secondary}</p>
        ) : null}
      </div>
      <div className="text-right">
        <p className={`tnum text-[15px] font-semibold ${owes ? 'text-ink-950' : 'text-positive-700'}`}>
          {owes ? formatKsh(balanceMinor) : 'Settled'}
        </p>
        <p className="tnum mt-0.5 text-[12px] text-ink-400">{owes ? 'Owes you' : 'KSh 0'}</p>
      </div>
      <ChevronRight size={18} className="shrink-0 text-ink-300" aria-hidden="true" />
    </Link>
  )
}
