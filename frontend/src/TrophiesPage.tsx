import { useEffect, useMemo, useState } from 'react'
import { fetchTrophies } from './api'
import type { Dashboard, RecentTrophy } from './types'
import { TrophyModal } from './components/TrophyModal'
import { LoadingState } from './components/Spinner'
import { ActivityTab } from './ActivityChart'
import { formatDate, formatNumber } from './format'
import { SourceTag } from './components/PlatformTag'
import { IconTrophy, IconStar, IconChart, IconPlayStation, IconSteam } from './icons'

const PAGE_SIZES = [10, 25, 50, 100]

export function TrophiesPage({
  meta,
  userId,
}: {
  meta: Dashboard
  onRefresh: () => void | Promise<void>
  userId?: number
  readOnly?: boolean
}) {
  const [trophies, setTrophies] = useState<RecentTrophy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'trophies' | 'activity'>('trophies')
  const [selTrophy, setSelTrophy] = useState<RecentTrophy | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchTrophies(userId)
      .then(setTrophies)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [userId])

  return (
    <div className="dashboard">
      {loading ? (
        <LoadingState label="Loading trophies…" />
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
                <IconTrophy size={16} />
                Trophies
              </button>
              <button
                className={`wtab ${tab === 'activity' ? 'wtab-active' : ''}`}
                onClick={() => setTab('activity')}
              >
                <IconChart size={16} />
                Activity
              </button>
            </div>
          )
          return tab === 'trophies' ? (
            <>
              <div className="tt-tabbar">{tabsNode}</div>
              <TrophiesView trophies={trophies} meta={meta} onOpenTrophy={setSelTrophy} />
            </>
          ) : (
            <ActivityTab tabs={tabsNode} trophies={trophies} />
          )
        })()
      )}

      {selTrophy ? <TrophyModal trophy={selTrophy} onClose={() => setSelTrophy(null)} /> : null}
    </div>
  )
}

// ---- Trophies timeline (redesign) ----

const GRADE_FILL: Record<'bronze' | 'silver' | 'gold' | 'platinum', string> = {
  bronze: 'var(--bronze)',
  silver: 'var(--silver)',
  gold: 'var(--gold)',
  platinum: 'var(--plat)',
}
const CUP_PATH =
  'M5 4h14v2h2v3a4 4 0 0 1-4 4h-.2A5 5 0 0 1 13 15.9V18h3v2H8v-2h3v-2.1A5 5 0 0 1 7.2 13H7a4 4 0 0 1-4-4V6h2V4Zm0 4v1a2 2 0 0 0 2 2V8H5Zm14 0h-2v3a2 2 0 0 0 2-2V8Z'

function Cup({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={color} aria-hidden="true">
      <path d={CUP_PATH} />
    </svg>
  )
}

function CalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18" />
    </svg>
  )
}

function Gamepad() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="7" width="20" height="12" rx="4" />
      <path d="M6 12h4M8 10v4M15 11h.01M18 13h.01" />
    </svg>
  )
}

function GradeMedal({ t }: { t: RecentTrophy }) {
  const grade = t.type ?? 'bronze'
  return (
    <div className={`tt-medal g-${grade}`}>
      {t.iconUrl ? (
        <img src={t.iconUrl} alt="" loading="lazy" />
      ) : (
        <Cup color={GRADE_FILL[grade]} size={26} />
      )}
    </div>
  )
}

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const diff = Math.round((dayStart(new Date()) - dayStart(d)) / 86_400_000)
  if (diff === 0) return 'TODAY'
  if (diff === 1) return 'YESTERDAY'
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
}

function groupByDay(list: RecentTrophy[]): { key: string; label: string; items: RecentTrophy[] }[] {
  const groups: { key: string; label: string; items: RecentTrophy[] }[] = []
  const idx = new Map<string, number>()
  for (const t of list) {
    const iso = t.earnedAt
    let key: string
    let label: string
    if (iso) {
      const d = new Date(iso)
      key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      label = dayLabel(iso)
    } else {
      key = 'undated'
      label = 'UNDATED'
    }
    let gi = idx.get(key)
    if (gi === undefined) {
      gi = groups.length
      idx.set(key, gi)
      groups.push({ key, label, items: [] })
    }
    groups[gi].items.push(t)
  }
  return groups
}

function TimelineRow({ t, onOpen }: { t: RecentTrophy; onOpen: () => void }) {
  return (
    <button className="tt-row" onClick={onOpen} title={`${t.name} · ${t.gameTitle}`}>
      <GradeMedal t={t} />
      <div>
        <div className="tt-name">{t.name}</div>
        <div className="tt-game">{t.gameTitle}</div>
      </div>
      <div className="tt-date">
        <CalIcon />
        {t.earnedAt ? formatDate(t.earnedAt) : '—'}
      </div>
      <SourceTag provider={t.provider} platform={t.platform} />
      <span className="tt-pct">{t.rarity != null ? `${t.rarity}%` : '—'}</span>
      <span
        className={`tt-grade ${t.type === 'platinum' ? 'tt-grade--plat' : ''}`}
        title={t.type ?? 'bronze'}
      >
        <Cup color={GRADE_FILL[t.type ?? 'bronze']} size={22} />
      </span>
    </button>
  )
}

function TrophiesView({
  trophies,
  meta,
  onOpenTrophy,
}: {
  trophies: RecentTrophy[]
  meta: Dashboard
  onOpenTrophy: (t: RecentTrophy) => void
}) {
  const [q, setQ] = useState('')
  const [plat, setPlat] = useState<'all' | 'psn' | 'steam'>('all')
  const [sort, setSort] = useState<'recent' | 'rarest'>('recent')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [sumPlat, setSumPlat] = useState<'psn' | 'steam'>('psn')
  const [platOnly, setPlatOnly] = useState(false)

  const filtered = useMemo(() => {
    let list = trophies
    if (platOnly) list = list.filter((t) => t.type === 'platinum')
    if (plat !== 'all') list = list.filter((t) => t.provider === plat)
    const term = q.trim().toLowerCase()
    if (term) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(term) || t.gameTitle.toLowerCase().includes(term),
      )
    }
    return [...list].sort(
      sort === 'recent'
        ? (a, b) => (b.earnedAt ?? '').localeCompare(a.earnedAt ?? '')
        : (a, b) => (a.rarity ?? 101) - (b.rarity ?? 101),
    )
  }, [trophies, plat, q, sort, platOnly])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, totalPages)
  const pageItems = filtered.slice((current - 1) * pageSize, current * pageSize)
  const groups = sort === 'recent' ? groupByDay(pageItems) : null

  const rarest = useMemo(
    () =>
      trophies
        .filter((t) => t.rarity != null)
        .sort((a, b) => (a.rarity as number) - (b.rarity as number))
        .slice(0, 5),
    [trophies],
  )

  const recentPlats = useMemo(() => {
    const all = [...meta.recentPlatinums.psn, ...meta.recentPlatinums.steam]
    return all.sort((a, b) => (b.earnedAt ?? '').localeCompare(a.earnedAt ?? '')).slice(0, 4)
  }, [meta])

  const counts = meta.trophyProfile?.counts
  const psn = meta.trophiesByProvider.psn
  const steam = meta.trophiesByProvider.steam

  return (
    <>
      <div className="tt-toolbar">
        <div className="tt-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3-3" />
          </svg>
          <input
            placeholder="Search trophies..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPlatOnly(false)
              setPage(1)
            }}
          />
        </div>
        <div className="tt-filter">
          <span>Platform</span>
          <div className="tt-seg">
            {(['all', 'psn', 'steam'] as const).map((p) => (
              <button
                key={p}
                className={plat === p ? 'on' : ''}
                onClick={() => {
                  setPlat(p)
                  setPlatOnly(false)
                  setPage(1)
                }}
              >
                {p === 'all' ? 'All' : p === 'psn' ? 'PS' : 'Steam'}
              </button>
            ))}
          </div>
        </div>
        <div className="tt-filter">
          <span>Sort</span>
          <div className="tt-seg">
            {(['recent', 'rarest'] as const).map((s) => (
              <button
                key={s}
                className={sort === s ? 'on' : ''}
                onClick={() => {
                  setSort(s)
                  setPlatOnly(false)
                  setPage(1)
                }}
              >
                {s === 'recent' ? 'Recent' : 'Rarest'}
              </button>
            ))}
          </div>
        </div>
        <div className="tt-filter">
          <span>Per page</span>
          <div className="tt-seg">
            {PAGE_SIZES.map((n) => (
              <button
                key={n}
                className={pageSize === n ? 'on' : ''}
                onClick={() => {
                  setPageSize(n)
                  setPage(1)
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="tt-layout">
        <div>
          {pageItems.length === 0 ? (
            <div className="widget-empty">No trophies match.</div>
          ) : groups ? (
            groups.map((g) => (
              <div className="tt-group" key={g.key}>
                <div className="tt-group-head">
                  <div className="tt-gl">
                    <span className="tt-bar" />
                    <span className="tt-gt">{g.label}</span>
                  </div>
                  <span className="tt-gc">
                    {g.items.length} {g.items.length === 1 ? 'trophy' : 'trophies'}
                  </span>
                </div>
                <div className="tt-rows">
                  {g.items.map((t, i) => (
                    <TimelineRow key={i} t={t} onOpen={() => onOpenTrophy(t)} />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="tt-rows">
              {pageItems.map((t, i) => (
                <TimelineRow key={i} t={t} onOpen={() => onOpenTrophy(t)} />
              ))}
            </div>
          )}
          {totalPages > 1 ? (
            <div className="tt-pager">
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
        </div>

        <div>
          <div className="tt-card">
            <div className="tt-card-head">
              <div className="tt-card-title">
                <IconTrophy size={15} />
                Trophy Summary
              </div>
              <div className="tt-seg">
                <button
                  className={sumPlat === 'psn' ? 'on' : ''}
                  onClick={() => setSumPlat('psn')}
                  title="PlayStation"
                >
                  <IconPlayStation size={13} />
                </button>
                <button
                  className={sumPlat === 'steam' ? 'on' : ''}
                  onClick={() => setSumPlat('steam')}
                  title="Steam"
                >
                  <IconSteam size={13} />
                </button>
              </div>
            </div>
            {sumPlat === 'psn' ? (
              <div className="tt-sum-body">
                <div className="tt-sum-grid">
                  <div className="tt-sum">
                    <Cup color="var(--plat)" size={20} />
                    <div className="n">{formatNumber(counts?.platinum ?? 0)}</div>
                    <div className="k">Platinum</div>
                  </div>
                  <div className="tt-sum">
                    <Cup color="var(--gold)" size={20} />
                    <div className="n">{formatNumber(counts?.gold ?? 0)}</div>
                    <div className="k">Gold</div>
                  </div>
                  <div className="tt-sum">
                    <Cup color="var(--silver)" size={20} />
                    <div className="n">{formatNumber(counts?.silver ?? 0)}</div>
                    <div className="k">Silver</div>
                  </div>
                  <div className="tt-sum">
                    <Cup color="var(--bronze)" size={20} />
                    <div className="n">{formatNumber(counts?.bronze ?? 0)}</div>
                    <div className="k">Bronze</div>
                  </div>
                </div>
                <div className="tt-sum-total">
                  <div className="tt-st">
                    <span className="tt-stico">
                      <IconTrophy size={17} />
                    </span>
                    <div>
                      <div className="n">{formatNumber(psn.earned)}</div>
                      <div className="k">Total trophies</div>
                    </div>
                  </div>
                  <div className="tt-st">
                    <span className="tt-stico">
                      <Gamepad />
                    </span>
                    <div>
                      <div className="n">{formatNumber(psn.gamesWithTrophies)}</div>
                      <div className="k">Games</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="tt-sum-body">
                <div className="tt-sum-total" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
                <div className="tt-st">
                  <span className="tt-stico">
                    <IconSteam size={17} />
                  </span>
                  <div>
                    <div className="n">{formatNumber(steam.earned)}</div>
                    <div className="k">Achievements</div>
                  </div>
                </div>
                <div className="tt-st">
                  <span className="tt-stico">
                    <Gamepad />
                  </span>
                  <div>
                    <div className="n">{formatNumber(steam.gamesWithTrophies)}</div>
                    <div className="k">Games</div>
                  </div>
                </div>
              </div>
              </div>
            )}
          </div>

          <div className="tt-card">
            <div className="tt-card-head">
              <div className="tt-card-title">
                <Cup color="var(--plat)" size={15} />
                Recent Platinums
              </div>
              <button
                className={`tt-viewall ${platOnly ? 'is-active' : ''}`}
                onClick={() => {
                  if (platOnly) {
                    setPlatOnly(false)
                  } else {
                    setPlatOnly(true)
                    setPlat('all')
                    setSort('recent')
                    setQ('')
                  }
                  setPage(1)
                }}
              >
                {platOnly ? 'View all ✕' : 'View all'}
              </button>
            </div>
            {recentPlats.length ? (
              recentPlats.map((c, i) => (
                <div className="tt-mini" key={i} title={c.title}>
                  {c.platinumIconUrl ? (
                    <img className="tt-mcover" src={c.platinumIconUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="tt-mcover tt-mcover-empty">
                      <Cup color="var(--plat)" size={20} />
                    </div>
                  )}
                  <div className="tt-mbody">
                    <div className="tt-mn">{c.title}</div>
                    <div className="tt-msub">{c.earnedAt ? formatDate(c.earnedAt) : '—'}</div>
                  </div>
                  <div className="tt-mend">
                    <Cup color="var(--plat)" size={20} />
                  </div>
                </div>
              ))
            ) : (
              <div className="widget-empty">No platinums yet.</div>
            )}
          </div>

          <div className="tt-card">
            <div className="tt-card-head">
              <div className="tt-card-title">
                <IconStar size={15} />
                Rarest Trophies
              </div>
              <button
                className="tt-viewall"
                onClick={() => {
                  setSort('rarest')
                  setPage(1)
                }}
              >
                View all
              </button>
            </div>
            {rarest.length ? (
              rarest.map((t, i) => (
                <button className="tt-mini" key={i} onClick={() => onOpenTrophy(t)} title={t.name}>
                  {t.iconUrl ? (
                    <img className="tt-mcover" src={t.iconUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="tt-mcover tt-mcover-empty">
                      <Cup color={GRADE_FILL[t.type ?? 'bronze']} size={20} />
                    </div>
                  )}
                  <div className="tt-mbody">
                    <div className="tt-mn">{t.name}</div>
                    <div className="tt-msub">{t.gameTitle}</div>
                  </div>
                  <div className="tt-mend">
                    <div className="tt-mpct">{t.rarity}%</div>
                  </div>
                </button>
              ))
            ) : (
              <div className="widget-empty">No rarity data yet.</div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
