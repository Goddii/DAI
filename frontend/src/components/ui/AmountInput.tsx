import { useId } from 'react'

interface AmountInputProps {
  label?: string
  value: string
  onChange: (value: string) => void
  error?: string | null
  autoFocus?: boolean
}

/**
 * The amount field is the most-touched control in the app: large digits,
 * a visible KSh prefix, numeric keypad on mobile. Value is a raw string;
 * conversion to minor units happens at submit via parseAmountToMinor.
 */
export function AmountInput({ label = 'Amount', value, onChange, error, autoFocus }: AmountInputProps) {
  const autoId = useId()
  return (
    <div className="w-full">
      <label htmlFor={autoId} className="mb-1.5 block text-sm font-medium text-ink-700">
        {label}
      </label>
      <div
        className={[
          'flex h-14 items-center overflow-hidden rounded-xl border bg-surface transition-colors duration-150',
          'focus-within:ring-2',
          error
            ? 'border-danger-600 focus-within:border-danger-600 focus-within:ring-danger-100'
            : 'border-line focus-within:border-brand-600 focus-within:ring-brand-100',
        ].join(' ')}
      >
        <span className="pl-4 text-lg font-semibold text-ink-500">KSh</span>
        <input
          id={autoId}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          className="tnum h-full w-full min-w-0 bg-transparent px-3 text-[26px] font-bold text-ink-950 placeholder:font-semibold placeholder:text-ink-300 focus:outline-none"
        />
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-sm text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}
