import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useOutletContext,
  useSearchParams,
} from 'react-router-dom'
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
import { Users } from './Users'
import { UserProfile } from './UserProfile'
import { LoadingState, Spinner } from './components/Spinner'
import { WelcomeGuide } from './components/WelcomeGuide'
import {
  IconOverview,
  IconLibrary,
  IconBacklog,
  IconTrophy,
  IconUsers,
  IconSync,
  IconLogout,
} from './icons'

const NAV_ITEMS: Array<{
  to: string
  label: string
  Icon: (props: { size?: number }) => ReactNode
}> = [
  { to: '/', label: 'Overview', Icon: IconOverview },
  { to: '/library', label: 'Library', Icon: IconLibrary },
  { to: '/backlog', label: 'Backlog', Icon: IconBacklog },
  { to: '/trophies', label: 'Trophies', Icon: IconTrophy },
  { to: '/users', label: 'Users', Icon: IconUsers },
]

// Shared state handed to routed pages: `refreshKey` bumps whenever a sync completes so pages
// re-fetch their data, and `user` identifies the logged-in viewer.
interface AppContext {
  refreshKey: number
  user: User
  syncing: boolean
  triggerSync: () => void
}

export function useAppContext(): AppContext {
  return useOutletContext<AppContext>()
}

function Layout({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const runSync = useCallback(async () => {
    setSyncing(true)
    setError(null)
    try {
      await syncNow()
      setRefreshKey((k) => k + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }, [])

  // The OAuth callbacks (Steam/Xbox) redirect back with ?connected=… — send the user to their
  // profile, and kick off a sync automatically on a successful connect so a first-time user
  // doesn't have to hunt for the Sync button.
  useEffect(() => {
    const connected = params.get('connected')
    if (!connected) return
    navigate('/profile', { replace: true })
    if (!connected.endsWith('_error')) void runSync()
  }, [params, navigate, runSync])

  // Track last sync time for the tooltip without an extra request on every page.
  useEffect(() => {
    fetchDashboard()
      .then((d) => setLastSyncAt(d.lastSyncAt))
      .catch(() => {})
  }, [refreshKey])

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">P</div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `side-btn ${isActive ? 'side-btn-active' : ''}`}
              title={label}
              aria-label={label}
            >
              <Icon />
              <span className="side-label">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button
            className="side-btn"
            onClick={runSync}
            disabled={syncing}
            title={`Sync${lastSyncAt ? ` · last: ${formatDateTime(lastSyncAt)}` : ''}`}
            aria-label="Sync"
          >
            <span className={syncing ? 'spin' : undefined}>
              <IconSync />
            </span>
            <span className="side-label">Sync</span>
          </button>

          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `side-btn sidebar-avatar ${isActive ? 'side-btn-active' : ''}`
            }
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
            <span className="side-label">Profile</span>
          </NavLink>

          <button className="side-btn" onClick={onLogout} title="Sign out" aria-label="Sign out">
            <IconLogout />
            <span className="side-label">Sign out</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="main-inner">
          {error ? <div className="banner-error">{error}</div> : null}
          {syncing ? (
            <div className="banner-sync" role="status" aria-live="polite">
              <Spinner size={18} />
              <span>Syncing your library… the first sync can take a minute.</span>
            </div>
          ) : null}
          <Outlet
            context={
              { refreshKey, user, syncing, triggerSync: runSync } satisfies AppContext
            }
          />
        </div>
      </main>
    </div>
  )
}

function Home() {
  const { refreshKey, syncing, triggerSync } = useAppContext()
  const [meta, setMeta] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

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
    void load()
  }, [load, refreshKey])

  if (loading) return <LoadingState />
  if (error && !meta) return <div className="state state-error">{error}</div>
  if (!meta) return null

  // First-run: nothing synced yet. Guide the user through connecting and syncing instead of
  // showing an empty dashboard.
  if (meta.totals.games === 0) {
    return (
      <WelcomeGuide
        hasConnection={meta.providers.some((p) => p.connected)}
        syncing={syncing}
        onConnect={() => navigate('/profile')}
        onSync={triggerSync}
      />
    )
  }

  return (
    <Overview
      meta={meta}
      onRefresh={load}
      onGoBacklog={() => navigate('/backlog')}
      onGoLibrary={() => navigate('/library')}
      onGoPlaying={() => navigate('/library?status=playing')}
      onGoTrophies={() => navigate('/trophies')}
    />
  )
}

function LibraryPage() {
  const { refreshKey } = useAppContext()
  const [params] = useSearchParams()
  const status = params.get('status')
  return (
    <Library
      refreshKey={refreshKey}
      initialStatus={status === 'playing' || status === 'beaten' ? status : 'all'}
    />
  )
}

function BacklogPage() {
  const { refreshKey } = useAppContext()
  return <Backlog refreshKey={refreshKey} />
}

function TrophiesRoute() {
  const { refreshKey } = useAppContext()
  const [meta, setMeta] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setMeta(await fetchDashboard())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  if (error && !meta) return <div className="state state-error">{error}</div>
  if (!meta) return <LoadingState />
  return <TrophiesPage meta={meta} onRefresh={load} />
}

function ProfileRoute() {
  const { user, triggerSync } = useAppContext()
  return <Profile user={user} onConnected={triggerSync} />
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true))
  }, [])

  const handleLogout = useCallback(async () => {
    await logout()
    setUser(null)
  }, [])

  if (!authChecked) return <LoadingState />
  if (!user) return <Login onSuccess={setUser} />

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout user={user} onLogout={handleLogout} />}>
          <Route path="/" element={<Home />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/backlog" element={<BacklogPage />} />
          <Route path="/trophies" element={<TrophiesRoute />} />
          <Route path="/profile" element={<ProfileRoute />} />
          <Route path="/users" element={<Users />} />
          <Route path="/users/:id" element={<UserProfile currentUserId={user.id} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
