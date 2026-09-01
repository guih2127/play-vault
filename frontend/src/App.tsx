import { useCallback, useEffect, useState, type ReactNode } from 'react'
import './App.css'
import { fetchDashboard, getMe, logout, syncNow } from './api'
import type { Dashboard, User } from './types'
import { formatDateTime } from './format'
import { Login } from './Login'
import { Profile } from './Profile'
import { Overview } from './Overview'
import { Library } from './Library'
import { Backlog } from './Backlog'
import { TrophiesPage } from './TrophiesPage'
import { IconOverview, IconLibrary, IconBacklog, IconTrophy, IconSync, IconLogout } from './icons'

type View = 'overview' | 'library' | 'backlog' | 'trophies' | 'profile'

const NAV_ITEMS: Array<{
  key: View
  label: string
  Icon: (props: { size?: number }) => ReactNode
}> = [
  { key: 'overview', label: 'Overview', Icon: IconOverview },
  { key: 'library', label: 'Library', Icon: IconLibrary },
  { key: 'backlog', label: 'Backlog', Icon: IconBacklog },
  { key: 'trophies', label: 'Trophies', Icon: IconTrophy },
]

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [meta, setMeta] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [view, setView] = useState<View>('overview')
  const [libraryStatus, setLibraryStatus] = useState<'all' | 'beaten' | 'playing'>('all')

  const load = useCallback(async () => {
    try {
      setMeta(await fetchDashboard())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected')) {
      setView('profile')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    if (user) void load()
  }, [load, user])

  const handleLogout = useCallback(async () => {
    await logout()
    setUser(null)
    setMeta(null)
    setLoading(true)
  }, [])

  const runSync = useCallback(async () => {
    setSyncing(true)
    setError(null)
    try {
      await syncNow()
      await load()
      setRefreshKey((k) => k + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }, [load])

  if (!authChecked) return <div className="state">Loading…</div>
  if (!user) return <Login onSuccess={setUser} />
  if (loading) return <div className="state">Loading…</div>
  if (error && !meta) return <div className="state state-error">{error}</div>
  if (!meta) return null

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">P</div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ key, label, Icon }) => (
            <button
              key={key}
              className={`side-btn ${view === key ? 'side-btn-active' : ''}`}
              onClick={() => {
                if (key === 'overview') void load()
                if (key === 'library') setLibraryStatus('all')
                setView(key)
              }}
              title={label}
              aria-label={label}
            >
              <Icon />
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button
            className="side-btn"
            onClick={runSync}
            disabled={syncing}
            title={`Sync${meta.lastSyncAt ? ` · last: ${formatDateTime(meta.lastSyncAt)}` : ''}`}
            aria-label="Sync"
          >
            <span className={syncing ? 'spin' : undefined}>
              <IconSync />
            </span>
          </button>

          <button
            className={`side-btn sidebar-avatar ${view === 'profile' ? 'side-btn-active' : ''}`}
            onClick={() => setView('profile')}
            title="Profile"
            aria-label="Profile"
          >
            {user.picture ? (
              <img className="user-avatar" src={user.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="user-avatar user-avatar-empty">
                {(user.name ?? user.email ?? '?').slice(0, 1).toUpperCase()}
              </span>
            )}
          </button>

          <button
            className="side-btn"
            onClick={handleLogout}
            title="Sign out"
            aria-label="Sign out"
          >
            <IconLogout />
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="main-inner">
          {view !== 'overview' ? (
            <button
              className="back-btn"
              onClick={() => {
                void load()
                setView('overview')
              }}
            >
              ← Dashboard
            </button>
          ) : null}

          {error ? <div className="banner-error">{error}</div> : null}

          {view === 'overview' ? (
            <Overview
              meta={meta}
              onRefresh={load}
              onGoBacklog={() => setView('backlog')}
              onGoLibrary={() => {
                setLibraryStatus('all')
                setView('library')
              }}
              onGoPlaying={() => {
                setLibraryStatus('playing')
                setView('library')
              }}
              onGoTrophies={() => setView('trophies')}
            />
          ) : view === 'library' ? (
            <Library refreshKey={refreshKey} initialStatus={libraryStatus} />
          ) : view === 'backlog' ? (
            <Backlog refreshKey={refreshKey} />
          ) : view === 'profile' ? (
            <Profile user={user} onChanged={load} />
          ) : (
            <TrophiesPage meta={meta} onRefresh={load} />
          )}
        </div>
      </main>
    </div>
  )
}

export default App
