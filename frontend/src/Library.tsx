import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addManualGame,
  deleteManualGame,
  fetchGames,
  searchGames,
  setBeaten,
  setPlaying,
  setRating,
  updateManualHours,
} from './api'
import type { SearchResult } from './api'
import type { AggregatedGame } from './types'
import { GameCard, GameModal, pct } from './components/GameCard'

type SortKey = 'trophies' | 'playtime' | 'recent' | 'title' | 'platinum'
type StatusFilter = 'all' | 'playing' | 'platinum' | 'beaten' | 'unbeaten' | 'manual'

const CARD_MIN = 158
const CARD_GAP = 16

const SORT_OPTIONS: Array<[SortKey, string]> = [
  ['trophies', '% trophies'],
  ['playtime', 'Most played'],
  ['recent', 'Recent'],
  ['title', 'Title A–Z'],
  ['platinum', 'Platinums'],
]

const STATUS_OPTIONS: Array<[StatusFilter, string]> = [
  ['all', 'All'],
  ['playing', 'Currently playing'],
  ['platinum', 'Platinum'],
  ['beaten', 'Beaten'],
  ['unbeaten', 'Not beaten'],
  ['manual', 'Manually added'],
]

function isPlatinum(g: AggregatedGame): boolean {
  return g.platinum.earned > 0
}

function isBeaten(g: AggregatedGame): boolean {
  return isPlatinum(g) || !!g.beaten
}

export function Library({
  refreshKey,
  initialStatus = 'all',
}: {
  refreshKey: number
  initialStatus?: StatusFilter
}) {
  const [games, setGames] = useState<AggregatedGame[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState('all')
  const [status, setStatus] = useState<StatusFilter>(initialStatus)
  const [sort, setSort] = useState<SortKey>('trophies')
  const [rows, setRows] = useState(3)
  const [page, setPage] = useState(1)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [reload, setReload] = useState(0)

  const gridRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(6)

  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const compute = () => {
      const w = el.clientWidth
      if (w > 0) setCols(Math.max(1, Math.floor((w + CARD_GAP) / (CARD_MIN + CARD_GAP))))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading])

  const pageSize = cols * rows

  useEffect(() => {
    setLoading(true)
    fetchGames()
      .then(setGames)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [refreshKey, reload])

  const handleToggleBeaten = useCallback(async (key: string, beaten: boolean) => {
    await setBeaten(key, beaten)
    setGames((prev) => prev.map((g) => (g.key === key ? { ...g, beaten } : g)))
  }, [])

  const handleTogglePlaying = useCallback(async (key: string, playing: boolean) => {
    await setPlaying(key, playing)
    setGames((prev) => prev.map((g) => (g.key === key ? { ...g, playing } : g)))
  }, [])

  const handleRate = useCallback(async (key: string, rating: number) => {
    setGames((prev) => prev.map((g) => (g.key === key ? { ...g, rating } : g)))
    await setRating(key, rating)
  }, [])

  const handleDelete = useCallback(async (key: string) => {
    await deleteManualGame(key)
    setSelectedKey(null)
    setReload((r) => r + 1)
  }, [])

  const handleUpdateHours = useCallback(async (key: string, hours: number) => {
    await updateManualHours(key, hours)
    // Mirror the backend: hours <= 0 clears the playtime. Update in place so the modal stays open.
    const minutes = hours > 0 ? Math.round(hours * 60) : 0
    setGames((prev) =>
      prev.map((g) =>
        g.key === key ? { ...g, totalPlaytimeMinutes: minutes, playtimeKnown: hours > 0 } : g,
      ),
    )
  }, [])

  const handleAdd = useCallback(
    async (data: {
      title: string
      platform: string
      hours?: number
      beaten?: boolean
      coverUrl?: string
    }) => {
      await addManualGame(data)
      setShowAdd(false)
      setReload((r) => r + 1)
    },
    [],
  )

  const platforms = useMemo(() => {
    const set = new Set<string>()
    for (const g of games) for (const p of g.platformLabels) set.add(p)
    return [...set].sort()
  }, [games])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = games.filter((g) => {
      if (q && !g.title.toLowerCase().includes(q)) return false
      if (platform !== 'all' && !g.platformLabels.includes(platform)) return false
      if (status === 'playing' && !g.playing) return false
      if (status === 'platinum' && !isPlatinum(g)) return false
      if (status === 'beaten' && !isBeaten(g)) return false
      if (status === 'unbeaten' && isBeaten(g)) return false
      if (status === 'manual' && !g.manual) return false
      return true
    })
    return list.sort(sorter(sort))
  }, [games, search, platform, status, sort])

  useEffect(() => {
    setPage(1)
  }, [search, platform, status, sort, rows])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, totalPages)
  const pageItems = filtered.slice((current - 1) * pageSize, current * pageSize)
  const selected = selectedKey ? (games.find((g) => g.key === selectedKey) ?? null) : null

  if (loading) {
    return (
      <div className="library">
        <div className="grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="card skeleton">
              <div className="skeleton-cover" />
              <div className="skeleton-line" />
              <div className="skeleton-line short" />
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (error) return <div className="state state-error">{error}</div>

  return (
    <div className="library">
      <div className="controls">
        <input
          className="search"
          placeholder="Search game…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={platform}
          onChange={setPlatform}
          options={[['all', 'All platforms'], ...platforms.map((p) => [p, p] as [string, string])]}
        />
        <Select
          value={status}
          onChange={(v) => setStatus(v as StatusFilter)}
          options={STATUS_OPTIONS}
        />
        <Select value={sort} onChange={(v) => setSort(v as SortKey)} options={SORT_OPTIONS} />
        <button className="add-btn" onClick={() => setShowAdd(true)}>
          ＋ Add
        </button>
      </div>

      <div className="library-meta">{filtered.length} games</div>

      {pageItems.length ? (
        <div className="grid" ref={gridRef}>
          {pageItems.map((g) => (
            <GameCard key={g.key} game={g} onOpen={setSelectedKey} />
          ))}
        </div>
      ) : (
        <div className="state">No games match these filters.</div>
      )}

      <div className="pagination">
        <button
          className="page-btn"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={current <= 1}
        >
          ← Previous
        </button>
        <span className="page-info">
          Page {current} of {totalPages}
        </span>
        <button
          className="page-btn"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={current >= totalPages}
        >
          Next →
        </button>
        <select
          className="select page-size"
          value={rows}
          onChange={(e) => setRows(Number(e.target.value))}
        >
          {[3, 4, 5, 6, 8].map((n) => (
            <option key={n} value={n}>
              {n} rows
            </option>
          ))}
        </select>
      </div>

      {selected ? (
        <GameModal
          game={selected}
          onClose={() => setSelectedKey(null)}
          onToggleBeaten={handleToggleBeaten}
          onTogglePlaying={handleTogglePlaying}
          onRate={handleRate}
          onDelete={handleDelete}
          onUpdateHours={handleUpdateHours}
        />
      ) : null}

      {showAdd ? <AddGameModal onClose={() => setShowAdd(false)} onSave={handleAdd} /> : null}
    </div>
  )
}

function AddGameModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (data: {
    title: string
    platform: string
    hours?: number
    beaten?: boolean
    coverUrl?: string
  }) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [hours, setHours] = useState('')
  const [beaten, setBeaten] = useState(false)
  const [coverUrl, setCoverUrl] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!open) return
    const q = title.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await searchGames(q)
        setConfigured(r.configured)
        setResults(r.results)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [title, open])

  const pick = (r: SearchResult) => {
    setTitle(r.name)
    setCoverUrl(r.backgroundImage)
    setOpen(false)
    setResults([])
  }

  const submit = async () => {
    if (!title.trim()) return
    setSaving(true)
    try {
      const h = parseFloat(hours.replace(',', '.'))
      await onSave({
        title: title.trim(),
        platform: 'Nintendo Switch 2',
        hours: Number.isFinite(h) && h > 0 ? h : undefined,
        beaten,
        coverUrl,
      })
    } finally {
      setSaving(false)
    }
  }

  const showDropdown = open && (searching || results.length > 0 || !configured)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal add-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="add-content">
          <h2 className="add-title">Add a Nintendo Switch 2 game</h2>

          <div className="field field-search">
            <span>Title</span>
            <input
              className="search"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setOpen(true)
                setCoverUrl(undefined)
              }}
              placeholder="Type to search…"
              autoFocus
            />
            {showDropdown ? (
              <div className="autocomplete">
                {!configured ? (
                  <div className="ac-hint">
                    Add the RAWG key to search and fetch covers automatically.
                  </div>
                ) : searching && results.length === 0 ? (
                  <div className="ac-hint">Searching…</div>
                ) : (
                  results.map((r, i) => (
                    <button key={i} className="ac-item" onClick={() => pick(r)}>
                      {r.backgroundImage ? (
                        <img src={r.backgroundImage} alt="" />
                      ) : (
                        <div className="ac-noimg" />
                      )}
                      <div className="ac-text">
                        <div className="ac-name">{r.name}</div>
                        <div className="ac-meta">
                          {r.released ? r.released.slice(0, 4) : '—'}
                          {r.platforms.length ? ` · ${r.platforms.slice(0, 3).join(', ')}` : ''}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <div className="add-cover-row">
            {coverUrl ? (
              <img className="add-cover" src={coverUrl} alt="" />
            ) : (
              <div className="add-cover add-cover-empty">no cover</div>
            )}
            <div className="add-platform-note">
              <span>Platform</span>
              <span className="badge badge-switch">Nintendo Switch 2</span>
            </div>
          </div>

          <label className="field">
            <span>Cover (URL, optional)</span>
            <input
              className="search"
              value={coverUrl ?? ''}
              onChange={(e) => setCoverUrl(e.target.value || undefined)}
              placeholder="Paste an image URL (cover/logo)"
            />
          </label>

          <label className="field">
            <span>Hours played (optional)</span>
            <input
              className="search"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="e.g. 120"
              inputMode="decimal"
            />
          </label>
          <label className="field-check">
            <input type="checkbox" checked={beaten} onChange={(e) => setBeaten(e.target.checked)} />
            <span>Mark as beaten</span>
          </label>
          <button className="sync-btn big" onClick={submit} disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: Array<[T, string]>
}) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  )
}

function sorter(sort: SortKey): (a: AggregatedGame, b: AggregatedGame) => number {
  switch (sort) {
    case 'playtime':
      return (a, b) => b.totalPlaytimeMinutes - a.totalPlaytimeMinutes
    case 'recent':
      return (a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? '')
    case 'title':
      return (a, b) => a.title.localeCompare(b.title)
    case 'platinum':
      return (a, b) =>
        b.platinum.earned - a.platinum.earned || b.totalPlaytimeMinutes - a.totalPlaytimeMinutes
    default:
      return (a, b) => trophyPct(b) - trophyPct(a)
  }
}

function trophyPct(g: AggregatedGame): number {
  const earned = g.trophySets.reduce((s, t) => s + t.earned, 0)
  const total = g.trophySets.reduce((s, t) => s + t.total, 0)
  return pct(earned, total)
}
