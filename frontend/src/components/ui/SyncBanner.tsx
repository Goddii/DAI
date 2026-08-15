import { CheckCircle2, CloudOff, Loader2, TriangleAlert, WifiOff } from 'lucide-react'
import { Link } from 'react-router-dom'

interface SyncBannerProps {
  online: boolean
  pendingCount: number
  syncing: boolean
  errorCount: number
}

/**
 * The only place sync state lives in the normal workflow — a slim strip that
 * says in plain language whether the credit book is saved. The trader never
 * has to *do* anything here; when a genuine error needs attention, the strip
 * becomes a link to the recovery surface in Settings.
 */
export function SyncBanner({ online, pendingCount, syncing, errorCount }: SyncBannerProps) {
  if (syncing) {
    return (
      <div className="flex items-center gap-2 bg-brand-50 px-4 py-2.5 text-sm font-medium text-brand-800">
        <Loader2 size={16} className="shrink-0 animate-spin" aria-hidden="true" />
        Syncing…
      </div>
    )
  }
  if (!online) {
    // Always say "offline" when offline — "All synced" would be misleading,
    // and with an empty local store it would even claim an unverified account
    // is fully up to date.
    return (
      <div className="flex items-center gap-2 bg-attention-50 px-4 py-2.5 text-sm font-medium text-attention-700">
        <WifiOff size={16} className="shrink-0" aria-hidden="true" />
        {pendingCount > 0 ? (
          <span>
            Offline · {pendingCount} {pendingCount === 1 ? 'change' : 'changes'} waiting
          </span>
        ) : (
          <span>Offline — you&apos;re not connected</span>
        )}
      </div>
    )
  }
  if (pendingCount > 0) {
    return (
      <div className="flex items-center gap-2 bg-attention-50 px-4 py-2.5 text-sm font-medium text-attention-700">
        <CloudOff size={16} className="shrink-0" aria-hidden="true" />
        {pendingCount} {pendingCount === 1 ? 'change' : 'changes'} waiting to sync
      </div>
    )
  }
  if (errorCount > 0) {
    return (
      <Link
        to="/settings"
        className="flex items-center gap-2 bg-danger-50 px-4 py-2.5 text-sm font-medium text-danger-700 transition-colors duration-150 hover:bg-danger-100"
      >
        <TriangleAlert size={16} className="shrink-0" aria-hidden="true" />
        <span className="flex-1">Some changes couldn&apos;t sync</span>
        <span className="font-semibold underline underline-offset-2">Review</span>
      </Link>
    )
  }
  return (
    <div className="flex items-center gap-2 bg-positive-50 px-4 py-2.5 text-sm font-medium text-positive-700">
      <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />
      All synced
    </div>
  )
}
