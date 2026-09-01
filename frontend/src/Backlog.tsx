import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addBacklogGame,
  deleteBacklogGame,
  fetchBacklog,
  searchAllGames,
  setBacklogPriority,
  startBacklogGame,
} from './api'
import type { SearchResult } from './api'
import type { BacklogItem } from './types'
import { badgeClass, formatDate } from './format'

type SortKey = 'priority' | 'recent' | 'title'
type PriorityFilter = 'all' | '2' | '1' | '0'

const SORT_OPTIONS: Array<[SortKey, string]> = [
  ['priority', 'Priority'],
  ['recent', 'Recently added'],
  ['title', 'Title A–Z'],
]

const PRIORITY_FILTER_OPTIONS: Array<[PriorityFilter, string]> = [
  ['all', 'All priorities'],
  ['2', 'High'],
  ['1', 'Medium'],
  ['0', 'Low'],
]

const PRIORITIES: Array<{ value: number; label: string; cls: string }> = [
  { value: 2, label: 'High', cls: 'prio-high' },
  { value: 1, label: 'Medium', cls: 'prio-mid' },
  { value: 0, label: 'Low', cls: 'prio-low' },
]

const PLATFORM_OPTIONS = [
  'PS5',
  'PS4',
  'Steam',
  'Nintendo Switch',
  'Nintendo Switch 2',
  'Xbox Series',
  'PC',
  'Other',
]

function priorityInfo(value: number) {
  return PRIORITIES.find((p) => p.value === value) ?? PRIORITIES[1]
}

export function Backlog({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<BacklogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState('all')
  const [priority, setPriority] = useState<PriorityFilter>('all')
  const [sort, setSort] = useState<SortKey>('priority')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    setLoading(true)
    fetchBacklog()
      .then(setItems)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [refreshKey, reload])

  const handleAdd = useCallback(
    async (data: {
      title: string
      platform: string
      coverUrl?: string
      priority?: number
      notes?: string
    }) => {
      await addBacklogGame(data)
      setShowAdd(false)
      setReload((r) => r + 1)
    },
    [],
  )

  const handlePriority = useCallback(async (id: number, value: number) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, priority: value } : it)))
    await setBacklogPriority(id, value)
  }, [])

  const handleStart = useCallback(async (id: number) => {
    await startBacklogGame(id)
    setSelectedId(null)
    setItems((prev) => prev.filter((it) => it.id !== id))
  }, [])

  const handleDelete = useCallback(async (id: number) => {
    await deleteBacklogGame(id)
    setSelectedId(null)
    setItems((prev) => prev.filter((it) => it.id !== id))
  }, [])

  const platforms = useMemo(() => {
    const set = new Set<string>()
    for (const it of items) set.add(it.platform)
    return [...set].sort()
  }, [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = items.filter((it) => {
      if (q && !it.title.toLowerCase().includes(q)) return false
      if (platform !== 'all' && it.platform !== platform) return false
      if (priority !== 'all' && it.priority !== Number(priority)) return false
      return true
    })
    return list.sort(sorter(sort))
  }, [items, search, platform, priority, sort])

  const selected = selectedId != null ? (items.find((it) => it.id === selectedId) ?? null) : null

  if (loading) {
    return (
      <div className="library">
        <div className="grid">
          {Array.from({ length: 8 }).map((_, i) => (
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
          placeholder="Filter backlog…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={platform}
          onChange={setPlatform}
          options={[['all', 'All platforms'], ...platforms.map((p) => [p, p] as [string, string])]}
        />
        <Select
          value={priority}
          onChange={(v) => setPriority(v as PriorityFilter)}
          options={PRIORITY_FILTER_OPTIONS}
        />
        <Select value={sort} onChange={(v) => setSort(v as SortKey)} options={SORT_OPTIONS} />
        <button className="add-btn" onClick={() => setShowAdd(true)}>
          ＋ Add to backlog
        </button>
      </div>

      <div className="library-meta">{filtered.length} games to play</div>

      {filtered.length ? (
        <div className="grid">
          {filtered.map((it) => (
            <BacklogCard key={it.id} item={it} onOpen={setSelectedId} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="state">Your backlog is empty. Add games you want to play next.</div>
      ) : (
        <div className="state">No games match these filters.</div>
      )}

      {selected ? (
        <BacklogModal
          item={selected}
          onClose={() => setSelectedId(null)}
          onPriority={handlePriority}
          onStart={handleStart}
          onDelete={handleDelete}
        />
      ) : null}

      {showAdd ? <AddBacklogModal onClose={() => setShowAdd(false)} onSave={handleAdd} /> : null}
    </div>
  )
}

function BacklogCard({ item, onOpen }: { item: BacklogItem; onOpen: (id: number) => void }) {
  const prio = priorityInfo(item.priority)
  return (
    <div className="card game" onClick={() => onOpen(item.id)}>
      <div className="cover">
        {item.coverUrl ? (
          <img src={item.coverUrl} alt={item.title} loading="lazy" />
        ) : (
          <div className="cover-fallback">{item.title.slice(0, 1)}</div>
        )}
        <div className="badges badges-left">
          <span className={`badge ${badgeClass(item.platform)}`}>{item.platform}</span>
        </div>
        <div className="badges badges-bottom">
          <span className={`prio-tag ${prio.cls}`}>{prio.label}</span>
        </div>
      </div>
      <div className="game-info">
        <div className="game-title" title={item.title}>
          {item.title}
        </div>
        <div className="game-meta">Added {formatDate(item.createdAt)}</div>
      </div>
    </div>
  )
}

export function BacklogModal({
  item,
  onClose,
  onPriority,
  onStart,
  onDelete,
}: {
  item: BacklogItem
  onClose: () => void
  onPriority: (id: number, value: number) => void | Promise<void>
  onStart: (id: number) => void | Promise<void>
  onDelete: (id: number) => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const start = async () => {
    setBusy(true)
    try {
      await onStart(item.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div
          className="modal-banner"
          style={item.coverUrl ? { backgroundImage: `url(${item.coverUrl})` } : undefined}
        >
          <div className="modal-hero">
            <h2 className="modal-title">{item.title}</h2>
            <div className="modal-platforms">
              <span className={`badge ${badgeClass(item.platform)}`}>{item.platform}</span>
            </div>
          </div>
        </div>

        <div className="modal-content">
          <div className="modal-sub">
            <span>Added {formatDate(item.createdAt)}</span>
          </div>

          <div className="prio-block">
            <span className="rating-label">Priority</span>
            <div className="prio-selector">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  className={`prio-option ${p.cls} ${item.priority === p.value ? 'prio-active' : ''}`}
                  onClick={() => onPriority(item.id, p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {item.notes ? <p className="meta-desc">{item.notes}</p> : null}

          <button className="playing-btn" onClick={start} disabled={busy}>
            ▶ Move to currently playing
          </button>
          <button className="delete-btn" onClick={() => onDelete(item.id)}>
            Remove from backlog
          </button>
        </div>
      </div>
    </div>
  )
}

function AddBacklogModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (data: {
    title: string
    platform: string
    coverUrl?: string
    priority?: number
    notes?: string
  }) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [platform, setPlatform] = useState(PLATFORM_OPTIONS[0])
  const [priority, setPriority] = useState(1)
  const [notes, setNotes] = useState('')
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
        const r = await searchAllGames(q)
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
    const match = PLATFORM_OPTIONS.find((p) =>
      r.platforms.some((rp) => rp.toLowerCase().includes(p.toLowerCase())),
    )
    if (match) setPlatform(match)
    setOpen(false)
    setResults([])
  }

  const submit = async () => {
    if (!title.trim()) return
    setSaving(true)
    try {
      await onSave({
        title: title.trim(),
        platform,
        coverUrl,
        priority,
        notes: notes.trim() || undefined,
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
          <h2 className="add-title">Add a game to your backlog</h2>

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
            <label className="field">
              <span>Platform</span>
              <Select
                value={platform}
                onChange={setPlatform}
                options={PLATFORM_OPTIONS.map((p) => [p, p])}
              />
            </label>
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

          <div className="field">
            <span>Priority</span>
            <div className="prio-selector">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  className={`prio-option ${p.cls} ${priority === p.value ? 'prio-active' : ''}`}
                  onClick={() => setPriority(p.value)}
                  type="button"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Notes (optional)</span>
            <textarea
              className="search notes-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why do you want to play it, where you left off…"
              rows={2}
            />
          </label>

          <button className="sync-btn big" onClick={submit} disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Add to backlog'}
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

function sorter(sort: SortKey): (a: BacklogItem, b: BacklogItem) => number {
  switch (sort) {
    case 'recent':
      return (a, b) => b.createdAt.localeCompare(a.createdAt)
    case 'title':
      return (a, b) => a.title.localeCompare(b.title)
    default:
      return (a, b) => b.priority - a.priority || b.createdAt.localeCompare(a.createdAt)
  }
}
