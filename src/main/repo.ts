import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { SqlValue } from 'sql.js'
import type {
  Category,
  DayStat,
  DeepPartial,
  Game,
  GameInput,
  GamePatch,
  GameSource,
  Session,
  Settings,
  StatsSummary
} from '@shared/types'
import { DEFAULT_SETTINGS, mergeSettings } from '@shared/settings'
import { all, get, run, transaction } from './db'

interface GameRow {
  id: string
  title: string
  description: string
  developer: string
  exe_path: string
  working_dir: string
  launch_args: string
  run_as_admin: number
  install_dir: string
  launch_uri: string
  source: string
  source_id: string
  cover: string
  icon: string
  hero: string
  favorite: number
  hidden: number
  playtime_sec: number
  last_played: number
  launch_count: number
  added_at: number
  launch_profile: string
}

const FIELD_MAP: Record<string, keyof GameRow> = {
  title: 'title',
  description: 'description',
  developer: 'developer',
  exePath: 'exe_path',
  workingDir: 'working_dir',
  launchArgs: 'launch_args',
  runAsAdmin: 'run_as_admin',
  installDir: 'install_dir',
  launchUri: 'launch_uri',
  source: 'source',
  sourceId: 'source_id',
  cover: 'cover',
  icon: 'icon',
  hero: 'hero',
  favorite: 'favorite',
  hidden: 'hidden',
  playtimeSec: 'playtime_sec',
  lastPlayed: 'last_played',
  launchCount: 'launch_count',
  addedAt: 'added_at',
  launchProfile: 'launch_profile'
}

function exists(p: string): boolean {
  if (!p) return false
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

export function isInstalled(g: Pick<Game, 'exePath' | 'installDir' | 'launchUri'>): boolean {
  if (g.exePath && exists(g.exePath)) return true
  if (g.launchUri && g.installDir) return exists(g.installDir)
  return false
}

function categoryMap(): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const r of all<{ game_id: string; category_id: string }>('SELECT game_id, category_id FROM game_categories')) {
    const list = map.get(r.game_id) ?? []
    list.push(r.category_id)
    map.set(r.game_id, list)
  }
  return map
}

function toGame(r: GameRow, cats: string[]): Game {
  const g: Game = {
    id: r.id,
    title: r.title,
    description: r.description,
    developer: r.developer,
    exePath: r.exe_path,
    workingDir: r.working_dir,
    launchArgs: r.launch_args,
    runAsAdmin: !!r.run_as_admin,
    installDir: r.install_dir,
    launchUri: r.launch_uri,
    source: r.source as GameSource,
    sourceId: r.source_id,
    cover: r.cover,
    icon: r.icon,
    hero: r.hero,
    favorite: !!r.favorite,
    hidden: !!r.hidden,
    playtimeSec: r.playtime_sec,
    lastPlayed: r.last_played,
    launchCount: r.launch_count,
    addedAt: r.added_at,
    categoryIds: cats,
    launchProfile: (['default', 'boost', 'potato', 'custom'].includes(r.launch_profile) ? r.launch_profile : '') as Game['launchProfile'],
    installed: false
  }
  g.installed = isInstalled(g)
  return g
}

function toDb(value: unknown): SqlValue {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return Math.round(value)
  return value == null ? '' : String(value).trim()
}

// ---------- games ----------

export function listGames(): Game[] {
  const cats = categoryMap()
  return all<GameRow>('SELECT * FROM games').map((r) => toGame(r, cats.get(r.id) ?? []))
}

export function getGame(id: string): Game | undefined {
  const r = get<GameRow>('SELECT * FROM games WHERE id = ?', [id])
  if (!r) return undefined
  const cats = all<{ category_id: string }>('SELECT category_id FROM game_categories WHERE game_id = ?', [id]).map(
    (c) => c.category_id
  )
  return toGame(r, cats)
}

export function requireGame(id: string): Game {
  const g = getGame(id)
  if (!g) throw new Error('Game not found. It may have been removed.')
  return g
}

export function addGame(input: GameInput & { id?: string; addedAt?: number; playtimeSec?: number; lastPlayed?: number; launchCount?: number }): Game {
  const title = (input.title ?? '').trim()
  if (!title) throw new Error('Game title is required.')
  const id = input.id ?? randomUUID()
  const cols: string[] = ['id', 'added_at']
  const vals: SqlValue[] = [id, input.addedAt ?? Date.now()]
  for (const [key, col] of Object.entries(FIELD_MAP)) {
    if (col === 'added_at') continue
    const v = (input as Record<string, unknown>)[key]
    if (v === undefined) continue
    cols.push(col)
    vals.push(toDb(v))
  }
  transaction(() => {
    run(`INSERT INTO games (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals)
    if (input.categoryIds?.length) setGameCategoriesRaw(id, input.categoryIds)
  })
  return requireGame(id)
}

export function updateGame(id: string, patch: GamePatch): Game {
  requireGame(id)
  const sets: string[] = []
  const vals: SqlValue[] = []
  for (const [key, col] of Object.entries(FIELD_MAP)) {
    const v = (patch as Record<string, unknown>)[key]
    if (v === undefined) continue
    if (key === 'title' && !String(v).trim()) throw new Error('Game title is required.')
    sets.push(`${col} = ?`)
    vals.push(toDb(v))
  }
  transaction(() => {
    if (sets.length) run(`UPDATE games SET ${sets.join(', ')} WHERE id = ?`, [...vals, id])
    if (patch.categoryIds) setGameCategoriesRaw(id, patch.categoryIds)
  })
  return requireGame(id)
}

export function removeGame(id: string): Game | undefined {
  const g = getGame(id)
  if (!g) return undefined
  transaction(() => {
    run('DELETE FROM games WHERE id = ?', [id])
    run('DELETE FROM game_categories WHERE game_id = ?', [id])
    run('DELETE FROM sessions WHERE game_id = ?', [id])
  })
  return g
}

function setGameCategoriesRaw(gameId: string, categoryIds: string[]): void {
  run('DELETE FROM game_categories WHERE game_id = ?', [gameId])
  const valid = new Set(all<{ id: string }>('SELECT id FROM categories').map((c) => c.id))
  for (const cid of new Set(categoryIds)) {
    if (valid.has(cid)) run('INSERT OR IGNORE INTO game_categories (game_id, category_id) VALUES (?, ?)', [gameId, cid])
  }
}

export function setGameCategories(gameId: string, categoryIds: string[]): Game {
  requireGame(gameId)
  transaction(() => setGameCategoriesRaw(gameId, categoryIds))
  return requireGame(gameId)
}

export function markLaunched(id: string, at: number): void {
  run('UPDATE games SET launch_count = launch_count + 1, last_played = ? WHERE id = ?', [at, id])
}

export function recordSession(gameId: string, startedAt: number, endedAt: number): number {
  const duration = Math.max(0, Math.round((endedAt - startedAt) / 1000))
  if (duration < 1 || !getGame(gameId)) return 0
  transaction(() => {
    run('INSERT INTO sessions (game_id, started_at, ended_at, duration_sec) VALUES (?, ?, ?, ?)', [
      gameId,
      startedAt,
      endedAt,
      duration
    ])
    run('UPDATE games SET playtime_sec = playtime_sec + ?, last_played = MAX(last_played, ?) WHERE id = ?', [
      duration,
      endedAt,
      gameId
    ])
  })
  return duration
}

export function clearPlaytime(id: string): Game {
  transaction(() => {
    run('DELETE FROM sessions WHERE game_id = ?', [id])
    run('UPDATE games SET playtime_sec = 0, launch_count = 0, last_played = 0 WHERE id = ?', [id])
  })
  return requireGame(id)
}

export function listSessions(gameId?: string, limit = 100): Session[] {
  const rows = all<{ id: number; game_id: string; title: string; started_at: number; ended_at: number; duration_sec: number }>(
    `SELECT s.id, s.game_id, COALESCE(g.title, 'Removed game') AS title, s.started_at, s.ended_at, s.duration_sec
     FROM sessions s LEFT JOIN games g ON g.id = s.game_id
     ${gameId ? 'WHERE s.game_id = ?' : ''}
     ORDER BY s.started_at DESC LIMIT ?`,
    gameId ? [gameId, limit] : [limit]
  )
  return rows.map((r) => ({
    id: r.id,
    gameId: r.game_id,
    gameTitle: r.title,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationSec: r.duration_sec
  }))
}

// ---------- categories ----------

export function listCategories(): Category[] {
  return all<Category>('SELECT id, name, color, sort FROM categories ORDER BY sort, name COLLATE NOCASE')
}

export function createCategory(name: string, color = '#ff6b2c'): Category {
  const n = name.trim()
  if (!n) throw new Error('Category name is required.')
  const dupe = get<Category>('SELECT * FROM categories WHERE name = ? COLLATE NOCASE', [n])
  if (dupe) throw new Error(`A category named "${n}" already exists.`)
  const id = randomUUID()
  const sort = (get<{ m: number }>('SELECT COALESCE(MAX(sort), -1) AS m FROM categories')?.m ?? -1) + 1
  run('INSERT INTO categories (id, name, color, sort) VALUES (?, ?, ?, ?)', [id, n, color, sort])
  return { id, name: n, color, sort }
}

export function updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'color' | 'sort'>>): Category {
  const cur = get<Category>('SELECT * FROM categories WHERE id = ?', [id])
  if (!cur) throw new Error('Category not found.')
  const next = { ...cur, ...patch }
  next.name = next.name.trim()
  if (!next.name) throw new Error('Category name is required.')
  run('UPDATE categories SET name = ?, color = ?, sort = ? WHERE id = ?', [next.name, next.color, next.sort, id])
  return next
}

export function removeCategory(id: string): void {
  transaction(() => {
    run('DELETE FROM categories WHERE id = ?', [id])
    run('DELETE FROM game_categories WHERE category_id = ?', [id])
  })
}

// ---------- settings ----------

let cachedSettings: Settings | null = null

export function getSettings(): Settings {
  if (cachedSettings) return cachedSettings
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = 'app'")
  let stored: unknown = {}
  try {
    stored = row ? JSON.parse(row.value) : {}
  } catch {
    stored = {}
  }
  cachedSettings = mergeSettings(DEFAULT_SETTINGS, stored)
  return cachedSettings
}

export function saveSettings(patch: DeepPartial<Settings>): Settings {
  const next = mergeSettings(getSettings(), patch)
  next.library.gridSize = clamp(next.library.gridSize, 130, 320)
  next.scanning.depth = clamp(next.scanning.depth, 1, 6)
  next.scanning.autoScanIntervalMin = clamp(next.scanning.autoScanIntervalMin, 0, 1440)
  next.appearance.backgroundBlur = clamp(next.appearance.backgroundBlur, 0, 60)
  next.appearance.backgroundDim = clamp(next.appearance.backgroundDim, 0, 95)
  next.appearance.uiScale = clamp(next.appearance.uiScale, 80, 130)
  next.data.keepBackups = clamp(next.data.keepBackups, 1, 50)
  next.updates.intervalHours = clamp(next.updates.intervalHours, 1, 168)
  if (next.discord.statusShows !== 'game') next.discord.statusShows = 'launcher'
  next.launch.potatoRenderScale = clamp(next.launch.potatoRenderScale, 25, 100)
  if (!['default', 'boost', 'potato', 'custom'].includes(next.launch.defaultProfile)) next.launch.defaultProfile = 'default'
  if (!['native', '1600x900', '1280x720', '960x540'].includes(next.launch.potatoResolution)) next.launch.potatoResolution = '1280x720'
  if (!['auto', 'quit', 'manual'].includes(next.updates.installMode)) next.updates.installMode = DEFAULT_SETTINGS.updates.installMode
  if (!/^#[0-9a-f]{6}$/i.test(next.appearance.accent)) next.appearance.accent = DEFAULT_SETTINGS.appearance.accent
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)", [JSON.stringify(next)])
  cachedSettings = next
  return next
}

export function resetSettingsCache(): void {
  cachedSettings = null
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min))
}

// ---------- stats ----------

function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getStats(): StatsSummary {
  const totals = get<{ total: number }>('SELECT COALESCE(SUM(playtime_sec), 0) AS total FROM games')
  const agg = get<{ n: number; avg: number; longest: number }>(
    'SELECT COUNT(*) AS n, COALESCE(AVG(duration_sec), 0) AS avg, COALESCE(MAX(duration_sec), 0) AS longest FROM sessions'
  )

  const days = 30
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  const buckets = new Map<string, number>()
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    buckets.set(dayKey(d.getTime()), 0)
  }
  const recent = all<{ started_at: number; duration_sec: number }>(
    'SELECT started_at, duration_sec FROM sessions WHERE started_at >= ?',
    [start.getTime()]
  )
  for (const s of recent) {
    const k = dayKey(s.started_at)
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + s.duration_sec)
  }
  const daily: DayStat[] = [...buckets.entries()].map(([date, seconds]) => ({ date, seconds }))

  const weekAgo = Date.now() - 7 * 86400_000
  const week = get<{ s: number }>('SELECT COALESCE(SUM(duration_sec), 0) AS s FROM sessions WHERE started_at >= ?', [weekAgo])

  const byWeekday = [0, 0, 0, 0, 0, 0, 0]
  for (const s of all<{ started_at: number; duration_sec: number }>('SELECT started_at, duration_sec FROM sessions')) {
    byWeekday[new Date(s.started_at).getDay()] += s.duration_sec
  }

  const topGames = all<{ id: string; title: string; playtime_sec: number; cover: string; icon: string }>(
    'SELECT id, title, playtime_sec, cover, icon FROM games WHERE playtime_sec > 0 ORDER BY playtime_sec DESC LIMIT 10'
  ).map((g) => ({ gameId: g.id, title: g.title, seconds: g.playtime_sec, cover: g.cover, icon: g.icon }))

  return {
    totalPlaytimeSec: totals?.total ?? 0,
    totalSessions: agg?.n ?? 0,
    avgSessionSec: Math.round(agg?.avg ?? 0),
    longestSessionSec: agg?.longest ?? 0,
    weekSeconds: week?.s ?? 0,
    daily,
    topGames,
    byWeekday
  }
}

// ---------- raw table access (backup / restore) ----------

export const TABLES = ['games', 'categories', 'game_categories', 'sessions', 'settings'] as const
export type TableName = (typeof TABLES)[number]

export function dumpTable(table: TableName): Record<string, SqlValue>[] {
  return all(`SELECT * FROM ${table}`)
}

export function replaceAllTables(data: Partial<Record<TableName, Record<string, SqlValue>[]>>): void {
  transaction(() => {
    for (const table of TABLES) {
      run(`DELETE FROM ${table}`)
      const rows = data[table] ?? []
      const columns = new Set(all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name))
      for (const row of rows) {
        const keys = Object.keys(row).filter((k) => columns.has(k))
        if (!keys.length) continue
        run(
          `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
          keys.map((k) => row[k] as SqlValue)
        )
      }
    }
  })
  cachedSettings = null
}

export function referencedMedia(): Set<string> {
  const used = new Set<string>()
  for (const g of all<{ cover: string; icon: string; hero: string }>('SELECT cover, icon, hero FROM games')) {
    for (const m of [g.cover, g.icon, g.hero]) if (m) used.add(m)
  }
  const bg = getSettings().appearance.backgroundImage
  if (bg) used.add(bg)
  return used
}
