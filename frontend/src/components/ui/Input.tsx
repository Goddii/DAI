import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { useId } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string | null
  hint?: string
}

export function Input({ label, error, hint, className = '', id, ...rest }: InputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className="w-full">
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink-700">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={[
          'h-11 w-full rounded-xl border bg-surface px-3.5 text-base text-ink-900 placeholder:text-ink-300',
          'transition-colors duration-150 focus:outline-none focus:ring-2',
          error
            ? 'border-danger-600 focus:border-danger-600 focus:ring-danger-100'
            : 'border-line focus:border-brand-600 focus:ring-brand-100',
          className,
        ].join(' ')}
        {...rest}
      />
      {error ? (
        <p role="alert" className="mt-1.5 text-sm text-danger-700">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-sm text-ink-500">{hint}</p>
      ) : null}
    </div>
  )
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  error?: string | null
}

export function Textarea({ label, error, className = '', id, ...rest }: TextareaProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <div className="w-full">
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink-700">
        {label}
      </label>
      <textarea
        id={inputId}
        rows={2}
        aria-invalid={error ? true : undefined}
        className={[
          'w-full rounded-xl border bg-surface px-3.5 py-2.5 text-base text-ink-900 placeholder:text-ink-300',
          'transition-colors duration-150 focus:outline-none focus:ring-2',
          error
            ? 'border-danger-600 focus:border-danger-600 focus:ring-danger-100'
            : 'border-line focus:border-brand-600 focus:ring-brand-100',
          className,
        ].join(' ')}
        {...rest}
      />
      {error ? (
        <p role="alert" className="mt-1.5 text-sm text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}
