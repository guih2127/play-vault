import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AggregatedGame, RecentTrophy } from './types'
import {
  fetchGameTrophies,
  fetchMeta,
  setBeaten,
  setPlaying,
  setRating,
  updateManualHours,
  type GameMeta,
} from './api'
import { formatDate, formatHours } from './format'
import { PlatformBadge, dedupePlatformLabels } from './components/PlatformTag'
import { GameModal } from './components/GameCard'
import { LoadingState, Spinner } from './components/Spinner'
import {
  IconChart,
  IconCheckCircle,
  IconClock,
  IconInfo,
  IconLibrary,
  IconStar,
  IconTrophy,
  platformBrand,
  platformIcon,
} from './icons'

type TType = 'bronze' | 'silver' | 'gold' | 'platinum'
const platOf = (t: RecentTrophy) => t.platform ?? (t.provider === 'steam' ? 'Steam' : 'PlayStation')

const TYPE_ORDER: TType[] = ['platinum', 'gold', 'silver', 'bronze']
const TYPE_GRAD: Record<TType, [string, string, string]> = {
  platinum: ['#eaf6ff', '#a9cbe6', '#6d97bb'],
  gold: ['#fff2b0', '#f1c44b', '#c08820'],
  silver: ['#fbfdff', '#d3dbe4', '#9aa5b2'],
  bronze: ['#f6d3ac', '#d18a4f', '#96562a'],
}

/** Gradient defs shared by every trophy cup on the page (rendered once). */
function TrophyDefs() {
  return (
    <svg width="0" height="0" className="gd-trophy-defs" aria-hidden="true">
      <defs>
        {TYPE_ORDER.map((tt) => {
          const [a, b, c] = TYPE_GRAD[tt]
          return (
            <linearGradient key={tt} id={`tg-${tt}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={a} />
              <stop offset="0.55" stopColor={b} />
              <stop offset="1" stopColor={c} />
            </linearGradient>
          )
        })}
      </defs>
    </svg>
  )
}

/** A glossy trophy cup tinted by grade (metallic gradient + highlight + soft glow). */
function TrophyIcon({ type, size = 20 }: { type: TType; size?: number }) {
  return (
    <svg
      className={`gd-cup gd-cup-${type}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fill={`url(#tg-${type})`}
        d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"
      />
      <ellipse cx="9.4" cy="8" rx="1.4" ry="2.5" fill="rgba(255,255,255,0.5)" />
    </svg>
  )
}

/**
 * PROTOTYPE — richer game details, matched to the reference mockup within our data. Earned trophies
 * come from /game-trophies, everything under "Game info / Critic score" from RAWG (/meta). Unearned
 * trophies are shown as locked placeholders for now — they become real after the trophy-storage
 * change ships and the library is re-synced.
 */
export function GameDetails({
  game: initialGame,
  onBack,
}: {
  game: AggregatedGame
  onBack: () => void
}) {
  const [game, setGame] = useState(initialGame)
  useEffect(() => setGame(initialGame), [initialGame])
  const [editing, setEditing] = useState(false)
  const [meta, setMeta] = useState<GameMeta | undefined>(undefined)
  const [trophies, setTrophies] = useState<RecentTrophy[] | undefined>(undefined)
  const [platformFilter, setPlatformFilter] = useState('')

  useEffect(() => {
    let alive = true
    fetchMeta(game.key, game.title)
      .then((m) => alive && setMeta(m))
      .catch(
        () =>
          alive &&
          setMeta({ found: false, configured: true, genres: [], platforms: [], similar: [] }),
      )
    fetchGameTrophies(game.key)
      .then((t) => alive && setTrophies(t))
      .catch(() => alive && setTrophies([]))
    return () => {
      alive = false
    }
  }, [game.key, game.title])

  const platinum = game.platinum.earned > 0
  const beaten = platinum || !!game.beaten
  const rating = game.rating ?? 0
  const year = game.firstPlayed ? new Date(game.firstPlayed).getFullYear() : undefined

  // Each platform/version (PS5, PS4, Steam…) has its own trophy set, so we never merge them — the
  // user picks one platform and sees only that list. Order platforms by how complete they are.
  const trophyPlatforms = useMemo(() => {
    const earnedBy = new Map<string, number>()
    for (const t of trophies ?? []) {
      const p = platOf(t)
      earnedBy.set(p, (earnedBy.get(p) ?? 0) + (t.earnedAt ? 1 : 0))
    }
    return [...earnedBy.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
  }, [trophies])
  const activePlatform = trophyPlatforms.includes(platformFilter)
    ? platformFilter
    : (trophyPlatforms[0] ?? '')

  const shownTrophies = (trophies ?? []).filter((t) => platOf(t) === activePlatform)
  const totalCount = shownTrophies.length
  const earnedCount = shownTrophies.filter((t) => t.earnedAt).length
  const platProgress = totalCount ? Math.round((earnedCount / totalCount) * 100) : 0

  const typeCounts = useMemo(() => {
    const c: Record<TType, number> = { platinum: 0, gold: 0, silver: 0, bronze: 0 }
    for (const t of shownTrophies) if (t.type) c[t.type as TType]++
    return c
  }, [shownTrophies])

  const completionRows = game.trophySets.flatMap((set) =>
    set.groups && set.groups.length
      ? set.groups.map((g) => ({
          platform: set.platformLabel,
          name: g.isBase ? 'Base game' : g.name,
          earned: g.earned,
          total: g.total,
        }))
      : [
          {
            platform: set.platformLabel,
            name: set.titleName ?? set.platformLabel,
            earned: set.earned,
            total: set.total,
          },
        ],
  )

  // Flat list ordered by grade (platinum → gold → silver → bronze), then by how rare the trophy is
  // (lowest obtain-rate first). Steam achievements (no grade) fall to the end.
  const GRADE_RANK: Record<string, number> = { platinum: 0, gold: 1, silver: 2, bronze: 3 }
  const sortedTrophies = [...shownTrophies].sort((a, b) => {
    const ga = GRADE_RANK[a.type ?? ''] ?? 9
    const gb = GRADE_RANK[b.type ?? ''] ?? 9
    if (ga !== gb) return ga - gb
    return (a.rarity ?? 101) - (b.rarity ?? 101)
  })

  // Split the (already sorted) list into the base game and each DLC, using the trophy group id
  // mapped to the DLC names we already have on the game's trophy sets.
  const groupInfo = useMemo(() => {
    const m = new Map<string, { name: string; isBase: boolean }>()
    for (const s of game.trophySets) for (const g of s.groups ?? []) m.set(g.id, g)
    return m
  }, [game.trophySets])
  const baseTrophies: RecentTrophy[] = []
  const dlcMap = new Map<string, { name: string; items: RecentTrophy[] }>()
  for (const t of sortedTrophies) {
    const info = t.group ? groupInfo.get(t.group) : undefined
    if (!t.group || t.group === 'default' || info?.isBase) {
      baseTrophies.push(t)
    } else {
      const key = t.group
      if (!dlcMap.has(key)) dlcMap.set(key, { name: info?.name ?? 'DLC', items: [] })
      dlcMap.get(key)!.items.push(t)
    }
  }
  const dlcSections = [...dlcMap.values()]

  // Hold the whole page on a single loader until every external source (RAWG meta + trophies) is in,
  // so it appears complete rather than filling in card-by-card.
  if (meta === undefined || trophies === undefined) return <LoadingState />

  return (
    <div className="gd">
      <TrophyDefs />
      <button className="gd-back" onClick={onBack}>
        ← Back to Library
      </button>

      <div className="gd-hero">
        {game.coverUrl ? (
          <div className="gd-hero-bg" style={{ backgroundImage: `url(${game.coverUrl})` }} />
        ) : null}
        <div className="gd-hero-banner">
          <div className="gd-hero-content">
            {game.coverUrl ? (
              <img className="gd-hero-cover" src={game.coverUrl} alt={game.title} />
            ) : (
              <div className="gd-hero-cover gd-hero-cover-empty">{game.title.slice(0, 1)}</div>
            )}
            <div className="gd-hero-info">
              <h1 className="gd-title">{game.title}</h1>
              <div className="gd-genres">
                {[
                  ...(meta?.found && meta.genres.length ? meta.genres : game.genres),
                  meta?.released ? new Date(meta.released).getFullYear() : year,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
          </div>
        </div>

        <div className="gd-hero-bar">
          <div className="gd-stat">
            <span className="gd-stat-icon">
              <IconClock size={16} />
            </span>
            <div className="gd-stat-text">
              <div className="gd-stat-val">
                {game.playtimeKnown ? formatHours(game.totalPlaytimeMinutes) : '—'}
              </div>
              <div className="gd-stat-sub">played</div>
            </div>
          </div>

          <div className="gd-stat">
            <span className={`gd-stat-icon ${platinum ? 'gd-stat-plat' : ''}`}>
              {platinum ? <TrophyIcon type="platinum" size={17} /> : <IconTrophy size={16} />}
            </span>
            <div className="gd-stat-text">
              <div className="gd-stat-val">{platinum ? 'Platinum' : 'Not platinum'}</div>
              <div className="gd-stat-sub">trophy status</div>
            </div>
          </div>

          <div className="gd-stat">
            <span className={`gd-stat-icon ${beaten ? 'gd-stat-beaten' : ''}`}>
              {beaten ? '✓' : '○'}
            </span>
            <div className="gd-stat-text">
              <div className="gd-stat-val">{beaten ? 'Beaten' : 'Not beaten'}</div>
              <div className="gd-stat-sub">progress</div>
            </div>
          </div>

          <div className="gd-stat">
            <span className="gd-stat-icon gd-stat-star">★</span>
            <div className="gd-stat-text">
              <div className="gd-stat-val">
                {rating ? (
                  <>
                    {rating * 2}/10 <Stars value={rating} />
                  </>
                ) : (
                  'Unrated'
                )}
              </div>
              <div className="gd-stat-sub">your rating</div>
            </div>
          </div>

          <button className="gd-edit-btn" onClick={() => setEditing(true)}>
            ✎ Edit progress
          </button>
        </div>
      </div>

      <div className="gd-body">
        <div className="gd-main">
          <section className="gd-card">
            <div className="gd-trophy-bar">
              <h2 className="gd-card-title">
                <IconTrophy size={16} /> Trophies
              </h2>
              <span className="gd-trophy-count">
                {earnedCount}
                <span className="gd-trophy-count-total">/{totalCount}</span>
              </span>
              <span className="gd-trophy-pct">{platProgress}%</span>
              {trophyPlatforms.length > 1 ? (
                <div className="gd-pf-seg">
                  {trophyPlatforms.map((p) => (
                    <PlatformPill
                      key={p}
                      label={p}
                      active={p === activePlatform}
                      onClick={() => setPlatformFilter(p)}
                    />
                  ))}
                </div>
              ) : null}
            </div>

            <div className="gd-types">
              {TYPE_ORDER.map((tt) =>
                typeCounts[tt] ? (
                  <span key={tt} className="gd-type-chip">
                    <TrophyIcon type={tt} size={19} />
                    <b>{typeCounts[tt]}</b>
                    <span className="gd-type-name">{tt}</span>
                  </span>
                ) : null,
              )}
            </div>
            <div className="gd-bar">
              <div className="gd-bar-fill" style={{ width: `${platProgress}%` }} />
            </div>

            {trophies === undefined ? (
              <div className="gd-meta-loading">
                <Spinner size={20} />
              </div>
            ) : (
              <div className="gd-trophies">
                {!sortedTrophies.length ? (
                  <div className="gd-placeholder">No trophies recorded for this game.</div>
                ) : dlcSections.length ? (
                  <>
                    <div className="gd-sec">
                      <div className="gd-sec-head">Base game</div>
                      {baseTrophies.map((t, i) => (
                        <TrophyRow key={i} t={t} />
                      ))}
                    </div>
                    {dlcSections.map((d, di) => (
                      <div key={di} className="gd-sec">
                        <div className="gd-sec-head gd-sec-dlc">
                          <span className="gd-sec-badge">DLC</span>
                          {d.name}
                        </div>
                        {d.items.map((t, i) => (
                          <TrophyRow key={i} t={t} />
                        ))}
                      </div>
                    ))}
                  </>
                ) : (
                  baseTrophies.map((t, i) => <TrophyRow key={i} t={t} />)
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="gd-side">
          <section className="gd-card">
            <h2 className="gd-card-title">
              <IconChart size={15} /> My experience
            </h2>
            <Kv k="Playtime" v={game.playtimeKnown ? formatHours(game.totalPlaytimeMinutes) : '—'} />
            <Kv
              k="My rating"
              v={
                rating ? (
                  <>
                    <Stars value={rating} /> {rating * 2}/10
                  </>
                ) : (
                  '—'
                )
              }
            />
            {game.lastPlayed ? <Kv k="Last played" v={formatDate(game.lastPlayed)} /> : null}
            {game.platinumEarnedAt ? <Kv k="Platinum" v={formatDate(game.platinumEarnedAt)} /> : null}
          </section>

          <section className="gd-card">
            <h2 className="gd-card-title">
              <IconCheckCircle size={15} /> Completion
            </h2>
            {completionRows.map((row, i) => {
              const pct = row.total ? Math.round((row.earned / row.total) * 100) : 0
              return (
                <div key={i} className="gd-comp-row">
                  <div className="gd-comp-head">
                    <span className="gd-comp-name">
                      {row.platform ? <PlatformPill label={row.platform} /> : null}
                      {row.name}
                    </span>
                    <span className="gd-comp-nums">
                      {row.earned}/{row.total} · {pct}%
                    </span>
                  </div>
                  <div className="gd-bar">
                    <div className="gd-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </section>

          <section className="gd-card">
            <h2 className="gd-card-title">
              <IconStar size={15} /> Critic score <span className="gd-soon">RAWG</span>
            </h2>
            {meta.found ? (
              <div className="gd-scores">
                <ScoreCircle
                  value={meta.metacritic ?? 'N/A'}
                  label="Metacritic"
                  score100={meta.metacritic ?? -1}
                />
                {meta.userScore != null ? (
                  <ScoreCircle
                    value={(meta.userScore * 2).toFixed(1)}
                    label={`User score${meta.ratingsCount ? ` · ${meta.ratingsCount.toLocaleString()}` : ''}`}
                    score100={meta.userScore * 20}
                  />
                ) : null}
              </div>
            ) : (
              <div className="gd-placeholder">No RAWG match for this title.</div>
            )}
          </section>

          <section className="gd-card">
            <h2 className="gd-card-title">
              <IconInfo size={15} /> Game info <span className="gd-soon">RAWG</span>
            </h2>
            {meta === undefined ? (
              <div className="gd-meta-loading">
                <Spinner size={20} />
              </div>
            ) : !meta.configured ? (
              <div className="gd-placeholder">RAWG API key not configured.</div>
            ) : !meta.found ? (
              <div className="gd-placeholder">No RAWG match for this title.</div>
            ) : (
              <>
                {meta.developer ? <Kv k="Developer" v={meta.developer} /> : null}
                {meta.publisher ? <Kv k="Publisher" v={meta.publisher} /> : null}
                {meta.released ? <Kv k="Release date" v={formatDate(meta.released)} /> : null}
                {meta.genres.length ? <Kv k="Genre" v={meta.genres.join(' · ')} /> : null}
                {meta.modes ? <Kv k="Players" v={meta.modes} /> : null}
                {meta.description ? <p className="gd-desc">{meta.description}</p> : null}
                {meta.rawgUrl ? (
                  <a className="gd-link" href={meta.rawgUrl} target="_blank" rel="noreferrer">
                    View on RAWG →
                  </a>
                ) : null}
              </>
            )}
          </section>

          <section className="gd-card">
            <h2 className="gd-card-title">
              <IconLibrary size={15} /> Platforms
            </h2>
            <div className="gd-platforms">
              {(meta?.found && meta.platforms.length ? meta.platforms : game.platformLabels).length
                ? dedupePlatformLabels(
                    meta?.found && meta.platforms.length ? meta.platforms : game.platformLabels,
                  ).map((p) => <PlatformBadge key={p} label={p} />)
                : null}
            </div>
            {meta?.found && meta.platforms.length ? (
              <div className="gd-hint">All platforms the game is available on.</div>
            ) : null}
          </section>
        </aside>
      </div>

      {meta?.found && meta.similar.length ? (
        <section className="gd-card gd-similar-card">
          <h2 className="gd-card-title">
            <IconLibrary size={15} /> More like this <span className="gd-soon">RAWG</span>
          </h2>
          <div className="gd-similar">
            {meta.similar.map((s, i) => (
              <div key={i} className="gd-similar-item" title={s.name}>
                {s.image ? (
                  <img className="gd-similar-cover" src={s.image} alt={s.name} loading="lazy" />
                ) : (
                  <div className="gd-similar-cover gd-similar-empty">{s.name.slice(0, 1)}</div>
                )}
                <div className="gd-similar-name">{s.name}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {editing ? (
        <GameModal
          game={game}
          onClose={() => setEditing(false)}
          onToggleBeaten={async (k, b) => {
            await setBeaten(k, b)
            setGame((p) => ({ ...p, beaten: b }))
          }}
          onTogglePlaying={async (k, pl) => {
            await setPlaying(k, pl)
            setGame((p) => ({ ...p, playing: pl }))
          }}
          onRate={async (k, r) => {
            await setRating(k, r)
            setGame((p) => ({ ...p, rating: r }))
          }}
          onUpdateHours={
            game.manual
              ? async (k, h) => {
                  await updateManualHours(k, h)
                  setGame((p) => ({
                    ...p,
                    totalPlaytimeMinutes: Math.round(h * 60),
                    playtimeKnown: true,
                  }))
                }
              : undefined
          }
        />
      ) : null}
    </div>
  )
}

function ScoreCircle({
  value,
  label,
  score100,
}: {
  value: number | string
  label: string
  score100: number
}) {
  const na = score100 < 0
  const cls = na
    ? 'gd-mc-na'
    : score100 >= 75
      ? 'gd-mc-good'
      : score100 >= 50
        ? 'gd-mc-mid'
        : 'gd-mc-bad'
  const quality = na
    ? 'Not on Metacritic'
    : score100 >= 75
      ? 'Generally favorable'
      : score100 >= 50
        ? 'Mixed or average'
        : 'Unfavorable'
  return (
    <div className="gd-score">
      <span className={`gd-circle ${cls}`}>{value}</span>
      <div className="gd-score-text">
        <div className="gd-score-label">{label}</div>
        <div className="gd-score-quality">{quality}</div>
      </div>
    </div>
  )
}

function TrophyRow({ t }: { t: RecentTrophy }) {
  const earned = !!t.earnedAt
  return (
    <div className={`gd-trophy-row ${earned ? 'gd-earned-row' : 'gd-unearned-row'}`}>
      {t.iconUrl ? (
        <img className="gd-trophy-icon" src={t.iconUrl} alt="" loading="lazy" />
      ) : (
        <div className="gd-trophy-icon gd-trophy-icon-empty" />
      )}
      <div className="gd-trophy-info">
        <div className="gd-trophy-name">{t.name}</div>
        {t.detail ? <div className="gd-trophy-detail">{t.detail}</div> : null}
      </div>
      {t.rarity != null ? <span className="gd-trophy-rarity">{t.rarity}%</span> : null}
      <div className="gd-trophy-earned">
        {t.type ? <TrophyIcon type={t.type as TType} size={22} /> : null}
        <div className="gd-earned-text">
          {earned ? (
            <>
              <div className="gd-earned-label">Earned</div>
              <div className="gd-earned-date">{formatDate(t.earnedAt)}</div>
            </>
          ) : (
            <div className="gd-locked-label">Locked</div>
          )}
        </div>
      </div>
    </div>
  )
}

function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="gd-kv">
      <span className="gd-k">{k}</span>
      <span className="gd-v">{v}</span>
    </div>
  )
}

function Stars({ value }: { value: number }) {
  return (
    <span className="gd-stars" aria-label={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`gd-star ${value >= n ? 'on' : value >= n - 0.5 ? 'half' : ''}`}>
          ★
        </span>
      ))}
    </span>
  )
}

const isPs5 = (label: string) => /ps ?5|playstation ?5/i.test(label)
function pfClass(label: string): string {
  if (isPs5(label)) return 'pf-ps5'
  const brand = platformBrand(label)
  return brand ? `pf-${brand}` : 'pf-other'
}

/** A platform chip. PS5 keeps the PlayStation mark but in black/white; PS4 stays blue. As a button
 *  it acts as a selector (in the Trophies header); as a plain chip it just labels a Completion row. */
function PlatformPill({
  label,
  active,
  onClick,
}: {
  label: string
  active?: boolean
  onClick?: () => void
}) {
  const inner = platformIcon(label, 15) ?? <span>{label}</span>
  return onClick ? (
    <button
      type="button"
      title={label}
      className={`gd-pf ${pfClass(label)} ${active ? 'on' : ''}`}
      onClick={onClick}
    >
      {inner}
    </button>
  ) : (
    <span title={label} className={`gd-pf gd-pf-static ${pfClass(label)}`}>
      {inner}
    </span>
  )
}
