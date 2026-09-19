import { platformKey, providerLabel, type PlatformKey } from '../format'

function Glyph({ k, size }: { k: PlatformKey; size: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true } as const
  switch (k) {
    case 'steam':
      // Two connected "atoms" — the essence of the Steam mark.
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.8}>
          <circle cx="15" cy="8.5" r="3.3" fill="currentColor" stroke="none" />
          <circle cx="8" cy="15.5" r="2.4" fill="currentColor" stroke="none" />
          <line x1="12.6" y1="10.7" x2="9.6" y2="13.6" />
        </svg>
      )
    case 'xbox':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="12" cy="12" r="9.3" />
          <path d="M7.5 6.5c3 2 6 5.5 9 11" />
          <path d="M16.5 6.5c-3 2-6 5.5-9 11" />
        </svg>
      )
    case 'switch':
      // Two Joy-Cons.
      return (
        <svg {...common} fill="currentColor">
          <rect x="4.5" y="3.5" width="6" height="17" rx="3" />
          <rect x="13.5" y="3.5" width="6" height="17" rx="3" />
          <circle cx="7.5" cy="7.5" r="1.15" fill="#000" opacity="0.35" />
        </svg>
      )
    case 'pc':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      )
    default:
      // PlayStation (and fallback): a game controller silhouette.
      return (
        <svg {...common} fill="currentColor">
          <path d="M17 6.5H7a5 5 0 0 0-5 5c0 1.6.3 3.1.85 4.55.5 1.3 1.25 2.45 2.65 2.45 1 0 1.6-.6 2.1-1.25L9 15.5h6l1.4 1.75c.5.65 1.1 1.25 2.1 1.25 1.4 0 2.15-1.15 2.65-2.45C21.7 14.6 22 13.1 22 11.5a5 5 0 0 0-5-5Zm-8 6.6H7.6v1.4H6.4v-1.4H5v-1.2h1.4v-1.4h1.2v1.4H9v1.2Zm5.6 1.3a1.05 1.05 0 1 1 0-2.1 1.05 1.05 0 0 1 0 2.1Zm2-2.6a1.05 1.05 0 1 1 0-2.1 1.05 1.05 0 0 1 0 2.1Z" />
        </svg>
      )
  }
}

/** A single colored platform chip with a brand glyph. */
export function PlatformIcon({ label, size = 13 }: { label: string; size?: number }) {
  const k = platformKey(label)
  const title = k === 'ps' ? providerLabel('psn') : k === 'other' ? label : label
  return (
    <span className={`plat-chip plat-${k}`} title={title} aria-label={title}>
      <Glyph k={k} size={size} />
    </span>
  )
}

/** A row of platform chips, de-duplicated by platform family (so PS4+PS5 show one icon). */
export function PlatformIcons({ labels, size }: { labels: string[]; size?: number }) {
  const seen = new Set<PlatformKey>()
  const keep: string[] = []
  for (const l of labels) {
    const k = platformKey(l)
    if (seen.has(k)) continue
    seen.add(k)
    keep.push(l)
  }
  if (!keep.length) return null
  return (
    <span className="plat-chips">
      {keep.map((l) => (
        <PlatformIcon key={l} label={l} size={size} />
      ))}
    </span>
  )
}
