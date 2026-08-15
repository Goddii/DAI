import { useState, type ReactNode } from 'react'
import { ArrowLeft, BookOpen, Menu } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { initialsOf } from '../../lib/initials'
import { useAuth } from '../../store/AuthProvider'
import { AccountSheet } from '../AccountSheet'
import { IconButton } from '../ui/IconButton'
import { useMenu } from './MenuDrawer'

interface HeaderProps {
  /** When set, shows a back button + title (detail screens). Otherwise the Dai wordmark. */
  title?: string
  /**
   * Explicit destination for the back button (the known parent in the app
   * hierarchy). Falls back to browser history when omitted — prefer passing
   * this on detail screens so back works even after a refresh/deep link.
   */
  backTo?: string
  /** Extra actions rendered before the account control (e.g. edit, add customer). */
  right?: ReactNode
}

/**
 * The authenticated app bar: navigation trigger + Dai identity on the left,
 * page actions and the account control (initials avatar → Account sheet) on
 * the right. Always light — navy is reserved for brand moments, not the
 * chrome. Navigation (drawer) and account actions (sheet) stay separate
 * responsibilities.
 */
export function Header({ title, backTo, right }: HeaderProps) {
  const navigate = useNavigate()
  const { trader } = useAuth()
  const { openMenu } = useMenu()
  const [showAccount, setShowAccount] = useState(false)

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface pt-safe">
      <div className="mx-auto flex h-14 w-full max-w-[560px] items-center gap-1 px-2">
        <IconButton label="Open menu" onClick={openMenu}>
          <Menu size={22} aria-hidden="true" />
        </IconButton>
        {title ? (
          <>
            <IconButton label="Back" onClick={() => (backTo ? navigate(backTo) : navigate(-1))}>
              <ArrowLeft size={22} />
            </IconButton>
            <h1 className="flex-1 truncate px-1 text-[17px] font-semibold text-ink-950">{title}</h1>
          </>
        ) : (
          <p className="flex flex-1 items-center gap-2 px-1" aria-label="Dai">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-800 text-white">
              <BookOpen size={16} aria-hidden="true" />
            </span>
            <span className="text-[17px] font-bold tracking-tight text-ink-950">Dai</span>
          </p>
        )}

        {right}

        <button
          type="button"
          aria-label="Account"
          title="Account"
          onClick={() => setShowAccount(true)}
          className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-800 text-[15px] font-semibold text-white transition-colors duration-150 hover:bg-brand-900 active:bg-brand-950"
        >
          {initialsOf(trader?.name)}
        </button>
      </div>

      <AccountSheet open={showAccount} onClose={() => setShowAccount(false)} />
    </header>
  )
}
