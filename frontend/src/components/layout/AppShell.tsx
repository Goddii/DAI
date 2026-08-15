import type { ReactNode } from 'react'
import { useSync } from '../../store/SyncProvider'
import { BottomNav } from './BottomNav'
import { SyncBanner } from '../ui/SyncBanner'

interface AppShellProps {
  children: ReactNode
  /** Hide the bottom nav (e.g. focused record flows). */
  hideNav?: boolean
  /** Hide the sync banner (e.g. inside the auth flow). */
  hideSync?: boolean
}

export function AppShell({ children, hideNav = false, hideSync = false }: AppShellProps) {
  const { online, pendingCount, syncing, errorCount } = useSync()

  return (
    <div className="flex min-h-dvh flex-col">
      {!hideSync ? (
        <SyncBanner online={online} pendingCount={pendingCount} syncing={syncing} errorCount={errorCount} />
      ) : null}
      <main className="mx-auto w-full max-w-[560px] flex-1 pb-24">{children}</main>
      {!hideNav ? <BottomNav /> : null}
    </div>
  )
}
