import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SqlValue } from 'sql.js'
import type { BackupEntry, Game, ImportResult } from '@shared/types'
import { getMeta, setMeta, flushNow } from './db'
import {
  TABLES,
  addGame,
  createCategory,
  dumpTable,
  getSettings,
  listCategories,
  listGames,
  referencedMedia,
  replaceAllTables,
  setGameCategories,
  type TableName
} from './repo'
import { clearMediaDir, listMediaFiles, readMedia, writeMediaExact } from './media'
import { log } from './log'

const LIBRARY_FORMAT = 'zenith-library'
const BACKUP_FORMAT = 'zenith-backup'

let backupsDir = ''

export function initBackups(dataDir: string): void {
  backupsDir = path.join(dataDir, 'backups')
  fs.mkdirSync(backupsDir, { recursive: true })
}

export function getBackupsDir(): string {
  return backupsDir
}

function mediaBundle(names: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const n of names) {
    const buf = readMedia(n)
    if (buf) out[n] = buf.toString('base64')
  }
  return out
}

function readJson(file: string): any {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    throw new Error(`Cannot read file: ${(err as Error).message}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('File is not valid JSON.')
  }
}

// ---------- library export / import (portable, merges into an existing library) ----------

export function exportLibrary(file: string): void {
  const games = listGames()
  const categories = listCategories()
  const media = new Set<string>()
  for (const g of games) for (const m of [g.cover, g.icon, g.hero]) if (m) media.add(m)
  const payload = {
    format: LIBRARY_FORMAT,
    version: 1,
    exportedAt: Date.now(),
    categories,
    games: games.map(({ installed: _installed, ...g }) => g),
    media: mediaBundle(media)
  }
  fs.writeFileSync(file, JSON.stringify(payload))
}

export function importLibrary(file: string): ImportResult {
  const data = readJson(file)
  if (data?.format !== LIBRARY_FORMAT || !Array.isArray(data.games)) {
    throw new Error('This is not a Zenith library export file.')
  }
  const existing = listGames()
  const byExe = new Set(existing.filter((g) => g.exePath).map((g) => g.exePath.toLowerCase()))
  const bySource = new Set(existing.filter((g) => g.sourceId).map((g) => `${g.source}:${g.sourceId}`))
  const ids = new Set(existing.map((g) => g.id))

  // Map imported categories onto existing ones by name.
  const catIdMap = new Map<string, string>()
  const current = listCategories()
  for (const c of (data.categories ?? []) as { id: string; name: string; color: string }[]) {
    if (!c?.name) continue
    const match = current.find((x) => x.name.toLowerCase() === String(c.name).toLowerCase())
    const target = match ?? createCategory(String(c.name), c.color || '#7c5cff')
    if (!match) current.push(target)
    catIdMap.set(c.id, target.id)
  }

  const media: Record<string, string> = data.media ?? {}
  const writeMedia = (name: string): string => {
    if (!name || typeof media[name] !== 'string') return ''
    const ext = path.extname(name)
    const fresh = `${name.split('-')[0] || 'img'}-${randomUUID()}${ext}`
    return writeMediaExact(fresh, Buffer.from(media[name]!, 'base64')) ? fresh : ''
  }

  let added = 0
  let skipped = 0
  for (const raw of data.games as Partial<Game>[]) {
    if (!raw?.title) {
      skipped++
      continue
    }
    const dupe =
      (raw.exePath && byExe.has(raw.exePath.toLowerCase())) ||
      (raw.sourceId && bySource.has(`${raw.source}:${raw.sourceId}`))
    if (dupe) {
      skipped++
      continue
    }
    try {
      const g = addGame({
        id: raw.id && !ids.has(raw.id) ? raw.id : undefined,
        title: String(raw.title),
        description: String(raw.description ?? ''),
        developer: String(raw.developer ?? ''),
        exePath: String(raw.exePath ?? ''),
        workingDir: String(raw.workingDir ?? ''),
        launchArgs: String(raw.launchArgs ?? ''),
        runAsAdmin: !!raw.runAsAdmin,
        installDir: String(raw.installDir ?? ''),
        launchUri: String(raw.launchUri ?? ''),
        source: raw.source ?? 'import',
        sourceId: String(raw.sourceId ?? ''),
        favorite: !!raw.favorite,
        hidden: !!raw.hidden,
        playtimeSec: Number(raw.playtimeSec) || 0,
        lastPlayed: Number(raw.lastPlayed) || 0,
        launchCount: Number(raw.launchCount) || 0,
        addedAt: Number(raw.addedAt) || Date.now(),
        cover: writeMedia(String(raw.cover ?? '')),
        icon: writeMedia(String(raw.icon ?? '')),
        hero: writeMedia(String(raw.hero ?? ''))
      })
      const cats = (raw.categoryIds ?? []).map((id) => catIdMap.get(id)).filter((x): x is string => !!x)
      if (cats.length) setGameCategories(g.id, cats)
      ids.add(g.id)
      if (g.exePath) byExe.add(g.exePath.toLowerCase())
      added++
    } catch (err) {
      log.warn('Import skipped a game', raw.title, (err as Error).message)
      skipped++
    }
  }
  return { added, skipped }
}

// ---------- full backup / restore (replaces everything) ----------

export function writeBackup(file: string): void {
  flushNow()
  const tables: Record<string, Record<string, SqlValue>[]> = {}
  for (const t of TABLES) tables[t] = dumpTable(t)
  const payload = {
    format: BACKUP_FORMAT,
    version: 1,
    createdAt: Date.now(),
    tables,
    media: mediaBundle(listMediaFiles().map((f) => f.name))
  }
  fs.writeFileSync(file, JSON.stringify(payload))
}

export function restoreBackup(file: string): void {
  const data = readJson(file)
  if (data?.format !== BACKUP_FORMAT || typeof data.tables !== 'object') {
    throw new Error('This is not a Zenith backup file.')
  }
  // Safety net: snapshot the current state before overwriting it.
  try {
    writeBackup(path.join(backupsDir, `before-restore-${stamp()}.zbak`))
  } catch (err) {
    log.warn('Pre-restore snapshot failed', err)
  }
  replaceAllTables(data.tables as Partial<Record<TableName, Record<string, SqlValue>[]>>)
  clearMediaDir()
  for (const [name, b64] of Object.entries((data.media ?? {}) as Record<string, string>)) {
    if (typeof b64 === 'string') writeMediaExact(name, Buffer.from(b64, 'base64'))
  }
  flushNow()
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export function listBackups(): BackupEntry[] {
  try {
    return fs
      .readdirSync(backupsDir)
      .filter((f) => f.endsWith('.zbak'))
      .map((name) => {
        const p = path.join(backupsDir, name)
        const st = fs.statSync(p)
        return { name, path: p, size: st.size, createdAt: st.mtimeMs }
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export function backupNow(prefix = 'manual'): BackupEntry {
  const name = `${prefix}-${stamp()}.zbak`
  const p = path.join(backupsDir, name)
  writeBackup(p)
  pruneBackups()
  const st = fs.statSync(p)
  return { name, path: p, size: st.size, createdAt: st.mtimeMs }
}

function pruneBackups(): void {
  const keep = getSettings().data.keepBackups
  const autos = listBackups().filter((b) => b.name.startsWith('auto-'))
  for (const b of autos.slice(keep)) fs.rmSync(b.path, { force: true })
}

/** Run the scheduled automatic backup if one is due. */
export function maybeAutoBackup(): void {
  const mode = getSettings().data.autoBackup
  if (mode === 'off') return
  const last = Number(getMeta('last_auto_backup') ?? 0)
  const interval = mode === 'daily' ? 86400_000 : 7 * 86400_000
  if (Date.now() - last < interval) return
  if (listGames().length === 0) return
  try {
    backupNow('auto')
    setMeta('last_auto_backup', String(Date.now()))
    log.info('Automatic backup written')
  } catch (err) {
    log.error('Automatic backup failed', err)
  }
}

export function unusedMediaNames(): string[] {
  const used = referencedMedia()
  return listMediaFiles()
    .map((f) => f.name)
    .filter((n) => !used.has(n))
}
