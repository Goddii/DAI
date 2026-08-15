import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  body: string
  action?: ReactNode
}

/** Calm empty state — never styled like an error. */
export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-ink-950">{title}</h3>
      <p className="mt-1.5 max-w-xs text-[15px] leading-relaxed text-ink-500">{body}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
