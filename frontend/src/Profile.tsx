import { useEffect, useState } from 'react'
import { connectPsn, disconnectProvider, getProfile, type Profile as ProfileData } from './api'
import type { User } from './types'

export function Profile({ user, onChanged }: { user: User; onChanged?: () => void }) {
  const [data, setData] = useState<ProfileData | null>(null)

  const reload = () =>
    getProfile()
      .then(setData)
      .catch(() => {})

  useEffect(() => {
    void reload()
  }, [])

  const done = () => {
    void reload()
    onChanged?.()
  }

  return (
    <div className="dashboard">
      <div className="profile-head">
        {user.picture ? (
          <img className="profile-avatar" src={user.picture} alt="" referrerPolicy="no-referrer" />
        ) : (
          <div className="profile-avatar profile-avatar-empty">
            {(user.name ?? user.email ?? '?').slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="profile-id">
          <div className="profile-name">{user.name ?? 'No name'}</div>
          {user.email ? <div className="profile-email">{user.email}</div> : null}
        </div>
      </div>

      <h3 className="profile-section-title">Connected accounts</h3>
      <p className="profile-section-sub">
        Connect your accounts to sync your library. We only store your public identifiers — never a
        password or token of yours.
      </p>

      <div className="profile-providers">
        <PsnCard connected={!!data?.connections.psn} onDone={done} />
        <SteamCard connected={!!data?.connections.steam} onDone={done} />
        <XboxCard
          connected={!!data?.connections.xbox}
          configured={data?.xboxConfigured ?? true}
          gamertag={data?.xboxGamertag ?? null}
          onDone={done}
        />
      </div>
    </div>
  )
}

function XboxCard({
  connected,
  configured,
  gamertag,
  onDone,
}: {
  connected: boolean
  configured: boolean
  gamertag: string | null
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    try {
      await disconnectProvider('xbox')
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="provider-card">
      <div className="provider-card-head">
        <span className="src-tag src-xbox">Xbox</span>
        {connected ? (
          <span className="provider-connected">✓ {gamertag ?? 'Connected'}</span>
        ) : null}
      </div>
      <p className="provider-hint">
        Sign in with your Microsoft account to sync your Xbox games and achievements — nothing to
        paste.
      </p>
      {configured ? (
        <div className="provider-actions">
          <a className="login-submit xbox-login" href="/api/profile/xbox/login">
            {connected ? 'Reconnect with Microsoft' : 'Sign in with Microsoft'}
          </a>
          {connected ? (
            <button className="provider-remove" onClick={remove} disabled={busy}>
              Disconnect
            </button>
          ) : null}
        </div>
      ) : (
        <p className="provider-hint provider-hint-muted">
          Xbox sign-in isn’t configured on this server (missing Microsoft app credentials).
        </p>
      )}
    </div>
  )
}

function PsnCard({ connected, onDone }: { connected: boolean; onDone: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await connectPsn(value)
      setValue('')
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await disconnectProvider('psn')
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="provider-card">
      <div className="provider-card-head">
        <span className="src-tag src-psn">PlayStation</span>
        {connected ? <span className="provider-connected">✓ Connected</span> : null}
      </div>
      <p className="provider-hint">
        Paste your <strong>NPSSO</strong> token. Sign in at{' '}
        <a href="https://www.playstation.com" target="_blank" rel="noreferrer">
          playstation.com
        </a>{' '}
        and open{' '}
        <a href="https://ca.account.sony.com/api/v1/ssocookie" target="_blank" rel="noreferrer">
          this link
        </a>{' '}
        to get the value. (Expires every ~2 months.)
      </p>
      <input
        className="login-input"
        type="password"
        placeholder="NPSSO"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {error ? <div className="login-error">{error}</div> : null}
      <div className="provider-actions">
        <button className="login-submit" onClick={save} disabled={busy || !value.trim()}>
          {connected ? 'Update' : 'Connect'}
        </button>
        {connected ? (
          <button className="provider-remove" onClick={remove} disabled={busy}>
            Disconnect
          </button>
        ) : null}
      </div>
    </div>
  )
}

function SteamCard({ connected, onDone }: { connected: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    try {
      await disconnectProvider('steam')
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="provider-card">
      <div className="provider-card-head">
        <span className="src-tag src-steam">Steam</span>
        {connected ? <span className="provider-connected">✓ Connected</span> : null}
      </div>
      <p className="provider-hint">
        Click to sign in with your Steam account — nothing to paste. Your profile and game details
        must be <strong>public</strong>.
      </p>
      <div className="provider-actions">
        <a className="login-submit steam-login" href="/api/profile/steam/login">
          {connected ? 'Reconnect with Steam' : 'Sign in with Steam'}
        </a>
        {connected ? (
          <button className="provider-remove" onClick={remove} disabled={busy}>
            Disconnect
          </button>
        ) : null}
      </div>
    </div>
  )
}
