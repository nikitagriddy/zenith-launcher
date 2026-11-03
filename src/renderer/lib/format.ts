export function formatPlaytime(sec: number, empty = 'Never played'): string {
  if (!sec || sec < 1) return empty
  if (sec < 60) return '< 1 min'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h === 0) return `${m} min`
  if (h < 100 && m) return `${h}h ${m}m`
  return `${h.toLocaleString()} h`
}

export function formatHours(sec: number): string {
  if (sec > 0 && sec < 60) return '<1m'
  const h = sec / 3600
  if (h < 1) return `${Math.round(sec / 60)}m`
  return h < 10 ? `${h.toFixed(1)}h` : `${Math.round(h).toLocaleString()}h`
}

export function formatRelative(ts: number, empty = 'Never'): string {
  if (!ts) return empty
  const diff = Date.now() - ts
  const min = Math.round(diff / 60000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'Yesterday'
  if (d < 7) return `${d} days ago`
  if (d < 30) return `${Math.round(d / 7)} week${Math.round(d / 7) === 1 ? '' : 's'} ago`
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatDate(ts: number): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatDateTime(ts: number): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

export function formatClock(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

/** Deterministic hue from a string, for generated cover art. */
export function hueFrom(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

export function mediaUrl(name: string | undefined | null): string {
  return name ? `zenith-media://media/${encodeURIComponent(name)}` : ''
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
