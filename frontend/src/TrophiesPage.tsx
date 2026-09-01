import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  deleteManualGame,
  fetchGames,
  fetchTrophies,
  setBeaten,
  setPlaying,
  setRating,
} from './api'
import type { AggregatedGame, Dashboard, RecentTrophy } from './types'
import { GameModal } from './components/GameCard'
import { TrophyModal } from './components/TrophyModal'
import { formatDate, formatNumber } from './format'

const TROPHIES_PER_PAGE = 10
const PLATINUMS_PER_PAGE = 10

interface Completion {
  key: string
  provider: 'psn' | 'steam'
  title: string
  name?: string
  coverUrl?: string
  platinumIconUrl?: string
  earnedAt?: string
  rarity?: number
}

export function TrophiesPage({
  meta,
  onRefresh,
}: {
  meta: Dashboard
  onRefresh: () => void | Promise<void>
}) {
  const [trophies, setTrophies] = useState<RecentTrophy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'trophies' | 'completions'>('trophies')
  const [games, setGames] = useState<Record<string, AggregatedGame>>({})
  const [selGame, setSelGame] = useState<AggregatedGame | null>(null)
  const [selTrophy, setSelTrophy] = useState<RecentTrophy | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchTrophies()
      .then(setTrophies)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchGames()
      .then((list) => setGames(Object.fromEntries(list.map((g) => [g.key, g]))))
      .catch(() => {})
  }, [])

  const openGame = useCallback(
    (key: string) => {
      const g = games[key]
      if (g) setSelGame(g)
    },
    [games],
  )

  const gToggleBeaten = useCallback(
    async (key: string, beaten: boolean) => {
      await setBeaten(key, beaten)
      setSelGame((s) => (s ? { ...s, beaten } : s))
      setGames((m) => (m[key] ? { ...m, [key]: { ...m[key], beaten } } : m))
      void onRefresh()
    },
    [onRefresh],
  )
  const gTogglePlaying = useCallback(
    async (key: string, playing: boolean) => {
      await setPlaying(key, playing)
      setSelGame((s) => (s ? { ...s, playing } : s))
      setGames((m) => (m[key] ? { ...m, [key]: { ...m[key], playing } } : m))
      void onRefresh()
    },
    [onRefresh],
  )
  const gRate = useCallback(
    async (key: string, rating: number) => {
      setSelGame((s) => (s ? { ...s, rating } : s))
      setGames((m) => (m[key] ? { ...m, [key]: { ...m[key], rating } } : m))
      await setRating(key, rating)
      void onRefresh()
    },
    [onRefresh],
  )
  const gDelete = useCallback(
    async (key: string) => {
      await deleteManualGame(key)
      setSelGame(null)
      void onRefresh()
    },
    [onRefresh],
  )

  const completions = useMemo<Completion[]>(() => {
    const psn = meta.recentPlatinums.psn.map((x) => ({ ...x, provider: 'psn' as const }))
    const steam = meta.recentPlatinums.steam.map((x) => ({ ...x, provider: 'steam' as const }))
    return [...psn, ...steam]
  }, [meta])

  const completionSorts: SortOption<Completion>[] = [
    {
      key: 'recent',
      label: 'Recent',
      compare: (a, b) => (b.earnedAt ?? '').localeCompare(a.earnedAt ?? ''),
    },
    { key: 'rarity', label: 'Rarest', compare: (a, b) => (a.rarity ?? 101) - (b.rarity ?? 101) },
  ]

  const trophySorts: SortOption<RecentTrophy>[] = [
    {
      key: 'recent',
      label: 'Recent',
      compare: (a, b) => (b.earnedAt ?? '').localeCompare(a.earnedAt ?? ''),
    },
    { key: 'rarity', label: 'Rarest', compare: (a, b) => (a.rarity ?? 101) - (b.rarity ?? 101) },
  ]

  const providerFilters: FilterOption<RecentTrophy>[] = [
    { key: 'all', label: 'All', predicate: () => true },
    { key: 'psn', label: 'PlayStation', predicate: (t) => t.provider === 'psn' },
    { key: 'steam', label: 'Steam', predicate: (t) => t.provider === 'steam' },
  ]

  return (
    <div className="dashboard">
      <div className="trophy-profile">
        <SourceStat
          name="PlayStation"
          cls="src-psn"
          earned={meta.trophiesByProvider.psn.earned}
          games={meta.trophiesByProvider.psn.gamesWithTrophies}
          unit="trophies"
        />
        <SourceStat
          name="Steam"
          cls="src-steam"
          earned={meta.trophiesByProvider.steam.earned}
          games={meta.trophiesByProvider.steam.gamesWithTrophies}
          unit="achievements"
        />
      </div>

      {loading ? (
        <div className="widget-empty" style={{ padding: '20px' }}>
          Loading trophies…
        </div>
      ) : error ? (
        <div className="state state-error">{error}</div>
      ) : (
        (() => {
          const tabsNode = (
            <div className="wtabs">
              <button
                className={`wtab ${tab === 'trophies' ? 'wtab-active' : ''}`}
                onClick={() => setTab('trophies')}
              >
                Trophies
              </button>
              <button
                className={`wtab ${tab === 'completions' ? 'wtab-active' : ''}`}
                onClick={() => setTab('completions')}
              >
                Platinums &amp; 100%
              </button>
            </div>
          )
          return tab === 'trophies' ? (
            <PagedWidget
              tabs={tabsNode}
              title="Trophies"
              items={trophies}
              pageSize={TROPHIES_PER_PAGE}
              empty="No trophies yet. Sync to load them."
              filters={providerFilters}
              sorts={trophySorts}
              render={(t, i) => <TrophyRow key={i} t={t} onOpen={() => setSelTrophy(t)} />}
            />
          ) : (
            <PagedWidget
              tabs={tabsNode}
              title="Platinums & 100%"
              items={completions}
              pageSize={PLATINUMS_PER_PAGE}
              empty="No platinums or 100% games yet."
              sorts={completionSorts}
              render={(c, i) => {
                const clickable = !!games[c.key]
                const label = c.name ?? (c.provider === 'psn' ? 'Platinum' : '100% completed')
                const glow = c.provider === 'psn' ? 'platinum' : 'steam'
                const inner = (
                  <>
                    <div className="tro-thumb">
                      {c.coverUrl ? (
                        <img className="tro-cover" src={c.coverUrl} alt="" loading="lazy" />
                      ) : (
                        <div className="tro-cover tro-cover-empty">{c.title.slice(0, 1)}</div>
                      )}
                      {c.platinumIconUrl ? (
                        <img
                          className={`tro-badge tt-glow-${glow}`}
                          src={c.platinumIconUrl}
                          alt=""
                          loading="lazy"
                        />
                      ) : null}
                    </div>
                    <div className="tro-info">
                      <div className="tro-name" title={label}>
                        {label}
                      </div>
                      <div className="tro-sub">
                        {c.title}
                        {c.earnedAt ? ` · ${formatDate(c.earnedAt)}` : ''}
                      </div>
                    </div>
                    <div className="tro-meta">
                      <span className={`src-tag src-${c.provider}`}>
                        {c.provider === 'psn' ? 'PlayStation' : 'Steam'}
                      </span>
                      {c.rarity != null ? <span className="tro-rarity">{c.rarity}%</span> : null}
                    </div>
                  </>
                )
                return clickable ? (
                  <button
                    key={i}
                    className="tro-row plat-row-btn"
                    title={c.title}
                    onClick={() => openGame(c.key)}
                  >
                    {inner}
                  </button>
                ) : (
                  <div key={i} className="tro-row" title={c.title}>
                    {inner}
                  </div>
                )
              }}
            />
          )
        })()
      )}

      {selGame ? (
        <GameModal
          game={selGame}
          onClose={() => setSelGame(null)}
          onToggleBeaten={gToggleBeaten}
          onTogglePlaying={gTogglePlaying}
          onRate={gRate}
          onDelete={gDelete}
        />
      ) : null}

      {selTrophy ? <TrophyModal trophy={selTrophy} onClose={() => setSelTrophy(null)} /> : null}
    </div>
  )
}

interface SortOption<T> {
  key: string
  label: string
  compare: (a: T, b: T) => number
}

interface FilterOption<T> {
  key: string
  label: string
  predicate: (item: T) => boolean
}

function PagedWidget<T>({
  title,
  tabs,
  items,
  pageSize,
  empty,
  render,
  sorts,
  filters,
}: {
  title: string
  tabs?: ReactNode
  items: T[]
  pageSize: number
  empty: string
  render: (item: T, index: number) => ReactNode
  sorts?: SortOption<T>[]
  filters?: FilterOption<T>[]
}) {
  const [page, setPage] = useState(1)
  const [sortIdx, setSortIdx] = useState(0)
  const [filterIdx, setFilterIdx] = useState(0)

  const processed = useMemo(() => {
    let list = filters ? items.filter(filters[filterIdx].predicate) : items
    if (sorts) list = [...list].sort(sorts[sortIdx].compare)
    return list
  }, [items, sorts, sortIdx, filters, filterIdx])

  const totalPages = Math.max(1, Math.ceil(processed.length / pageSize))
  const current = Math.min(page, totalPages)
  const pageItems = processed.slice((current - 1) * pageSize, current * pageSize)

  return (
    <div className="widget">
      <div className="widget-head">
        {tabs ?? <span className="widget-title">{title}</span>}
        <div className="widget-head-right">
          {filters && filters.length > 1 ? (
            <div className="seg">
              {filters.map((f, i) => (
                <button
                  key={f.key}
                  className={`seg-btn ${filterIdx === i ? 'seg-active' : ''}`}
                  onClick={() => {
                    setFilterIdx(i)
                    setPage(1)
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          ) : null}
          {sorts && sorts.length > 1 ? (
            <div className="seg">
              {sorts.map((s, i) => (
                <button
                  key={s.key}
                  className={`seg-btn ${sortIdx === i ? 'seg-active' : ''}`}
                  onClick={() => {
                    setSortIdx(i)
                    setPage(1)
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}
          <span className="widget-count">{processed.length}</span>
        </div>
      </div>
      <div className="widget-body">
        {items.length ? (
          <>
            <div className="tro-list">{pageItems.map(render)}</div>
            {totalPages > 1 ? (
              <div className="pagination">
                <button
                  className="page-btn"
                  onClick={() => setPage(current - 1)}
                  disabled={current <= 1}
                >
                  ← Prev
                </button>
                <span className="page-info">
                  {current} / {totalPages}
                </span>
                <button
                  className="page-btn"
                  onClick={() => setPage(current + 1)}
                  disabled={current >= totalPages}
                >
                  Next →
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="widget-empty">{empty}</div>
        )}
      </div>
    </div>
  )
}

function SourceStat({
  name,
  cls,
  earned,
  games,
  unit,
}: {
  name: string
  cls: string
  earned: number
  games: number
  unit: string
}) {
  return (
    <div className="source-stat">
      <span className={`src-tag ${cls}`}>{name}</span>
      <div className="source-stat-num">{formatNumber(earned)}</div>
      <div className="source-stat-sub">
        {unit} · {formatNumber(games)} games
      </div>
    </div>
  )
}

function TrophyRow({ t, onOpen }: { t: RecentTrophy; onOpen: () => void }) {
  const glow = t.type ?? t.provider
  return (
    <button className="tro-row plat-row-btn" onClick={onOpen} title={`${t.name} · ${t.gameTitle}`}>
      <div className="tro-thumb">
        {t.gameIconUrl ? (
          <img className="tro-cover" src={t.gameIconUrl} alt="" loading="lazy" />
        ) : (
          <div className="tro-cover tro-cover-empty">{(t.gameTitle || t.name).slice(0, 1)}</div>
        )}
        {t.iconUrl ? (
          <img className={`tro-badge tt-glow-${glow}`} src={t.iconUrl} alt="" loading="lazy" />
        ) : null}
      </div>
      <div className="tro-info">
        <div className="tro-name" title={t.name}>
          {t.name}
        </div>
        <div className="tro-sub">
          {t.gameTitle}
          {t.earnedAt ? ` · ${formatDate(t.earnedAt)}` : ''}
        </div>
      </div>
      <div className="tro-meta">
        <span className={`src-tag src-${t.provider}`}>
          {t.provider === 'psn' ? 'PlayStation' : 'Steam'}
        </span>
        {t.rarity != null ? <span className="tro-rarity">{t.rarity}%</span> : null}
      </div>
    </button>
  )
}
