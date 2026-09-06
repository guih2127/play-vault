import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listUsers, type UserListItem } from './api'
import { formatDate } from './format'
import { LoadingState } from './components/Spinner'

export function Users() {
  const [users, setUsers] = useState<UserListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch((e) => setError((e as Error).message))
  }, [])

  const filtered = useMemo(() => {
    if (!users) return []
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) =>
      (u.name ?? u.email ?? '').toLowerCase().includes(q),
    )
  }, [users, search])

  const open = (u: UserListItem) => navigate(u.isSelf ? '/' : `/users/${u.id}`)

  if (error) return <div className="state state-error">{error}</div>
  if (!users) return <LoadingState label="Loading players…" />

  return (
    <div className="dashboard">
      <div className="controls">
        <input
          className="search"
          placeholder="Search players…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="library-meta">{filtered.length} players</div>

      {filtered.length ? (
        <div className="users-grid">
          {filtered.map((u) => {
            const label = u.name ?? u.email ?? 'Unknown'
            return (
              <button key={u.id} className="user-card" onClick={() => open(u)} title={label}>
                {u.picture ? (
                  <img
                    className="user-card-avatar"
                    src={u.picture}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="user-card-avatar user-card-avatar-empty">
                    {label.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="user-card-info">
                  <div className="user-card-name">
                    {label}
                    {u.isSelf ? <span className="user-card-you">You</span> : null}
                  </div>
                  <div className="user-card-sub">Joined {formatDate(u.createdAt)}</div>
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="state">No players found.</div>
      )}
    </div>
  )
}
