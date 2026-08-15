import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  children: ReactNode
}

/** Icon-only button with a minimum 44×44px hit area and an aria-label. */
export function IconButton({ label, children, className = '', ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={[
        'inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink-700',
        'transition-colors duration-150 hover:bg-brand-50 active:bg-brand-100',
        'disabled:text-ink-300 disabled:hover:bg-transparent',
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}
