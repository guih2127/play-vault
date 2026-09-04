import { useEffect, useRef, useState } from 'react'
import type {
  AggregatedGame,
  BacklogItem,
  Dashboard,
  ProviderTrophies,
  RecentTrophy,
} from './types'
import { GameModal } from './components/GameCard'
import { TrophyModal } from './components/TrophyModal'
import { BacklogModal } from './Backlog'
import {
  deleteBacklogGame,
  deleteManualGame,
  fetchGames,
  setBacklogPriority,
  setBeaten,
  setPlaying,
  setRating,
  startBacklogGame,
  updateManualHours,
} from './api'

const GRID_MIN = 150
const GRID_GAP = 12
const GRID_ROWS = 3
const HOME_LIMIT = 5
import { badgeClass, formatDate, formatNumber } from './format'

interface PlatItem {
  key: string
  title: string
  name?: string
  coverUrl?: string
  earnedAt?: string
  platinumIconUrl?: string
  rarity?: number
  provider: 'psn' | 'steam'
}

const PRIORITY_LABEL: Record<number, { label: string; cls: string }> = {
  2: { label: 'High', cls: 'prio-high' },
  1: { label: 'Medium', cls: 'prio-mid' },
  0: { label: 'Low', cls: 'prio-low' },
}

export function Overview({
  meta,
  onRefresh,
  onGoBacklog,
  onGoLibrary,
  onGoPlaying,
  onGoTrophies,
}: {
  meta: Dashboard
  onRefresh: () => void | Promise<void>
  onGoBacklog: () => void
  onGoLibrary: () => void
  onGoPlaying: () => void
  onGoTrophies: () => void
}) {
  const heroImage =
    meta.playingGames[0]?.coverUrl ?? meta.mostPlayed[0]?.coverUrl ?? meta.beatenGames[0]?.coverUrl

  const [selGame, setSelGame] = useState<AggregatedGame | null>(null)
  const [selBacklog, setSelBacklog] = useState<BacklogItem | null>(null)
  const [selTrophy, setSelTrophy] = useState<RecentTrophy | null>(null)
  const [gamesByKey, setGamesByKey] = useState<Record<string, AggregatedGame>>({})

  useEffect(() => {
    fetchGames()
      .then((list) => setGamesByKey(Object.fromEntries(list.map((g) => [g.key, g]))))
      .catch(() => {})
  }, [meta])

  const openByKey = (key: string) => {
    const g = gamesByKey[key]
    if (g) setSelGame(g)
  }

  const gToggleBeaten = async (key: string, beaten: boolean) => {
    await setBeaten(key, beaten)
    setSelGame((s) => (s ? { ...s, beaten } : s))
    void onRefresh()
  }
  const gTogglePlaying = async (key: string, playing: boolean) => {
    await setPlaying(key, playing)
    setSelGame((s) => (s ? { ...s, playing } : s))
    void onRefresh()
  }
  const gRate = async (key: string, rating: number) => {
    setSelGame((s) => (s ? { ...s, rating } : s))
    await setRating(key, rating)
    void onRefresh()
  }
  const gDelete = async (key: string) => {
    await deleteManualGame(key)
    setSelGame(null)
    void onRefresh()
  }
  const gUpdateHours = async (key: string, hours: number) => {
    await updateManualHours(key, hours)
    const minutes = hours > 0 ? Math.round(hours * 60) : 0
    setSelGame((s) => (s ? { ...s, totalPlaytimeMinutes: minutes, playtimeKnown: hours > 0 } : s))
    void onRefresh()
  }

  const bPriority = async (id: number, priority: number) => {
    setSelBacklog((s) => (s ? { ...s, priority } : s))
    await setBacklogPriority(id, priority)
    void onRefresh()
  }
  const bStart = async (id: number) => {
    await startBacklogGame(id)
    setSelBacklog(null)
    void onRefresh()
  }
  const bDelete = async (id: number) => {
    await deleteBacklogGame(id)
    setSelBacklog(null)
    void onRefresh()
  }

  return (
    <div className="dashboard">
      <div className="hero">
        {heroImage ? (
          <div className="hero-bg" style={{ backgroundImage: `url(${heroImage})` }} />
        ) : null}
        <div className="stat-strip">
          <StatItem value={formatNumber(meta.counts.beaten)} label="Beaten" accent="green" />
          <StatItem value={formatNumber(meta.counts.platinum)} label="Platinums" accent="plat" />
          <StatItem
            value={formatNumber(Math.round(meta.counts.playtimeHours))}
            label="Hours played"
          />
          <StatItem
            value={formatNumber(meta.totals.trophiesEarned)}
            label="Trophies"
            accent="gold"
          />
        </div>
      </div>

      <div className="widgets">
        <PlayingWidget
          games={meta.playingGames}
          onGoPlaying={onGoPlaying}
          onGoBacklog={onGoBacklog}
          onOpenGame={setSelGame}
        />
        <NextUpWidget
          items={meta.backlogPreview}
          count={meta.backlogCount}
          onGoBacklog={onGoBacklog}
          onOpenItem={setSelBacklog}
        />
      </div>

      <TrophiesWidget
        trophies={meta.trophiesByProvider}
        platinums={meta.recentPlatinums}
        trophiesList={meta.recentTrophies}
        gamesByKey={gamesByKey}
        onOpenGame={openByKey}
        onOpenTrophy={setSelTrophy}
        onGoTrophies={onGoTrophies}
      />

      <BeatenWidget games={meta.beatenGames} onOpenGame={setSelGame} onGoLibrary={onGoLibrary} />

      {selGame ? (
        <GameModal
          game={selGame}
          onClose={() => setSelGame(null)}
          onToggleBeaten={gToggleBeaten}
          onTogglePlaying={gTogglePlaying}
          onRate={gRate}
          onDelete={gDelete}
          onUpdateHours={gUpdateHours}
        />
      ) : null}

      {selBacklog ? (
        <BacklogModal
          item={selBacklog}
          onClose={() => setSelBacklog(null)}
          onPriority={bPriority}
          onStart={bStart}
          onDelete={bDelete}
        />
      ) : null}

      {selTrophy ? <TrophyModal trophy={selTrophy} onClose={() => setSelTrophy(null)} /> : null}
    </div>
  )
}

function PlayingWidget({
  games,
  onGoPlaying,
  onGoBacklog,
  onOpenGame,
}: {
  games: AggregatedGame[]
  onGoPlaying: () => void
  onGoBacklog: () => void
  onOpenGame: (game: AggregatedGame) => void
}) {
  return (
    <div className="widget">
      <div className="widget-head">
        <span className="widget-title">Currently playing</span>
        <div className="widget-head-right">
          {games.length ? <span className="widget-count">{games.length}</span> : null}
          <button className="widget-link" onClick={onGoPlaying} aria-label="Open currently playing">
            →
          </button>
        </div>
      </div>
      <div className="widget-body">
        {games.length ? (
          <>
            <div className="plat-latest-head">Playing right now</div>
            <div className="nextup-list">
              {games.slice(0, HOME_LIMIT).map((g) => (
                <PlayingTile key={g.key} game={g} onOpen={() => onOpenGame(g)} />
              ))}
            </div>
          </>
        ) : (
          <div className="widget-empty">
            Nothing in progress right now.
            <button className="widget-link" onClick={onGoBacklog}>
              Start one from your backlog →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function PlayingTile({ game, onOpen }: { game: AggregatedGame; onOpen: () => void }) {
  const earned = game.trophySets.reduce((s, t) => s + t.earned, 0)
  const total = game.trophySets.reduce((s, t) => s + t.total, 0)
  const progress = total ? Math.round((earned / total) * 100) : null
  const hours = game.playtimeKnown ? `${Math.round(game.totalPlaytimeMinutes / 60)}h` : null
  const beaten = game.platinum.earned > 0 || !!game.beaten
  return (
    <button className="nextup-item playing-row" onClick={onOpen} title={game.title}>
      {game.coverUrl ? (
        <img className="nextup-cover" src={game.coverUrl} alt="" loading="lazy" />
      ) : (
        <div className="nextup-cover nextup-cover-empty">{game.title.slice(0, 1)}</div>
      )}
      <div className="nextup-info">
        <div className="nextup-title">{game.title}</div>
        <div className="nextup-sub">
          <span className={`badge ${badgeClass(game.platformLabels[0] ?? '')}`}>
            {game.platformLabels[0] ?? '—'}
          </span>
          <span className={`playing-status ${beaten ? 'playing-status-on' : ''}`}>
            {beaten ? '✓ Beaten' : 'Not beaten'}
          </span>
          {progress != null ? (
            <span className="playing-pct">
              🏆 {progress}%{' '}
              <span className="playing-pct-sub">
                ({earned}/{total})
              </span>
            </span>
          ) : null}
          {hours ? <span className="playing-hours">{hours}</span> : null}
        </div>
      </div>
    </button>
  )
}

function StatItem({
  value,
  label,
  accent,
}: {
  value: string
  label: string
  accent?: 'green' | 'plat' | 'gold'
}) {
  return (
    <div className={`stat-item ${accent ? `stat-${accent}` : ''}`}>
      <div className="stat-num">{value}</div>
      <div className="stat-cap">{label}</div>
    </div>
  )
}

function TrophiesWidget({
  trophies,
  platinums,
  trophiesList,
  gamesByKey,
  onOpenGame,
  onOpenTrophy,
  onGoTrophies,
}: {
  trophies: { psn: ProviderTrophies; steam: ProviderTrophies }
  platinums: Dashboard['recentPlatinums']
  trophiesList: Dashboard['recentTrophies']
  gamesByKey: Record<string, AggregatedGame>
  onOpenGame: (key: string) => void
  onOpenTrophy: (trophy: RecentTrophy) => void
  onGoTrophies: () => void
}) {
  const [provider, setProvider] = useState<'all' | 'psn' | 'steam'>('all')
  const [mode, setMode] = useState<'platinums' | 'trophies'>('platinums')

  const byDate = <T extends { earnedAt?: string }>(a: T[], b: T[]) =>
    [...a, ...b].sort((x, y) => (y.earnedAt ?? '').localeCompare(x.earnedAt ?? ''))

  const t: ProviderTrophies =
    provider === 'all'
      ? {
          earned: trophies.psn.earned + trophies.steam.earned,
          total: trophies.psn.total + trophies.steam.total,
          platinumEarned: trophies.psn.platinumEarned + trophies.steam.platinumEarned,
          platinumTotal: trophies.psn.platinumTotal + trophies.steam.platinumTotal,
          gamesWithTrophies: trophies.psn.gamesWithTrophies + trophies.steam.gamesWithTrophies,
          beaten: trophies.psn.beaten + trophies.steam.beaten,
        }
      : trophies[provider]
  const platsPsn: PlatItem[] = platinums.psn.map((p) => ({ ...p, provider: 'psn' }))
  const platsSteam: PlatItem[] = platinums.steam.map((p) => ({ ...p, provider: 'steam' }))
  const plats =
    provider === 'all' ? byDate(platsPsn, platsSteam) : provider === 'psn' ? platsPsn : platsSteam
  const tros =
    provider === 'all' ? byDate(trophiesList.psn, trophiesList.steam) : trophiesList[provider]
  const showPlat = provider !== 'steam'

  const listHead =
    mode === 'trophies'
      ? 'Latest trophies'
      : provider === 'steam'
        ? 'Latest 100%'
        : 'Latest platinums'

  return (
    <div className="widget widget-trophies">
      <div className="widget-head">
        <span className="widget-title">Trophies earned</span>
        <div className="widget-head-right">
          <div className="seg">
            <button
              className={`seg-btn ${provider === 'all' ? 'seg-active' : ''}`}
              onClick={() => setProvider('all')}
            >
              All
            </button>
            <button
              className={`seg-btn ${provider === 'psn' ? 'seg-active' : ''}`}
              onClick={() => setProvider('psn')}
            >
              PSN
            </button>
            <button
              className={`seg-btn ${provider === 'steam' ? 'seg-active' : ''}`}
              onClick={() => setProvider('steam')}
            >
              Steam
            </button>
          </div>
          <div className="seg seg-mode">
            <button
              className={`seg-btn ${mode === 'platinums' ? 'seg-active' : ''}`}
              onClick={() => setMode('platinums')}
            >
              {provider === 'steam' ? '100%' : 'Platinums'}
            </button>
            <button
              className={`seg-btn ${mode === 'trophies' ? 'seg-active' : ''}`}
              onClick={() => setMode('trophies')}
            >
              Trophies
            </button>
          </div>
          <button className="widget-link" onClick={onGoTrophies} aria-label="Open trophies">
            →
          </button>
        </div>
      </div>
      <div className="widget-body trophy-body">
        <div className="trophy-stats">
          <div className="trophy-stat">
            <span className="trophy-stat-value">{formatNumber(t.earned)}</span>
            <span className="trophy-stat-label">trophies earned</span>
          </div>
          {showPlat ? (
            <div className="trophy-stat">
              <span className="trophy-stat-value">{formatNumber(t.platinumEarned)}</span>
              <span className="trophy-stat-label">platinums</span>
            </div>
          ) : null}
          <div className="trophy-stat">
            <span className="trophy-stat-value">{formatNumber(t.beaten)}</span>
            <span className="trophy-stat-label">beaten games</span>
          </div>
        </div>
        <div className="plat-latest">
          <div className="plat-latest-head">{listHead}</div>
          {mode === 'trophies' ? (
            tros.length ? (
              <div className="plat-list">
                {tros.slice(0, 5).map((tr, i) => (
                  <TrophyMiniRow key={i} tr={tr} onOpen={() => onOpenTrophy(tr)} />
                ))}
              </div>
            ) : (
              <div className="widget-empty">No trophies yet.</div>
            )
          ) : plats.length ? (
            <div className="plat-list">
              {plats.slice(0, 5).map((p, i) => (
                <PlatinumMiniRow
                  key={i}
                  p={p}
                  onOpen={gamesByKey[p.key] ? () => onOpenGame(p.key) : undefined}
                />
              ))}
            </div>
          ) : (
            <div className="widget-empty">
              No {provider === 'steam' ? '100% games' : 'platinums'} yet.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PlatinumMiniRow({ p, onOpen }: { p: PlatItem; onOpen?: () => void }) {
  const label = p.name ?? (p.provider === 'psn' ? 'Platinum' : '100% completed')
  const glow = p.provider === 'psn' ? 'platinum' : 'steam'
  const inner = (
    <>
      <div className="tro-thumb">
        {p.coverUrl ? (
          <img className="tro-cover" src={p.coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="tro-cover tro-cover-empty">{p.title.slice(0, 1)}</div>
        )}
        {p.platinumIconUrl ? (
          <img
            className={`tro-badge tt-glow-${glow}`}
            src={p.platinumIconUrl}
            alt=""
            loading="lazy"
          />
        ) : null}
      </div>
      <div className="plat-row-info">
        <span className="plat-row-title">{label}</span>
        <span className="plat-row-date">
          {p.title}
          {p.earnedAt ? ` · ${formatDate(p.earnedAt)}` : ''}
        </span>
        <span className="tro-mini-meta">
          <span className={`src-tag src-${p.provider}`}>
            {p.provider === 'psn' ? 'PlayStation' : 'Steam'}
          </span>
          {p.rarity != null ? <span className="tro-rarity">{p.rarity}%</span> : null}
        </span>
      </div>
    </>
  )
  return onOpen ? (
    <button className="plat-row plat-row-btn" title={p.title} onClick={onOpen}>
      {inner}
    </button>
  ) : (
    <div className="plat-row" title={p.title}>
      {inner}
    </div>
  )
}

function TrophyMiniRow({ tr, onOpen }: { tr: RecentTrophy; onOpen: () => void }) {
  return (
    <button
      className="plat-row plat-row-btn"
      title={`${tr.name} · ${tr.gameTitle}`}
      onClick={onOpen}
    >
      <div className="tro-thumb">
        {tr.gameIconUrl ? (
          <img className="tro-cover" src={tr.gameIconUrl} alt="" loading="lazy" />
        ) : (
          <div className="tro-cover tro-cover-empty">{(tr.gameTitle || tr.name).slice(0, 1)}</div>
        )}
        {tr.iconUrl ? (
          <img
            className={`tro-badge tt-glow-${tr.type ?? tr.provider}`}
            src={tr.iconUrl}
            alt=""
            loading="lazy"
          />
        ) : null}
      </div>
      <div className="plat-row-info">
        <span className="plat-row-title">{tr.name}</span>
        <span className="plat-row-date">
          {tr.gameTitle}
          {tr.earnedAt ? ` · ${formatDate(tr.earnedAt)}` : ''}
        </span>
        <span className="tro-mini-meta">
          <span className={`src-tag src-${tr.provider}`}>
            {tr.provider === 'psn' ? 'PlayStation' : 'Steam'}
          </span>
          {tr.rarity != null ? <span className="tro-rarity">{tr.rarity}%</span> : null}
        </span>
      </div>
    </button>
  )
}

function NextUpWidget({
  items,
  count,
  onGoBacklog,
  onOpenItem,
}: {
  items: BacklogItem[]
  count: number
  onGoBacklog: () => void
  onOpenItem: (item: BacklogItem) => void
}) {
  return (
    <div className="widget">
      <div className="widget-head">
        <span className="widget-title">Backlog</span>
        <div className="widget-head-right">
          {count ? <span className="widget-count">{count}</span> : null}
          <button className="widget-link" onClick={onGoBacklog} aria-label="Open backlog">
            →
          </button>
        </div>
      </div>
      <div className="widget-body">
        <div className="plat-latest-head">Next up</div>
        {items.length ? (
          <div className="nextup-list">
            {items.slice(0, HOME_LIMIT).map((it) => {
              const prio = PRIORITY_LABEL[it.priority] ?? PRIORITY_LABEL[1]
              return (
                <button
                  key={it.id}
                  className="nextup-item playing-row"
                  onClick={() => onOpenItem(it)}
                  title={it.title}
                >
                  {it.coverUrl ? (
                    <img className="nextup-cover" src={it.coverUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="nextup-cover nextup-cover-empty">{it.title.slice(0, 1)}</div>
                  )}
                  <div className="nextup-info">
                    <div className="nextup-title" title={it.title}>
                      {it.title}
                    </div>
                    <div className="nextup-sub">
                      <span className={`badge ${badgeClass(it.platform)}`}>{it.platform}</span>
                      <span className={`prio-tag ${prio.cls}`}>{prio.label}</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="widget-empty">
            Your backlog is empty.
            <button className="widget-link" onClick={onGoBacklog}>
              Add games →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function BeatenWidget({
  games,
  onOpenGame,
  onGoLibrary,
}: {
  games: AggregatedGame[]
  onOpenGame: (game: AggregatedGame) => void
  onGoLibrary: () => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(9)

  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const compute = () => {
      const w = el.clientWidth
      if (w > 0) setCols(Math.max(1, Math.floor((w + GRID_GAP) / (GRID_MIN + GRID_GAP))))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const visible = games.slice(0, cols * GRID_ROWS)

  return (
    <div className="widget widget-wide">
      <div className="widget-head">
        <span className="widget-title">Beaten &amp; completed</span>
        <button className="widget-link" onClick={onGoLibrary} aria-label="Open library">
          →
        </button>
      </div>
      <div className="widget-body">
        {games.length ? (
          <div className="mini-grid" ref={gridRef}>
            {visible.map((g) => (
              <button
                key={g.key}
                className="mini-tile mini-tile-btn"
                title={g.title}
                onClick={() => onOpenGame(g)}
              >
                {g.coverUrl ? (
                  <img className="mini-cover" src={g.coverUrl} alt={g.title} loading="lazy" />
                ) : (
                  <div className="mini-cover mini-cover-empty">{g.title.slice(0, 1)}</div>
                )}
                {g.platinum.earned > 0 ? <span className="mini-plat">🏆</span> : null}
                <div className="mini-title">{g.title}</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="widget-empty">No beaten games yet.</div>
        )}
      </div>
    </div>
  )
}
