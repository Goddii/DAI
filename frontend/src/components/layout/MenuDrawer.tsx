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
import { createPortal } from 'react-dom'
import { BookOpen, LayoutDashboard, Users, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'

interface MenuContextValue {
  open: boolean
  openMenu: () => void
  closeMenu: () => void
}

const MenuContext = createContext<MenuContextValue | null>(null)

export function useMenu(): MenuContextValue {
  const ctx = useContext(MenuContext)
  if (!ctx) throw new Error('useMenu must be used within MenuProvider')
  return ctx
}

/**
 * Holds the navigation drawer state. On md+ widths the drawer pushes the
 * application content right (padding transition); on phones it overlays the
 * content with a subtle backdrop. Navigation lives here; account actions stay
 * with the account avatar.
 */
export function MenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openMenu = useCallback(() => setOpen(true), [])
  const closeMenu = useCallback(() => setOpen(false), [])
  const value = useMemo<MenuContextValue>(
    () => ({ open, openMenu, closeMenu }),
    [open, openMenu, closeMenu],
  )

  return (
    <MenuContext.Provider value={value}>
      <div
        data-testid="menu-push-wrapper"
        className={[
          'transition-[padding] duration-200 ease-out',
          open ? 'md:pl-[300px]' : 'md:pl-0',
        ].join(' ')}
      >
        {children}
      </div>
      <MenuDrawer open={open} onClose={closeMenu} />
    </MenuContext.Provider>
  )
}

/**
 * The navigation drawer — anchored to the left edge of the viewport, sliding
 * in from the left (180–250ms) and spanning the full shell height. A drawer,
 * not a dialog: no focus trap, no modal backdrop on md+ where the content is
 * pushed instead. Escape, the close button, the backdrop (mobile) and any
 * destination close it. Focus moves into the drawer on open and returns to
 * the trigger on close.
 */
function MenuDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.querySelector<HTMLButtonElement>('button[aria-label="Open menu"]')?.focus()
    }
  }, [open, onClose])

  return createPortal(
    <>
      <div
        data-testid="menu-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className={[
          'fixed inset-0 z-40 bg-ink-950/30 transition-opacity duration-200 md:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
      />
      <aside
        aria-hidden={!open}
        inert={!open}
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-[min(300px,85vw)] flex-col border-r border-line bg-surface shadow-pop md:w-[300px]',
          'transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-2 pt-safe">
          <span className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg bg-brand-800 text-white">
            <BookOpen size={16} aria-hidden="true" />
          </span>
          <span className="text-[17px] font-bold tracking-tight text-ink-950">Dai</span>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            className="ml-auto flex h-11 w-11 items-center justify-center rounded-xl text-ink-500 transition-colors duration-150 hover:bg-canvas active:bg-brand-50"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Menu" className="flex-1 overflow-y-auto p-2 pt-3">
          <NavLink
            to="/"
            end
            onClick={onClose}
            className={({ isActive }) =>
              [
                'flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-[15px] font-medium transition-colors duration-150',
                isActive
                  ? 'bg-brand-50 font-semibold text-brand-700'
                  : 'text-ink-900 hover:bg-canvas active:bg-brand-50',
              ].join(' ')
            }
          >
            {({ isActive }) => (
              <>
                <LayoutDashboard
                  size={20}
                  className={isActive ? 'shrink-0 text-brand-600' : 'shrink-0 text-ink-500'}
                  aria-hidden="true"
                />
                Dashboard
              </>
            )}
          </NavLink>
          <NavLink
            to="/customers"
            onClick={onClose}
            className={({ isActive }) =>
              [
                'flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-[15px] font-medium transition-colors duration-150',
                isActive
                  ? 'bg-brand-50 font-semibold text-brand-700'
                  : 'text-ink-900 hover:bg-canvas active:bg-brand-50',
              ].join(' ')
            }
          >
            {({ isActive }) => (
              <>
                <Users
                  size={20}
                  className={isActive ? 'shrink-0 text-brand-600' : 'shrink-0 text-ink-500'}
                  aria-hidden="true"
                />
                Customers
              </>
            )}
          </NavLink>
        </nav>
      </aside>
    </>,
    document.body,
  )
}