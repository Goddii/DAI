import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { ApiError } from '../lib/api'
import { useAuth } from '../store/AuthProvider'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export function LoginPage() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!phone.trim() || !password) {
      setError('Enter your phone number and password.')
      return
    }
    if (mode === 'register' && !name.trim()) {
      setError('Tell us your name (or your shop name).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (mode === 'register') await register(name.trim(), phone.trim(), password)
      else await login(phone.trim(), password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <div className="bg-brand-900 pt-safe">
        <div className="mx-auto flex w-full max-w-[560px] flex-col items-center px-6 pb-12 pt-14 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-white">
            <BookOpen size={26} aria-hidden="true" />
          </div>
          <h1 className="text-[28px] font-bold tracking-tight text-white">Dai</h1>
          <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-brand-100">
            Your credit book. Who owes you money, and how much — answered in seconds.
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[560px] flex-1 px-6 pb-10">
        <form onSubmit={(e) => void submit(e)} className="space-y-4 pt-8">
          {mode === 'register' ? (
            <Input
              label="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mama Sarah"
              autoComplete="name"
            />
          ) : null}
          <Input
            label="Phone number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 0722 123 456"
            inputMode="tel"
            autoComplete="tel"
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />

          {error ? (
            <p role="alert" className="rounded-xl bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700">
              {error}
            </p>
          ) : null}

          <Button type="submit" fullWidth disabled={busy}>
            {busy ? 'Please wait…' : mode === 'register' ? 'Create Account' : 'Log In'}
          </Button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setError(null)
            }}
            className="w-full py-2 text-center text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Log in'}
          </button>
        </form>
      </div>
    </div>
  )
}
