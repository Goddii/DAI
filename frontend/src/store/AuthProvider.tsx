import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getToken, setToken, type Trader } from '../lib/api'
import { clearAllLocalData } from '../lib/db'

interface AuthState {
  trader: Trader | null
  ready: boolean
  refreshTrader: () => Promise<void>
  login: (phone: string, password: string) => Promise<void>
  register: (name: string, phone: string, password: string, email?: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

const TRADER_KEY = 'dai_trader'

function readStoredTrader(): Trader | null {
  try {
    const raw = localStorage.getItem(TRADER_KEY)
    return raw ? (JSON.parse(raw) as Trader) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [trader, setTrader] = useState<Trader | null>(() => readStoredTrader())
  const [ready, setReady] = useState(false)

  // Validate the stored session once on startup (non-blocking for render).
  useEffect(() => {
    let cancelled = false
    async function validate() {
      if (!getToken()) {
        setTrader(null)
        setReady(true)
        return
      }
      try {
        const { trader: fresh } = await api.me()
        if (!cancelled) {
          setTrader(fresh)
          localStorage.setItem(TRADER_KEY, JSON.stringify(fresh))
        }
      } catch {
        // Token invalid/expired/offline — keep the cached trader but the
        // token will be cleared on the next protected request.
        if (!cancelled && !navigator.onLine) {
          // offline: keep session, don't bounce the user
        }
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    void validate()
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      trader,
      ready,
      refreshTrader: async () => {
        const { trader: fresh } = await api.me()
        localStorage.setItem(TRADER_KEY, JSON.stringify(fresh))
        setTrader(fresh)
      },
      login: async (phone, password) => {
        const { token, trader: t } = await api.login({ phone, password })
        setToken(token)
        localStorage.setItem(TRADER_KEY, JSON.stringify(t))
        setTrader(t)
      },
      register: async (name, phone, password, email) => {
        const { token, trader: t } = await api.register({ name, phone, password, email })
        setToken(token)
        localStorage.setItem(TRADER_KEY, JSON.stringify(t))
        setTrader(t)
      },
      logout: async () => {
        try {
          await api.logout()
        } catch {
          // offline or server error — discard locally regardless
        }
        setToken(null)
        localStorage.removeItem(TRADER_KEY)
        setTrader(null)
        await clearAllLocalData()
      },
    }),
    [trader, ready],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
