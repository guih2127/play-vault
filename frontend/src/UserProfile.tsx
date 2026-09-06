import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchDashboard, getUserProfile, type UserProfileData } from './api'
import type { Dashboard } from './types'
import { formatDate } from './format'
import { Overview } from './Overview'
import { Library } from './Library'
import { Backlog } from './Backlog'
import { TrophiesPage } from './TrophiesPage'
import { LoadingState } from './components/Spinner'

type Tab = 'overview' | 'library' | 'backlog' | 'trophies'

const TABS: Array<[Tab, string]> = [
  ['overview', 'Overview'],
  ['library', 'Library'],
  ['backlog', 'Backlog'],
  ['trophies', 'Trophies'],
]

export function UserProfile({ currentUserId }: { currentUserId: number }) {
  const { id } = useParams()
  const userId = Number(id)
  const navigate = useNavigate()

  const [profile, setProfile] = useState<UserProfileData | null>(null)
  const [meta, setMeta] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')

  // Viewing your own id here would be a read-only mirror of yourself — send it to the editable app.
  useEffect(() => {
    if (Number.isInteger(userId) && userId === currentUserId) navigate('/', { replace: true })
  }, [userId, currentUserId, navigate])

  useEffect(() => {
    if (!Number.isInteger(userId)) {
      setError('Invalid user')
      return
    }
    setProfile(null)
    setMeta(null)
    setError(null)
    setTab('overview')
    getUserProfile(userId)
      .then(setProfile)
      .catch((e) => setError((e as Error).message))
  }, [userId])

  const loadMeta = useCallback(async () => {
    try {
      setMeta(await fetchDashboard(userId))
    } catch {
      /* keep whatever we had */
    }
  }, [userId])

  useEffect(() => {
    if (tab === 'overview' || tab === 'trophies') void loadMeta()
  }, [tab, loadMeta])

  if (error) {
    return (
      <div className="dashboard">
        <button className="back-btn" onClick={() => navigate('/users')}>
          ← Players
        </button>
        <div className="state state-error">{error}</div>
      </div>
    )
  }
  if (!profile) return <LoadingState label="Loading profile…" />

  const label = profile.user.name ?? profile.user.email ?? 'Unknown'

  return (
    <div className="dashboard">
      <button className="back-btn" onClick={() => navigate('/users')}>
        ← Players
      </button>

      <div className="profile-head">
        {profile.user.picture ? (
          <img
            className="profile-avatar"
            src={profile.user.picture}
            alt=""
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="profile-avatar profile-avatar-empty">
            {label.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="profile-id">
          <div className="profile-name">{label}</div>
          <div className="profile-email">Joined {formatDate(profile.createdAt)}</div>
          <div className="profile-tags">
            {profile.connections.psn ? <span className="src-tag src-psn">PlayStation</span> : null}
            {profile.connections.steam ? <span className="src-tag src-steam">Steam</span> : null}
          </div>
        </div>
      </div>

      <div className="wtabs profile-tabs">
        {TABS.map(([key, text]) => (
          <button
            key={key}
            className={`wtab ${tab === key ? 'wtab-active' : ''}`}
            onClick={() => setTab(key)}
          >
            {text}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        meta ? (
          <Overview
            meta={meta}
            userId={userId}
            readOnly
            onRefresh={loadMeta}
            onGoBacklog={() => setTab('backlog')}
            onGoLibrary={() => setTab('library')}
            onGoPlaying={() => setTab('library')}
            onGoTrophies={() => setTab('trophies')}
          />
        ) : (
          <LoadingState />
        )
      ) : tab === 'library' ? (
        <Library refreshKey={0} userId={userId} readOnly />
      ) : tab === 'backlog' ? (
        <Backlog refreshKey={0} userId={userId} readOnly />
      ) : meta ? (
        <TrophiesPage meta={meta} userId={userId} readOnly onRefresh={loadMeta} />
      ) : (
        <LoadingState />
      )}
    </div>
  )
}
