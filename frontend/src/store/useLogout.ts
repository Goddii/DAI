import { useCallback, useState } from 'react'
import { getPendingOps } from '../lib/db'
import { useAuth } from './AuthProvider'
import { useSync } from './SyncProvider'

/**
 * The one logout flow, shared by every surface that offers it (the account
 * sheet and the navigation menu):
 *  - Nothing unsynced: log out immediately.
 *  - Unsynced changes: attempt to sync, then verify from the authoritative
 *    outbox state that nothing is left pending or failed. Only a fully clean
 *    outbox allows logout — otherwise stay logged in, keep every local
 *    record, and let the trader retry.
 *
 * Local financial data is never deleted while the server has not confirmed
 * it: "sync was attempted" is not the same as "data is safely synchronized".
 */
export function useLogout() {
  const { logout } = useAuth()
  const { online, pendingCount, errorCount, syncAll } = useSync()
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)

  // The outbox is authoritative: pending ops AND server-rejected (error)
  // ops are unsynced data that logout must not destroy.
  const unsynced = pendingCount > 0 || errorCount > 0
  const unsyncedCount = pendingCount + errorCount

  const resetLogout = useCallback(() => {
    setBusy(false)
    setBlocked(false)
  }, [])

  async function confirmLogout() {
    setBusy(true)
    setBlocked(false)
    try {
      // The IndexedDB outbox is the single source of truth for whether a
      // sync is required. React state (pendingCount/errorCount) can be
      // stale — e.g. an operation written outside the provider's last load
      // — so it must never decide this alone.
      const ops = await getPendingOps()
      const remaining = ops.filter((o) => o.status === 'pending' || o.status === 'error')
      if (remaining.length > 0) {
        await syncAll()
        // Authoritative check: only the outbox/recovery state proves that
        // no unsynchronized operation remains. A sync attempt that left
        // anything pending or failed must block logout.
        const afterSync = await getPendingOps()
        const stillRemaining = afterSync.filter(
          (o) => o.status === 'pending' || o.status === 'error',
        )
        if (stillRemaining.length > 0) {
          setBlocked(true)
          return
        }
      }
      await logout()
    } finally {
      setBusy(false)
    }
  }

  // Logout never discards unsynced data: tap once, and the sync attempt
  // decides whether logout may complete.
  function requestLogout() {
    void confirmLogout()
  }

  return {
    busy,
    blocked,
    pendingCount,
    errorCount,
    online,
    unsynced,
    unsyncedCount,
    requestLogout,
    confirmLogout,
    resetLogout,
  }
}