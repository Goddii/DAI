import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, LogOut, Settings, WifiOff } from 'lucide-react'
import { initialsOf } from '../lib/initials'
import { useAuth } from '../store/AuthProvider'
import { useLogout } from '../store/useLogout'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'

interface AccountSheetProps {
  open: boolean
  onClose: () => void
}

/**
 * The account sheet — the trader's identity + the way out of their account.
 *
 * The logout flow (sync-first, never discarding unsynced data) lives in the
 * shared `useLogout` hook; the account sheet is its home for account-shaped
 * UI. When sync cannot be confirmed, logout is blocked and the trader is
 * told to stay logged in and retry.
 */
export function AccountSheet({ open, onClose }: AccountSheetProps) {
  const { trader } = useAuth()
  const navigate = useNavigate()
  const {
    busy,
    blocked,
    online,
    unsynced,
    unsyncedCount,
    requestLogout,
    confirmLogout,
    resetLogout,
  } = useLogout()

  useEffect(() => {
    if (!open) resetLogout()
  }, [open, resetLogout])

  return (
    <BottomSheet open={open} onClose={onClose} title="Your account">
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-xl bg-canvas px-4 py-3.5">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-800 text-[15px] font-semibold text-white"
            aria-hidden="true"
          >
            {initialsOf(trader?.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[16px] font-semibold text-ink-950">{trader?.name}</p>
            <p className="tnum truncate text-sm text-ink-500">{trader?.phone}</p>
          </div>
        </div>

        {unsynced && !online ? (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-xl bg-attention-50 px-4 py-3 text-sm font-medium text-attention-700"
          >
            <WifiOff size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              {unsyncedCount === 1
                ? "1 change is saved on this phone but not synced yet. It will sync when you're back online."
                : `${unsyncedCount} changes are saved on this phone but not synced yet. They'll sync when you're back online.`}
            </p>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => {
            onClose()
            navigate('/settings')
          }}
          className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 text-left text-[15px] font-medium text-ink-900 transition-colors duration-150 hover:bg-brand-50 active:bg-brand-100"
        >
          <Settings size={18} className="shrink-0 text-ink-500" aria-hidden="true" />
          Settings
          <ChevronRight size={18} className="ml-auto shrink-0 text-ink-300" aria-hidden="true" />
        </button>

        {blocked ? (
          <div
            role="alert"
            className="space-y-4 rounded-xl border border-danger-100 bg-danger-50 p-4"
          >
            <p className="text-[15px] font-semibold leading-relaxed text-danger-700">
              Your changes haven&apos;t synced yet. Stay logged in and try again.
            </p>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => void confirmLogout()}
              disabled={busy}
            >
              {busy ? 'Trying…' : 'Try Again'}
            </Button>
          </div>
        ) : (
          <Button variant="danger" fullWidth onClick={requestLogout} disabled={busy}>
            <LogOut size={18} aria-hidden="true" />
            {busy ? 'Logging Out…' : 'Log Out'}
          </Button>
        )}

        <p className="text-center text-[13px] text-ink-400">
          Logging out clears this phone&apos;s offline copy of your credit book.
        </p>
      </div>
    </BottomSheet>
  )
}