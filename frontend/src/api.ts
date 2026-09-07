import type { AggregatedGame, BacklogItem, Dashboard, RecentTrophy, User } from './types'

export async function getMe(): Promise<User | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`Auth check failed (${res.status})`)
  return res.json()
}

export async function loginWithGoogle(credential: string): Promise<User> {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ credential }),
  })
  if (!res.ok) throw new Error(`Login failed (${res.status})`)
  return res.json()
}

export async function registerWithPassword(
  email: string,
  password: string,
  name: string,
): Promise<User> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password, name }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.message || `Sign up failed (${res.status})`)
  return data
}

export async function loginWithPassword(email: string, password: string): Promise<User> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.message || `Login failed (${res.status})`)
  return data
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
}

export interface ProviderConnStatus {
  connected: boolean
  error?: string
}

export interface Profile {
  user: User
  connections: { psn: boolean; steam: boolean }
  status: {
    psn: ProviderConnStatus | null
    steam: ProviderConnStatus | null
  }
  steamId: string | null
}

export async function getProfile(): Promise<Profile> {
  const res = await fetch('/api/profile', { credentials: 'include' })
  if (!res.ok) throw new Error(`Failed to load profile (${res.status})`)
  return res.json()
}

export async function connectPsn(npsso: string): Promise<void> {
  const res = await fetch('/api/profile/psn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ npsso }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message || `Failed to save (${res.status})`)
  }
}

export async function disconnectProvider(provider: 'psn' | 'steam'): Promise<void> {
  const res = await fetch(`/api/profile/${provider}`, { method: 'DELETE', credentials: 'include' })
  if (!res.ok) throw new Error(`Failed to disconnect (${res.status})`)
}

// Read endpoints accept an optional userId to view another user's public data. When omitted
// they hit the self-scoped routes; when given they hit the read-only /users/:id/* routes.
function readPath(base: string, userId?: number): string {
  return userId != null ? `/api/users/${userId}/${base}` : `/api/${base}`
}

export async function fetchDashboard(userId?: number): Promise<Dashboard> {
  const res = await fetch(readPath('dashboard', userId))
  if (!res.ok) throw new Error(`Failed to load dashboard (${res.status})`)
  return res.json()
}

export async function fetchGames(userId?: number): Promise<AggregatedGame[]> {
  const res = await fetch(readPath('games', userId))
  if (!res.ok) throw new Error(`Failed to load games (${res.status})`)
  return res.json()
}

export async function fetchTrophies(userId?: number): Promise<RecentTrophy[]> {
  const res = await fetch(readPath('trophies', userId))
  if (!res.ok) throw new Error(`Failed to load trophies (${res.status})`)
  return res.json()
}

export interface UserListItem {
  id: number
  email: string | null
  name: string | null
  picture: string | null
  createdAt: string
  isSelf: boolean
}

export interface UserProfileData {
  user: User
  createdAt: string
  connections: { psn: boolean; steam: boolean }
}

export async function listUsers(): Promise<UserListItem[]> {
  const res = await fetch('/api/users', { credentials: 'include' })
  if (!res.ok) throw new Error(`Failed to load users (${res.status})`)
  return res.json()
}

export async function getUserProfile(userId: number): Promise<UserProfileData> {
  const res = await fetch(`/api/users/${userId}`, { credentials: 'include' })
  if (res.status === 404) throw new Error('User not found')
  if (!res.ok) throw new Error(`Failed to load profile (${res.status})`)
  return res.json()
}

export async function syncNow(): Promise<{ gameCount: number }> {
  const res = await fetch('/api/sync', { method: 'POST' })
  if (!res.ok) throw new Error(`Sync failed (${res.status})`)
  return res.json()
}

// Admin-only: trigger a sync for another user. Fails with 403 for non-admins.
export async function syncUser(userId: number): Promise<{ gameCount: number }> {
  const res = await fetch(`/api/admin/users/${userId}/sync`, { method: 'POST' })
  if (!res.ok) throw new Error(`Sync failed (${res.status})`)
  return res.json()
}

export async function setBeaten(key: string, beaten: boolean): Promise<void> {
  const res = await fetch('/api/games/beaten', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, beaten }),
  })
  if (!res.ok) throw new Error(`Failed to save (${res.status})`)
}

export interface SearchResult {
  name: string
  released?: string
  backgroundImage?: string
  platforms: string[]
}

export async function searchGames(
  q: string,
): Promise<{ configured: boolean; results: SearchResult[] }> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  return res.json()
}

export async function searchAllGames(
  q: string,
): Promise<{ configured: boolean; results: SearchResult[] }> {
  const res = await fetch(`/api/search/all?q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  return res.json()
}

export async function setPlaying(key: string, playing: boolean): Promise<void> {
  const res = await fetch('/api/games/playing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, playing }),
  })
  if (!res.ok) throw new Error(`Failed to save (${res.status})`)
}

export async function setRating(key: string, rating: number): Promise<void> {
  const res = await fetch('/api/games/rating', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, rating }),
  })
  if (!res.ok) throw new Error(`Failed to save rating (${res.status})`)
}

export async function addManualGame(data: {
  title: string
  platform: string
  hours?: number
  beaten?: boolean
  coverUrl?: string
}): Promise<void> {
  const res = await fetch('/api/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Failed to add (${res.status})`)
}

export async function updateManualHours(key: string, hours: number): Promise<void> {
  const id = key.replace('manual:', '')
  const res = await fetch(`/api/manual/${id}/hours`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours }),
  })
  if (!res.ok) throw new Error(`Failed to update hours (${res.status})`)
}

export async function deleteManualGame(key: string): Promise<void> {
  const id = key.replace('manual:', '')
  const res = await fetch(`/api/manual/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Failed to remove (${res.status})`)
}

export async function fetchBacklog(userId?: number): Promise<BacklogItem[]> {
  const res = await fetch(readPath('backlog', userId))
  if (!res.ok) throw new Error(`Failed to load backlog (${res.status})`)
  return res.json()
}

export async function addBacklogGame(data: {
  title: string
  platform: string
  coverUrl?: string
  priority?: number
  notes?: string
}): Promise<void> {
  const res = await fetch('/api/backlog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Failed to add to backlog (${res.status})`)
}

export async function setBacklogPriority(id: number, priority: number): Promise<void> {
  const res = await fetch(`/api/backlog/${id}/priority`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority }),
  })
  if (!res.ok) throw new Error(`Failed to save priority (${res.status})`)
}

export async function startBacklogGame(id: number): Promise<void> {
  const res = await fetch(`/api/backlog/${id}/start`, { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to move to library (${res.status})`)
}

export async function deleteBacklogGame(id: number): Promise<void> {
  const res = await fetch(`/api/backlog/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Failed to remove (${res.status})`)
}

export interface GameMeta {
  found: boolean
  configured: boolean
  publisher?: string
  developer?: string
  genres: string[]
  released?: string
  metacritic?: number
  description?: string
  rawgUrl?: string
}

export async function fetchMeta(key: string, title: string): Promise<GameMeta> {
  const res = await fetch(
    `/api/meta?key=${encodeURIComponent(key)}&title=${encodeURIComponent(title)}`,
  )
  if (!res.ok) throw new Error(`Failed to load info (${res.status})`)
  return res.json()
}
