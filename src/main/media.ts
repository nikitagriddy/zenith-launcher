import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { log } from './log'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.ico'])
const MAX_BYTES = 30 * 1024 * 1024

let mediaDir = ''

export function initMedia(dataDir: string): void {
  mediaDir = path.join(dataDir, 'media')
  fs.mkdirSync(mediaDir, { recursive: true })
}

export function getMediaDir(): string {
  return mediaDir
}

/** Resolve a stored media name to an absolute path, refusing anything that escapes the media folder. */
export function mediaPath(name: string): string | null {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return null
  return path.join(mediaDir, name)
}

function safePrefix(prefix: string): string {
  return prefix.replace(/[^a-z0-9-]/gi, '').slice(0, 16) || 'img'
}

export function importMediaFile(src: string, prefix: string): string {
  const ext = path.extname(src).toLowerCase()
  if (!IMAGE_EXT.has(ext)) throw new Error('Unsupported image type. Use PNG, JPG, WEBP, GIF, BMP, AVIF or ICO.')
  const stat = fs.statSync(src)
  if (!stat.isFile()) throw new Error('Selected path is not a file.')
  if (stat.size > MAX_BYTES) throw new Error('Image is too large (max 30 MB).')
  const name = `${safePrefix(prefix)}-${randomUUID()}${ext}`
  fs.copyFileSync(src, path.join(mediaDir, name))
  return name
}

export function saveMediaBuffer(buf: Buffer, ext: string, prefix: string): string {
  const name = `${safePrefix(prefix)}-${randomUUID()}${ext.startsWith('.') ? ext : '.' + ext}`
  fs.writeFileSync(path.join(mediaDir, name), buf)
  return name
}

/** Write a media file under an exact name (used by restore/import). Returns false if the name is unsafe. */
export function writeMediaExact(name: string, buf: Buffer): boolean {
  const p = mediaPath(name)
  if (!p || !IMAGE_EXT.has(path.extname(name).toLowerCase())) return false
  fs.writeFileSync(p, buf)
  return true
}

export function readMedia(name: string): Buffer | null {
  const p = mediaPath(name)
  if (!p) return null
  try {
    return fs.readFileSync(p)
  } catch {
    return null
  }
}

export function deleteMedia(name: string): void {
  const p = mediaPath(name)
  if (!p) return
  fs.rm(p, { force: true }, () => undefined)
}

export async function extractExeIcon(exePath: string): Promise<string> {
  if (!exePath || !fs.existsSync(exePath)) throw new Error('Executable not found, cannot extract icon.')
  const img = await app.getFileIcon(exePath, { size: 'large' })
  if (img.isEmpty()) throw new Error('No icon found in executable.')
  return saveMediaBuffer(img.toPNG(), '.png', 'icon')
}

export async function tryExtractIcon(exePath: string): Promise<string> {
  try {
    return await extractExeIcon(exePath)
  } catch (err) {
    log.warn('Icon extraction failed for', exePath, (err as Error).message)
    return ''
  }
}

export function listMediaFiles(): { name: string; size: number }[] {
  try {
    return fs.readdirSync(mediaDir).map((name) => {
      try {
        return { name, size: fs.statSync(path.join(mediaDir, name)).size }
      } catch {
        return { name, size: 0 }
      }
    })
  } catch {
    return []
  }
}

export function clearMediaDir(): void {
  for (const f of listMediaFiles()) fs.rmSync(path.join(mediaDir, f.name), { force: true })
}
