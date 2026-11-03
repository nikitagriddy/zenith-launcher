// Game page extras: Steam trailer / screenshots / news, install size on disk, and uninstalling.
import { net, shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Game, GameExtras, InstallSize, UninstallInfo } from '@shared/types'
import { findSteamAppId } from './artwork'
import { isDriveRoot } from './exe'
import { getMeta, setMeta } from './db'
import { requireGame } from './repo'
import { findUninstallEntry } from './stores'

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await net.fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

const strip = (s: string) =>
  s
    .replace(/\{STEAM_CLAN_IMAGE\}[^\s]*/g, '')
    .replace(/\[\/?[a-z0-9*]+(=[^\]]*)?\]/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Steam app id for any game: its own id for Steam games, otherwise a cached store search by title. */
export async function steamAppIdFor(game: Game): Promise<string | null> {
  if (game.source === 'steam' && game.sourceId) return game.sourceId
  const key = `steam_appid:${game.id}:${game.title}`
  const cached = getMeta(key)
  if (cached !== undefined) return cached || null
  const id = await findSteamAppId(game.title)
  // Only cache definite answers; a failed lookup (offline) should be retried next time.
  if (id) setMeta(key, id)
  else if (await online()) setMeta(key, '')
  return id
}

async function online(): Promise<boolean> {
  try {
    const r = await net.fetch('https://store.steampowered.com/', { method: 'HEAD', signal: AbortSignal.timeout(5000) })
    return r.ok || r.status < 500
  } catch {
    return false
  }
}

interface SteamDetails {
  [id: string]: {
    success: boolean
    data?: {
      movies?: { name: string; thumbnail: string; hls_h264?: string; mp4?: { max?: string; '480'?: string }; webm?: { max?: string } }[]
      screenshots?: { path_thumbnail: string; path_full: string }[]
    }
  }
}

interface SteamNews {
  appnews?: { newsitems?: { gid: string; title: string; url: string; author: string; contents: string; date: number; feedlabel: string }[] }
}

const extrasCache = new Map<string, { at: number; data: GameExtras }>()

export async function getExtras(gameId: string): Promise<GameExtras> {
  const game = requireGame(gameId)
  const hit = extrasCache.get(gameId)
  if (hit && Date.now() - hit.at < 3600_000 && hit.data.title === game.title) return hit.data

  const empty: GameExtras = { title: game.title, steamAppId: null, storeUrl: null, trailer: null, screenshots: [], news: [], offline: false }
  const appid = await steamAppIdFor(game)
  if (!appid) {
    const data = { ...empty, offline: !(await online()) }
    if (!data.offline) extrasCache.set(gameId, { at: Date.now(), data })
    return data
  }
  const [details, news] = await Promise.all([
    fetchJson<SteamDetails>(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english&filters=movies,screenshots`),
    fetchJson<SteamNews>(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=6&maxlength=400&format=json`)
  ])
  if (!details && !news) return { ...empty, steamAppId: appid, storeUrl: `https://store.steampowered.com/app/${appid}`, offline: true }
  const d = details?.[appid]?.success ? details[appid]!.data : undefined
  const movie = d?.movies?.find((m) => m.hls_h264 || m.mp4?.max || m.webm?.max)
  const data: GameExtras = {
    title: game.title,
    steamAppId: appid,
    storeUrl: `https://store.steampowered.com/app/${appid}`,
    trailer: movie
      ? { name: movie.name, thumbnail: movie.thumbnail, hls: movie.hls_h264 ?? null, mp4: movie.mp4?.max ?? movie.webm?.max ?? null }
      : null,
    screenshots: (d?.screenshots ?? []).slice(0, 12).map((s) => ({ thumb: s.path_thumbnail, full: s.path_full })),
    news: (news?.appnews?.newsitems ?? []).map((n) => ({
      id: n.gid,
      title: strip(n.title),
      url: n.url,
      author: n.author || n.feedlabel,
      date: n.date * 1000,
      excerpt: strip(n.contents).slice(0, 220)
    })),
    offline: false
  }
  extrasCache.set(gameId, { at: Date.now(), data })
  return data
}

// ---------- install size ----------

async function folderSize(dir: string, limitFiles = 400_000): Promise<{ bytes: number; files: number; partial: boolean }> {
  let bytes = 0
  let files = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      const p = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile()) {
        try {
          bytes += (await fs.promises.stat(p)).size
        } catch {
          /* locked file */
        }
        if (++files >= limitFiles) return { bytes, files, partial: true }
      }
    }
  }
  return { bytes, files, partial: false }
}

const sizeJobs = new Map<string, Promise<InstallSize>>()

export function getInstallSize(gameId: string, refresh = false): Promise<InstallSize | null> {
  const game = requireGame(gameId)
  const dir = game.installDir || (game.exePath ? path.dirname(game.exePath) : '')
  if (!dir || !fs.existsSync(dir) || isDriveRoot(dir)) return Promise.resolve(null)
  const key = `size:${game.id}`
  if (!refresh) {
    try {
      const cached = JSON.parse(getMeta(key) ?? 'null') as InstallSize | null
      if (cached && cached.dir === dir && Date.now() - cached.computedAt < 3 * 86400_000) return Promise.resolve(cached)
    } catch {
      /* recompute */
    }
  }
  const running = sizeJobs.get(game.id)
  if (running) return running
  const job = folderSize(dir)
    .then((r) => {
      const result: InstallSize = { ...r, dir, computedAt: Date.now() }
      setMeta(key, JSON.stringify(result))
      return result
    })
    .finally(() => sizeJobs.delete(game.id))
  sizeJobs.set(game.id, job)
  return job
}

// ---------- uninstall ----------

type Plan = { label: string; uri?: string; command?: string; file?: string }

async function uninstallPlan(game: Game): Promise<Plan | null> {
  if (game.source === 'steam' && game.sourceId) return { label: 'Uninstall with Steam', uri: `steam://uninstall/${game.sourceId}` }
  if (game.source === 'epic') return { label: 'Uninstall in Epic Games', uri: 'com.epicgames.launcher://store/library' }
  const entry = await findUninstallEntry(game.installDir || (game.exePath ? path.dirname(game.exePath) : ''), game.title)
  if (entry) return { label: `Uninstall (${entry.name})`, command: entry.uninstallString }
  // Common uninstallers shipped inside the game folder (Inno Setup, NSIS…).
  const dir = game.installDir || (game.exePath ? path.dirname(game.exePath) : '')
  if (dir && fs.existsSync(dir)) {
    const file = fs.readdirSync(dir).find((f) => /^(unins\d{3}|uninstall|uninst)\.exe$/i.test(f))
    if (file) return { label: 'Run uninstaller', file: path.join(dir, file) }
  }
  return null
}

export async function getUninstallInfo(gameId: string): Promise<UninstallInfo> {
  const game = requireGame(gameId)
  if (!game.installed) return { available: false, label: 'Not installed' }
  const plan = await uninstallPlan(game)
  return plan ? { available: true, label: plan.label } : { available: false, label: 'No uninstaller found' }
}

export async function runUninstall(gameId: string): Promise<string> {
  const game = requireGame(gameId)
  const plan = await uninstallPlan(game)
  if (!plan) throw new Error('No uninstaller was found for this game.')
  if (plan.uri) {
    await shell.openExternal(plan.uri)
  } else if (plan.file) {
    const err = await shell.openPath(plan.file)
    if (err) throw new Error(err)
  } else if (plan.command) {
    // Some vendors register unquoted paths with spaces: quote everything up to ".exe".
    let cmd = plan.command.trim()
    if (!cmd.startsWith('"')) cmd = cmd.replace(/^(.+?\.exe)(?=\s|$)/i, (m) => (m.includes(' ') ? `"${m}"` : m))
    // "start" goes through ShellExecute, so uninstallers that need admin rights get their UAC prompt.
    const child = spawn(`start "" ${cmd}`, { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
  }
  return plan.label
}
