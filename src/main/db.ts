import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import fs from 'node:fs'
import path from 'node:path'
import { log } from './log'

const SCHEMA_VERSION = 2

let db: Database | null = null
let dbFile = ''
let saveTimer: NodeJS.Timeout | null = null
let dirty = false

type Params = SqlValue[] | Record<string, SqlValue>

function conn(): Database {
  if (!db) throw new Error('Database is not open')
  return db
}

export async function openDatabase(dataDir: string): Promise<void> {
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
  const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) as unknown as ArrayBuffer })
  dbFile = path.join(dataDir, 'zenith.db')

  if (fs.existsSync(dbFile)) {
    try {
      db = new SQL.Database(fs.readFileSync(dbFile))
      db.exec('SELECT count(*) FROM sqlite_master')
    } catch (err) {
      const broken = `${dbFile}.corrupt-${Date.now()}`
      log.error('Database unreadable, starting fresh. Old file moved to', broken, err)
      try {
        fs.renameSync(dbFile, broken)
      } catch {
        /* ignore */
      }
      db = new SQL.Database()
    }
  } else {
    db = new SQL.Database()
  }
  migrate()
  flushNow()
}

function migrate(): void {
  const d = conn()
  d.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      developer TEXT NOT NULL DEFAULT '',
      exe_path TEXT NOT NULL DEFAULT '',
      working_dir TEXT NOT NULL DEFAULT '',
      launch_args TEXT NOT NULL DEFAULT '',
      run_as_admin INTEGER NOT NULL DEFAULT 0,
      install_dir TEXT NOT NULL DEFAULT '',
      launch_uri TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      source_id TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      hero TEXT NOT NULL DEFAULT '',
      favorite INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      playtime_sec INTEGER NOT NULL DEFAULT 0,
      last_played INTEGER NOT NULL DEFAULT 0,
      launch_count INTEGER NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#7c5cff',
      sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS game_categories (
      game_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      PRIMARY KEY (game_id, category_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_sec INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_game ON sessions(game_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  // v2: per-game launch mode.
  const cols = new Set(all<{ name: string }>('PRAGMA table_info(games)').map((c) => c.name))
  if (!cols.has('launch_profile')) d.exec("ALTER TABLE games ADD COLUMN launch_profile TEXT NOT NULL DEFAULT ''")
  d.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['schema_version', String(SCHEMA_VERSION)])
}

export function all<T = Record<string, SqlValue>>(sql: string, params: Params = []): T[] {
  const stmt = conn().prepare(sql)
  try {
    stmt.bind(params)
    const rows: T[] = []
    while (stmt.step()) rows.push(stmt.getAsObject() as T)
    return rows
  } finally {
    stmt.free()
  }
}

export function get<T = Record<string, SqlValue>>(sql: string, params: Params = []): T | undefined {
  return all<T>(sql, params)[0]
}

export function run(sql: string, params: Params = []): void {
  conn().run(sql, params)
  scheduleSave()
}

export function transaction(fn: () => void): void {
  const d = conn()
  d.exec('BEGIN')
  try {
    fn()
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
  scheduleSave()
}

export function getMeta(key: string): string | undefined {
  return get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])?.value
}

export function setMeta(key: string, value: string): void {
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value])
}

function scheduleSave(): void {
  dirty = true
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    flushNow()
  }, 400)
}

/** Write the in-memory database to disk atomically. */
export function flushNow(): void {
  if (!db) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  try {
    const data = db.export()
    const tmp = `${dbFile}.tmp`
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, dbFile)
    dirty = false
  } catch (err) {
    log.error('Failed to save database', err)
  }
}

export function closeDatabase(): void {
  if (dirty) flushNow()
  db?.close()
  db = null
}

export function databaseFile(): string {
  return dbFile
}
