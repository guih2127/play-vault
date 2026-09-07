import { useEffect, useState } from 'react'
import {
  connectPsn,
  disconnectProvider,
  getProfile,
  type Profile as ProfileData,
  type ProviderConnStatus,
} from './api'
import type { User } from './types'

// A provider is flagged for reconnect when its credentials are stored but the last sync could
// not use them (e.g. an expired PSN token). "Never synced" isn't a failure — it just means the
// user hasn't run a sync yet.
function reconnectError(connected: boolean, status: ProviderConnStatus | null): string | null {
  if (!connected || !status || status.connected) return null
  if (!status.error || status.error === 'Never synced') return null
  return status.error
}

function ReconnectWarning({ error }: { error: string | null }) {
  if (!error) return null
  return <div className="provider-warn">⚠ {error} — reconnect to fix.</div>
}

export function Profile({
  user,
  onChanged,
  onConnected,
}: {
  user: User
  onChanged?: () => void
  onConnected?: () => void
}) {
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

  // After a fresh connect, reload the profile and kick off a sync so data shows up right away.
  const connected = () => {
    void reload()
    onConnected?.()
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
        <PsnCard
          connected={!!data?.connections.psn}
          status={data?.status.psn ?? null}
          onDone={done}
          onConnected={connected}
        />
        <SteamCard
          connected={!!data?.connections.steam}
          status={data?.status.steam ?? null}
          onDone={done}
        />
      </div>
    </div>
  )
}

function PsnCard({
  connected,
  status,
  onDone,
  onConnected,
}: {
  connected: boolean
  status: ProviderConnStatus | null
  onDone: () => void
  onConnected: () => void
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await connectPsn(value)
      setValue('')
      onConnected()
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
      <ReconnectWarning error={reconnectError(connected, status)} />
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

function SteamCard({
  connected,
  status,
  onDone,
}: {
  connected: boolean
  status: ProviderConnStatus | null
  onDone: () => void
}) {
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
      <ReconnectWarning error={reconnectError(connected, status)} />
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
