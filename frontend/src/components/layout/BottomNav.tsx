import { LayoutDashboard, Settings, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const items = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/customers', label: 'Customers', icon: Users, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
]

/** Bottom nav — 3 top-level items, icons + labels, ≥44px targets. */
export function BottomNav() {
  return (
    <nav
      aria-label="Main"
      className="border-t border-line bg-surface pb-safe"
    >
      <div className="mx-auto flex h-16 w-full max-w-[560px] items-stretch">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              [
                'flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors duration-150',
                isActive ? 'text-brand-700' : 'text-ink-500 hover:text-ink-700',
              ].join(' ')
            }
          >
            <Icon size={22} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
