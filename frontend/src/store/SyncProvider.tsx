import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  countPendingOps,
  getAllCustomers,
  getPendingOps,
  type LocalCustomer,
} from '../lib/db'
import {
  isOnline,
  reconcileCustomers,
  resetLedgerReconciliation,
  syncNow,
  type SyncReport,
} from '../lib/sync'

interface SyncState {
  online: boolean
  syncing: boolean
  pendingCount: number
  errorCount: number
  lastSyncAt: string | null
  customers: LocalCustomer[]
  loaded: boolean
  /**
   * True once the server has been reached at least once this session and its
   * state merged into the local store. An empty customer list is only
   * trustworthy ("verified empty") after this is true — until then the UI
   * must not claim the account has no records.
   */
  hydrated: boolean
  /** Re-read everything from the local store (after any local write). */
  reloadLocal: () => Promise<void>
  /** Push pending ops to the server, then reload. Returns the report. */
  syncAll: () => Promise<SyncReport>
  /** Pull server state into the local store, then reload (online only). */
  refreshFromServer: () => Promise<void>
  /** Debounced sync after a local change (used by record flows). */
  scheduleSync: () => void
}

const SyncContext = createContext<SyncState | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(isOnline())
  const [syncing, setSyncing] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [errorCount, setErrorCount] = useState(0)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [customers, setCustomers] = useState<LocalCustomer[]>([])
  const [loaded, setLoaded] = useState(false)
  // Reset on mount (fresh login): nothing is verified until the server is
  // reached. Cleared implicitly on logout because SyncProvider unmounts.
  const [hydrated, setHydrated] = useState(false)
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reloadLocal = useCallback(async () => {
    const [custs, pending, errored] = await Promise.all([
      getAllCustomers(),
      countPendingOps(),
      countFailedOps(),
    ])
    setCustomers(custs)
    setPendingCount(pending)
    setErrorCount(errored)
    setLoaded(true)
  }, [])

  const syncAll = useCallback(async (): Promise<SyncReport> => {
    // Honest offline report instead of a silent no-op: callers must be able
    // to tell "sync was attempted and failed" from "sync succeeded".
    if (!isOnline()) {
      setOnline(false)
      await reloadLocal()
      return { pushed: 0, completed: 0, failed: [], reconciled: false, offline: true }
    }
    setSyncing(true)
    try {
      const report = await syncNow()
      if (report.offline) {
        setOnline(false)
      } else {
        if (report.reconciled) {
          setLastSyncAt(new Date().toISOString())
          setHydrated(true)
        }
      }
      await reloadLocal()
      return report
    } finally {
      setSyncing(false)
    }
  }, [reloadLocal])

  const refreshFromServer = useCallback(async () => {
    if (!isOnline()) return
    const ok = await reconcileCustomers()
    if (ok) setHydrated(true)
    await reloadLocal()
  }, [reloadLocal])

  // Initial load + auto-sync when the app opens. SyncProvider mounts per
  // login (it unmounts on logout), so this is also the session boundary —
  // per-customer ledger-reconciliation markers from a previous account must
  // not leak into this one.
  useEffect(() => {
    resetLedgerReconciliation()
    void reloadLocal()
    if (isOnline()) void syncAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // React to connectivity changes.
  useEffect(() => {
    const goOnline = () => {
      setOnline(true)
      void syncAll()
    }
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [syncAll])

  // Debounced sync after local changes.
  const scheduleSync = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => void syncAll(), 1200)
  }, [syncAll])

  useEffect(() => () => {
    if (syncTimer.current) clearTimeout(syncTimer.current)
  }, [])

  const value = useMemo<SyncState>(
    () => ({
      online,
      syncing,
      pendingCount,
      errorCount,
      lastSyncAt,
      customers,
      loaded,
      hydrated,
      reloadLocal,
      syncAll,
      refreshFromServer,
      scheduleSync,
    }),
    [online, syncing, pendingCount, errorCount, lastSyncAt, customers, loaded, hydrated, reloadLocal, syncAll, refreshFromServer, scheduleSync],
  )

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

async function countFailedOps(): Promise<number> {
  const ops = await getPendingOps()
  return ops.filter((o) => o.status === 'error').length
}

export function useSync(): SyncState {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useSync must be used within SyncProvider')
  return ctx
}
