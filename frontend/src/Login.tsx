import { useEffect, useRef, useState } from 'react'
import { loginWithGoogle, loginWithPassword, registerWithPassword } from './api'
import type { User } from './types'

interface GoogleId {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string
        callback: (r: { credential: string }) => void
      }) => void
      renderButton: (el: HTMLElement, opts: Record<string, string>) => void
    }
  }
}

declare global {
  interface Window {
    google?: { accounts?: GoogleId['accounts'] }
  }
}

export function Login({ onSuccess }: { onSuccess: (user: User) => void }) {
  const btnRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string
    const init = (): boolean => {
      const id = window.google?.accounts?.id
      if (!id || !btnRef.current) return false
      id.initialize({
        client_id: clientId,
        callback: async (resp) => {
          try {
            onSuccess(await loginWithGoogle(resp.credential))
          } catch {
            setError('Could not sign in with Google. Please try again.')
          }
        },
      })
      id.renderButton(btnRef.current, {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        logo_alignment: 'left',
      })
      return true
    }
    if (init()) return
    const timer = setInterval(() => {
      if (init()) clearInterval(timer)
    }, 100)
    return () => clearInterval(timer)
  }, [onSuccess])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const user =
        mode === 'register'
          ? await registerWithPassword(email, password, name)
          : await loginWithPassword(email, password)
      onSuccess(user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">PlayVault</div>
        <p className="login-tag">Your PS5, Steam and Switch library — all in one place.</p>

        <div ref={btnRef} className="login-btn" />

        <div className="login-divider">
          <span>or</span>
        </div>

        <form className="login-form" onSubmit={submit}>
          {mode === 'register' ? (
            <input
              className="login-input"
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          ) : null}
          <input
            className="login-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            className="login-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            required
          />
          <button className="login-submit" type="submit" disabled={busy}>
            {busy ? '...' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        {error ? <div className="login-error">{error}</div> : null}

        <button
          className="login-toggle"
          type="button"
          onClick={() => {
            setMode((m) => (m === 'login' ? 'register' : 'login'))
            setError(null)
          }}
        >
          {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
