import type { ReactNode } from 'react'

type Tone = 'positive' | 'attention' | 'danger' | 'neutral' | 'brand'

const toneClasses: Record<Tone, string> = {
  positive: 'bg-positive-50 text-positive-700',
  attention: 'bg-attention-50 text-attention-700',
  danger: 'bg-danger-50 text-danger-700',
  neutral: 'bg-ink-100 text-ink-700',
  brand: 'bg-brand-50 text-brand-800',
}

interface BadgeProps {
  tone?: Tone
  icon?: ReactNode
  children: ReactNode
}

/** Pill badge. Meaning always includes text and an optional icon — never color alone. */
export function Badge({ tone = 'neutral', icon, children }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        toneClasses[tone],
      ].join(' ')}
    >
      {icon}
      {children}
    </span>
  )
}
