import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react'
import type { RecentTrophy } from './types'

type Gran = 'day' | 'month' | 'year'
type Prov = 'all' | 'psn' | 'steam'
type Range = '30d' | '90d' | '1y' | 'all' | 'custom'

const GRAN_LABEL: Record<Gran, string> = { day: 'Day', month: 'Month', year: 'Year' }
const PROV_LABEL: Record<Prov, string> = { all: 'All', psn: 'PSN', steam: 'Steam' }
// PSN awards "trophies"; Steam awards "achievements".
const PROV_NOUN: Record<Prov, string> = {
  all: 'trophies',
  psn: 'trophies',
  steam: 'achievements',
}
const RANGE_LABEL: Record<Range, string> = {
  '30d': '30d',
  '90d': '90d',
  '1y': '1y',
  all: 'All',
  custom: 'Custom',
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Hard caps so a wide range never renders thousands of buckets — we keep the
// most recent slice by clamping the start forward.
const MAX_BUCKETS: Record<Gran, number> = { day: 366, month: 120, year: 60 }

interface GameStat {
  title: string
  icon?: string
  count: number
}

interface Bucket {
  key: string
  label: string
  count: number
  games: GameStat[]
}

function keyFor(d: Date, g: Gran): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return g === 'year' ? `${y}` : g === 'month' ? `${y}-${m}` : `${y}-${m}-${day}`
}

function labelFor(d: Date, g: Gran): string {
  if (g === 'year') return `${d.getFullYear()}`
  if (g === 'month') return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
  return `${d.getDate()}/${d.getMonth() + 1}`
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Walk from `start` to `end` (inclusive) at the given granularity, clamping the
// start forward if the span would exceed MAX_BUCKETS so we keep the newest data.
function rangeBuckets(g: Gran, start: Date, end: Date): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = []
  const cap = MAX_BUCKETS[g]
  if (g === 'day') {
    let d = startOfDay(start)
    const last = startOfDay(end)
    const maxStart = new Date(last.getFullYear(), last.getMonth(), last.getDate() - (cap - 1))
    if (d < maxStart) d = maxStart
    while (d <= last) {
      out.push({ key: keyFor(d, 'day'), label: labelFor(d, 'day') })
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    }
  } else if (g === 'month') {
    let d = new Date(start.getFullYear(), start.getMonth(), 1)
    const last = new Date(end.getFullYear(), end.getMonth(), 1)
    const maxStart = new Date(last.getFullYear(), last.getMonth() - (cap - 1), 1)
    if (d < maxStart) d = maxStart
    while (d <= last) {
      out.push({ key: keyFor(d, 'month'), label: labelFor(d, 'month') })
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    }
  } else {
    let y = Math.max(start.getFullYear(), end.getFullYear() - (cap - 1))
    for (; y <= end.getFullYear(); y++) {
      out.push({ key: `${y}`, label: `${y}` })
    }
  }
  return out
}

const CHART_H = 210
const CHART_PAD = 16
// Extra left gutter for the y-axis trophy-count labels.
const CHART_PAD_L = 34
const TOP_N = 10

// Fritsch–Carlson monotone cubic interpolation — a smooth curve that never
// overshoots below the data (counts can't go negative, so no dips under zero).
function smoothPath(pts: Array<[number, number]>): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M ${pts[0][0]},${pts[0][1]}`
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const dx: number[] = []
  const delta: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1] - xs[i]
    delta[i] = (ys[i + 1] - ys[i]) / dx[i]
  }
  const m = new Array<number>(n)
  m[0] = delta[0]
  m[n - 1] = delta[n - 2]
  for (let i = 1; i < n - 1; i++) {
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
    } else {
      const a = m[i] / delta[i]
      const b = m[i + 1] / delta[i]
      const s = a * a + b * b
      if (s > 9) {
        const t = 3 / Math.sqrt(s)
        m[i] = t * a * delta[i]
        m[i + 1] = t * b * delta[i]
      }
    }
  }
  let d = `M ${xs[0]},${ys[0]}`
  for (let i = 0; i < n - 1; i++) {
    d += ` C ${xs[i] + dx[i] / 3},${ys[i] + (m[i] * dx[i]) / 3} ${
      xs[i + 1] - dx[i] / 3
    },${ys[i + 1] - (m[i + 1] * dx[i]) / 3} ${xs[i + 1]},${ys[i + 1]}`
  }
  return d
}

export function ActivityTab({ tabs, trophies }: { tabs: ReactNode; trophies: RecentTrophy[] }) {
  const [gran, setGran] = useState<Gran>('month')
  const [prov, setProv] = useState<Prov>('all')
  const [range, setRange] = useState<Range>('1y')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [hover, setHover] = useState<number | null>(null)

  const roRef = useRef<ResizeObserver | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  // Start at 0 so we render a skeleton until the real width is known — avoids the
  // chart popping in at a default width and then snapping to its container size.
  const [width, setWidth] = useState(0)
  const [tipW, setTipW] = useState(0)

  // Attach the ResizeObserver through a callback ref (not a mount-only effect) so it
  // re-measures whenever the plot element mounts. The plot is unmounted while the empty
  // state shows (e.g. a provider with no trophies in range), which detaches the node; a
  // mount-only observer would stay bound to that detached node — it reports width 0 and
  // would strand the chart on its loading skeleton once data returns. We also ignore 0
  // widths so a transient detach never blanks a good measurement.
  const setPlotRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      if (w > 0) setWidth(w)
    })
    ro.observe(el)
    roRef.current = ro
  }, [])

  // Earliest earned date for the selected provider — the anchor for the "All" range.
  const earliest = useMemo(() => {
    let e: Date | null = null
    for (const t of trophies) {
      if (!t.earnedAt) continue
      if (prov !== 'all' && t.provider !== prov) continue
      const d = new Date(t.earnedAt)
      if (Number.isNaN(d.getTime())) continue
      if (!e || d < e) e = d
    }
    return e ?? new Date()
  }, [trophies, prov])

  const dateWindow = useMemo<{ start: Date; end: Date }>(() => {
    const now = new Date()
    if (range === 'custom') {
      const start = customFrom ? new Date(`${customFrom}T00:00:00`) : earliest
      const end = customTo ? new Date(`${customTo}T23:59:59`) : now
      return { start, end }
    }
    if (range === 'all') return { start: earliest, end: now }
    if (range === '1y')
      return { start: new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()), end: now }
    const days = range === '30d' ? 29 : 89
    return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - days), end: now }
  }, [range, customFrom, customTo, earliest])

  const buckets = useMemo<Bucket[]>(() => {
    const start = dateWindow.start.getTime()
    const end = dateWindow.end.getTime()
    const agg = new Map<string, { count: number; games: Map<string, GameStat> }>()
    for (const t of trophies) {
      if (!t.earnedAt) continue
      if (prov !== 'all' && t.provider !== prov) continue
      const d = new Date(t.earnedAt)
      const ts = d.getTime()
      if (Number.isNaN(ts) || ts < start || ts > end) continue
      const k = keyFor(d, gran)
      let slot = agg.get(k)
      if (!slot) {
        slot = { count: 0, games: new Map() }
        agg.set(k, slot)
      }
      slot.count++
      const title = t.gameTitle || 'Unknown'
      const g = slot.games.get(title)
      if (g) g.count++
      else slot.games.set(title, { title, icon: t.gameIconUrl, count: 1 })
    }
    return rangeBuckets(gran, dateWindow.start, dateWindow.end).map((b) => {
      const slot = agg.get(b.key)
      const games = slot ? [...slot.games.values()].sort((a, c) => c.count - a.count) : []
      return { ...b, count: slot?.count ?? 0, games }
    })
  }, [trophies, gran, prov, dateWindow])

  const max = Math.max(1, ...buckets.map((b) => b.count))
  const total = buckets.reduce((s, b) => s + b.count, 0)
  const labelStep = Math.max(1, Math.ceil(buckets.length / 12))

  const n = buckets.length
  const innerW = Math.max(0, width - CHART_PAD_L - CHART_PAD)
  const innerH = CHART_H - CHART_PAD * 2
  const px = (i: number) =>
    n <= 1 ? CHART_PAD_L + innerW / 2 : CHART_PAD_L + (i / (n - 1)) * innerW
  const py = (c: number) => CHART_PAD + innerH - (c / max) * innerH
  const baseY = py(0)

  const pts = buckets.map((b, i) => [px(i), py(b.count)] as [number, number])
  const linePath = smoothPath(pts)
  const areaPath = linePath ? `${linePath} L ${px(n - 1)},${baseY} L ${px(0)},${baseY} Z` : ''

  // A few horizontal gridlines at "nice" fractions of the max, each labelled with
  // its trophy count on the left axis.
  const gridCount = 3
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const v = (max / gridCount) * i
    return { y: py(v), v: Math.round(v) }
  })

  // Top games across the whole window for the ranked list below the chart.
  const { topGames, othersTotal } = useMemo(() => {
    const totals = new Map<string, GameStat>()
    for (const b of buckets) {
      for (const g of b.games) {
        const e = totals.get(g.title)
        if (e) {
          e.count += g.count
          if (!e.icon) e.icon = g.icon
        } else {
          totals.set(g.title, { title: g.title, icon: g.icon, count: g.count })
        }
      }
    }
    const sorted = [...totals.values()].sort((a, b) => b.count - a.count)
    return {
      topGames: sorted.slice(0, TOP_N),
      othersTotal: sorted.slice(TOP_N).reduce((s, g) => s + g.count, 0),
    }
  }, [buckets])

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (n === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(px(i) - x)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    setHover(best)
  }

  const active = hover != null ? buckets[hover] : null
  const flip = active ? py(active.count) < 96 : false

  // Keep the tooltip fully inside the plot so it isn't clipped at the edges
  // (the widget has overflow:hidden). Measure its real width, then clamp.
  useLayoutEffect(() => {
    if (tipRef.current) setTipW(tipRef.current.offsetWidth)
  }, [hover, active?.count, active?.games.length])
  const tipX =
    active == null
      ? 0
      : tipW > 0 && tipW < width
        ? Math.min(Math.max(px(hover!), tipW / 2 + 2), width - tipW / 2 - 2)
        : px(hover!)

  return (
    <div className="widget">
      <div className="widget-head">
        {tabs}
        <div className="widget-head-right">
          <div className="seg">
            {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
              <button
                key={r}
                className={`seg-btn ${range === r ? 'seg-active' : ''}`}
                onClick={() => setRange(r)}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
          <div className="seg">
            {(Object.keys(GRAN_LABEL) as Gran[]).map((g) => (
              <button
                key={g}
                className={`seg-btn ${gran === g ? 'seg-active' : ''}`}
                onClick={() => setGran(g)}
              >
                {GRAN_LABEL[g]}
              </button>
            ))}
          </div>
          <div className="seg">
            {(Object.keys(PROV_LABEL) as Prov[]).map((p) => (
              <button
                key={p}
                className={`seg-btn ${prov === p ? 'seg-active' : ''}`}
                onClick={() => setProv(p)}
              >
                {PROV_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="widget-body">
        {range === 'custom' && (
          <div className="chart-daterange">
            <label className="chart-date-field">
              <span>From</span>
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </label>
            <label className="chart-date-field">
              <span>To</span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </label>
          </div>
        )}

        <div className="chart-total">
          <span className="chart-total-num">{total.toLocaleString('en-US')}</span>
          <span className="chart-total-cap">
            {prov === 'all' ? 'trophies' : `${PROV_LABEL[prov]} ${PROV_NOUN[prov]}`} in this range
          </span>
        </div>

        {total ? (
          <div className="chart">
            <div
              className="chart-plot"
              ref={setPlotRef}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            >
              {width === 0 ? (
                <div className="chart-skeleton" />
              ) : (
              <>
              <svg className="chart-svg" width={width} height={CHART_H}>
                <defs>
                  <linearGradient id="chart-area-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop className="chart-area-stop-top" offset="0%" />
                    <stop className="chart-area-stop-bottom" offset="100%" />
                  </linearGradient>
                  <linearGradient id="chart-line-grad" x1="0" y1="0" x2="1" y2="0">
                    <stop className="chart-line-stop-start" offset="0%" />
                    <stop className="chart-line-stop-end" offset="100%" />
                  </linearGradient>
                </defs>

                {gridLines.map((g) => (
                  <g key={g.y}>
                    <line
                      className="chart-grid-line"
                      x1={CHART_PAD_L}
                      x2={width - CHART_PAD}
                      y1={g.y}
                      y2={g.y}
                    />
                    <text className="chart-y-label" x={CHART_PAD_L - 8} y={g.y}>
                      {g.v}
                    </text>
                  </g>
                ))}

                <path className="chart-area" d={areaPath} />
                <path className="chart-line" d={linePath} />

                {active && (
                  <g className="chart-hover">
                    <line
                      className="chart-crosshair"
                      x1={px(hover!)}
                      x2={px(hover!)}
                      y1={CHART_PAD}
                      y2={baseY}
                    />
                    <circle
                      className="chart-dot-active"
                      cx={px(hover!)}
                      cy={py(active.count)}
                      r={4.5}
                    />
                  </g>
                )}
              </svg>

              {active && (
                <div
                  ref={tipRef}
                  className={`chart-tooltip ${flip ? 'chart-tooltip-below' : ''}`}
                  style={{ left: tipX, top: py(active.count) }}
                  // Freeze the hovered bucket while the cursor is on the tooltip, so
                  // scrolling its game list doesn't keep re-picking a new bucket.
                  onPointerMove={(e) => e.stopPropagation()}
                >
                  <div className="chart-tooltip-top">
                    <span className="chart-tooltip-val">{active.count}</span>
                    <span className="chart-tooltip-label">{active.label}</span>
                  </div>
                  {active.games.length > 0 && (
                    <div className="chart-tooltip-games">
                      {active.games.map((g) => (
                        <div key={g.title} className="chart-tt-game">
                          {g.icon ? (
                            <img className="chart-tt-icon" src={g.icon} alt="" loading="lazy" />
                          ) : (
                            <span className="chart-tt-icon chart-tt-icon-blank" />
                          )}
                          <span className="chart-tt-name">{g.title}</span>
                          <span className="chart-tt-cnt">{g.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              </>
              )}
            </div>

            <div className="chart-axis">
              {width > 0 &&
                buckets.map((b, i) =>
                  i % labelStep === 0 ? (
                    <span key={b.key} className="chart-tick" style={{ left: px(i) }}>
                      {b.label}
                    </span>
                  ) : null,
                )}
            </div>

            {topGames.length > 0 && (
              <div className="chart-top">
                <div className="chart-top-head">
                  Top {TOP_N} games <span>· in this range</span>
                </div>
                <ol className="chart-top-list">
                  {topGames.map((g, i) => (
                    <li key={g.title} className="chart-top-item">
                      <span className="chart-top-cnt">{g.count}</span>
                      <span className="chart-top-rank">{i + 1}</span>
                      {g.icon ? (
                        <img className="chart-top-icon" src={g.icon} alt="" loading="lazy" />
                      ) : (
                        <span className="chart-top-icon chart-top-icon-blank" />
                      )}
                      <span className="chart-top-name">{g.title}</span>
                    </li>
                  ))}
                  {othersTotal > 0 && (
                    <li className="chart-top-item chart-top-others">
                      <span className="chart-top-cnt">{othersTotal}</span>
                      <span className="chart-top-rank">–</span>
                      <span className="chart-top-icon chart-top-icon-blank" />
                      <span className="chart-top-name">Others</span>
                    </li>
                  )}
                </ol>
              </div>
            )}
          </div>
        ) : (
          <div className="widget-empty">No trophies earned in this range yet.</div>
        )}
      </div>
    </div>
  )
}
