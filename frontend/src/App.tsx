import { useEffect, useRef } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { MenuProvider } from './components/layout/MenuDrawer'
import { Skeleton } from './components/ui/Skeleton'
import { CustomerDetailPage } from './pages/CustomerDetailPage'
import { CustomersPage } from './pages/CustomersPage'
import { DashboardPage } from './pages/DashboardPage'
import { EmailVerificationPage } from './pages/EmailVerificationPage'
import { LoginPage } from './pages/LoginPage'
import { SettingsPage } from './pages/SettingsPage'
import { AuthProvider, useAuth } from './store/AuthProvider'
import { SyncProvider } from './store/SyncProvider'

function Shell() {
  const { trader, ready } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const prevTrader = useRef(trader)

  // After login/register, land on the dashboard — never on a stale deep link
  // from a previous session (that customer's data was cleared at logout).
  useEffect(() => {
    if (trader && !prevTrader.current && location.pathname !== '/') {
      navigate('/', { replace: true })
    }
    prevTrader.current = trader
  }, [trader, location.pathname, navigate])

  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-[560px] space-y-3 px-4 pt-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
      </div>
    )
  }

  if (new URLSearchParams(location.search).has('verify_email_token')) {
    return <EmailVerificationPage />
  }

  if (!trader) return <LoginPage />

  return (
    <SyncProvider>
      <MenuProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/customers/:clientUuid" element={<CustomerDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </MenuProvider>
    </SyncProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  )
}
