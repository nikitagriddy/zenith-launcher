// Renders the Zenith app icon (256x256 PNG) with a tiny signed-distance rasterizer - no native deps.
// Output: build/icon.png (installer/exe) and resources/icon.png (window + tray).
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const S = 256
const SS = 4 // supersampling per axis

const accent = [255, 107, 44]
const accent2 = [255, 160, 60]
const ink = [18, 10, 4]

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
const clamp = (v) => Math.max(0, Math.min(1, v))

// Shapes in a 64-unit design space (same as the in-app SVG logo).
function roundedRect(x, y) {
  const r = 14, h = 32
  const qx = Math.abs(x - h) - (h - r)
  const qy = Math.abs(y - h) - (h - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
function arc(x, y) {
  // Upper half of circle centred (32,46) radius 22, stroke width 5, round caps.
  const dx = x - 32, dy = y - 46
  if (dy <= 0) return Math.abs(Math.hypot(dx, dy) - 22) - 2.5
  return Math.min(Math.hypot(x - 10, y - 46), Math.hypot(x - 54, y - 46)) - 2.5
}
function mast(x, y) {
  const cy = Math.max(27, Math.min(46, y))
  return Math.hypot(x - 32, y - cy) - 1.5
}
function sun(x, y) {
  return Math.hypot(x - 32, y - 16) - 6
}

const px = Buffer.alloc(S * S * 4)
for (let py = 0; py < S; py++) {
  for (let pxi = 0; pxi < S; pxi++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = ((pxi + (sx + 0.5) / SS) / S) * 64
        const y = ((py + (sy + 0.5) / SS) / S) * 64
        if (roundedRect(x, y) > 0) continue
        let c = mix(accent, accent2, clamp((64 - y) / 64) * 0.5)
        if (arc(x, y) <= 0 || sun(x, y) <= 0) c = ink
        else if (mast(x, y) <= 0) c = mix(c, ink, 0.55)
        r += c[0]; g += c[1]; b += c[2]; a += 1
      }
    }
    const n = SS * SS
    const i = (py * S + pxi) * 4
    if (a) {
      px[i] = Math.round(r / a)
      px[i + 1] = Math.round(g / a)
      px[i + 2] = Math.round(b / a)
    }
    px[i + 3] = Math.round((a / n) * 255)
  }
}

// --- minimal PNG encoder ---
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const raw = Buffer.alloc((S * 4 + 1) * S)
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4)
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

for (const dir of ['build', 'resources']) {
  mkdirSync(resolve(root, dir), { recursive: true })
  writeFileSync(resolve(root, dir, 'icon.png'), png)
}
console.log('Wrote build/icon.png and resources/icon.png')
