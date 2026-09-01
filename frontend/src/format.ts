export function formatHours(minutes: number): string {
  const hours = minutes / 60
  if (hours >= 100) return `${Math.round(hours).toLocaleString('en-US')} h`
  return `${(Math.round(hours * 10) / 10).toLocaleString('en-US')} h`
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

export function formatDate(iso?: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleString('en-US', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function badgeClass(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('ps5')) return 'badge-ps5'
  if (l.includes('ps4')) return 'badge-ps4'
  if (l.includes('ps3')) return 'badge-ps3'
  if (l.includes('vita')) return 'badge-psvita'
  if (l.includes('switch')) return 'badge-switch'
  if (l.includes('steam')) return 'badge-steam'
  if (l.includes('pc')) return 'badge-pc'
  return 'badge-default'
}
