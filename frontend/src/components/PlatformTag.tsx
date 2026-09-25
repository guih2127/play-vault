import { badgeClass, providerLabel } from '../format'
import { platformBrand, platformIcon, type PlatformBrand } from '../icons'

const BRAND_LABEL: Record<PlatformBrand, string> = {
  psn: 'PlayStation',
  ps5: 'PS5',
  steam: 'Steam',
  switch: 'Nintendo Switch',
  xbox: 'Xbox',
  pc: 'PC',
}

/**
 * Collapse platform labels to one per brand — a game on both PS4 and PS5 shows a single, generic
 * PlayStation icon instead of two. Brand labels become the generic brand name; non-brand labels
 * (e.g. "PC") are kept as-is, de-duplicated.
 */
export function dedupePlatformLabels(labels: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const label of labels) {
    const brand = platformBrand(label)
    const key = brand ?? `text:${label.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(brand ? BRAND_LABEL[brand] : label)
  }
  return out
}

/**
 * A platform pill. Shows the brand logo (PlayStation, Steam, Switch, Xbox) on a per-brand colored
 * chip; the full label is kept in the tooltip so generation info (PS5 vs PS4, Switch 2…) isn't
 * lost on hover. Falls back to a text badge when no brand icon matches (e.g. "PC").
 */
export function PlatformBadge({ label }: { label: string }) {
  const brand = platformBrand(label)
  if (!brand) {
    return (
      <span className={`badge ${badgeClass(label)}`} title={label}>
        {label}
      </span>
    )
  }
  return (
    <span className={`badge badge-icon brand-${brand}`} title={label}>
      {platformIcon(label)}
    </span>
  )
}

/** The provider tag on trophy/platinum rows — same brand chips as PlatformBadge, `src-tag` sizing. */
export function SourceTag({ provider }: { provider: 'psn' | 'steam' | 'xbox' }) {
  const label = providerLabel(provider)
  const brand = platformBrand(provider)
  if (!brand) {
    return (
      <span className={`src-tag src-${provider}`} title={label}>
        {label}
      </span>
    )
  }
  return (
    <span className={`src-tag src-tag-icon brand-${brand}`} title={label}>
      {platformIcon(provider)}
    </span>
  )
}
