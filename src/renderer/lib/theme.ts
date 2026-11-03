import type { Settings } from '@shared/types'

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1]!, 16) : 0x7c5cff
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

/** Apply theme, accent colour, scale and motion preferences to the document. */
export function applyAppearance(s: Settings): void {
  const root = document.documentElement
  const a = s.appearance
  root.dataset.theme = a.theme
  const [r, g, b] = hexToRgb(a.accent)
  root.style.setProperty('--accent', `${r} ${g} ${b}`)
  const [h, sat, l] = rgbToHsl(r, g, b)
  const second = hslToRgb((h + 32) % 360, Math.min(1, sat * 0.95 + 0.05), Math.min(0.68, Math.max(0.5, l)))
  root.style.setProperty('--accent-2', second.join(' '))
  // Readable text on accent-filled surfaces: near-black on bright accents, bone white on deep ones.
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  root.style.setProperty('--on-accent', lum > 0.179 ? '18 12 6' : '255 250 242')
  root.style.fontSize = `${(16 * a.uiScale) / 100}px`
  root.classList.toggle('no-anim', !a.animations)
  root.classList.toggle('no-glass', !a.glass)
  root.classList.toggle('no-grain', !a.grain)
}
