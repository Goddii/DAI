import type { ReactNode } from 'react'

interface ChipProps {
  selected: boolean
  onClick: () => void
  children: ReactNode
}

/** Selectable chip (e.g. payment method: Cash / M-Pesa / Other). */
export function Chip({ selected, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={[
        'flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 text-[15px] font-semibold',
        'transition-colors duration-150',
        selected
          ? 'border-brand-700 bg-brand-50 text-brand-800'
          : 'border-line bg-surface text-ink-700 hover:bg-canvas active:bg-brand-50',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
