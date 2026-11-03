// Finds real artwork (cover, banner, description) for games: local Epic catalog cache, then the Steam store.
import { net } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ArtworkProgress, Game, GamePatch } from '@shared/types'
import { getMeta, setMeta } from './db'
import { getGame, listGames, updateGame } from './repo'
import { saveMediaBuffer } from './media'
import { log } from './log'

const RECHECK_MS = 7 * 86400_000

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await net.fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function fetchImage(url: string): Promise<{ buf: Buffer; ext: string } | null> {
  try {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(20000) })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !type.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 2048) return null // placeholder / error pixel
    const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg'
    return { buf, ext }
  } catch {
    return null
  }
}

async function firstImage(urls: string[]): Promise<{ buf: Buffer; ext: string } | null> {
  for (const u of urls) {
    const img = await fetchImage(u)
    if (img) return img
  }
  return null
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/\b(the|edition|definitive|remastered|goty|game of the year|enhanced|deluxe|complete)\b/g, '')
    .replace(/[^a-z0-9]/g, '')

/** Dice coefficient on character bigrams: 1 = identical. */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const grams = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i++) grams.set(a.slice(i, i + 2), (grams.get(a.slice(i, i + 2)) ?? 0) + 1)
  let hits = 0
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2)
    const n = grams.get(g) ?? 0
    if (n > 0) {
      grams.set(g, n - 1)
      hits++
    }
  }
  return (2 * hits) / (a.length + b.length - 2)
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()

// ---------- Steam ----------

interface SteamSearch {
  items?: { id: number; name: string; type: string }[]
}

export async function findSteamAppId(title: string): Promise<string | null> {
  const q = encodeURIComponent(title.replace(/[™®©]/g, '').trim())
  const r = await fetchJson<SteamSearch>(`https://store.steampowered.com/api/storesearch/?term=${q}&l=english&cc=US`)
  const items = (r?.items ?? []).filter((i) => i.type === 'app')
  if (!items.length) return null
  const t = norm(title)
  let best: { id: number; score: number } | null = null
  for (const it of items) {
    const n = norm(it.name)
    const score = n === t ? 1 : similarity(n, t)
    if (!best || score > best.score) best = { id: it.id, score }
  }
  // Only accept confident matches so a game never gets someone else's artwork.
  return best && best.score >= 0.82 ? String(best.id) : null
}

interface SteamDetails {
  [id: string]: { success: boolean; data?: { short_description?: string; developers?: string[]; header_image?: string } }
}

interface SteamItems {
  response?: {
    store_items?: {
      assets?: {
        asset_url_format?: string
        library_capsule?: string
        library_capsule_2x?: string
        library_hero?: string
        library_hero_2x?: string
        header?: string
      }
    }[]
  }
}

/**
 * Exact artwork URLs from the Steam store. Newer games keep their art under hashed paths
 * (…/apps/{id}/{hash}/library_capsule.jpg), so the classic fixed URLs 404 for them.
 */
async function steamAssets(id: string): Promise<{ cover: string[]; hero: string[] }> {
  const input = encodeURIComponent(
    JSON.stringify({ ids: [{ appid: Number(id) }], context: { language: 'english', country_code: 'US' }, data_request: { include_assets: true } })
  )
  const r = await fetchJson<SteamItems>(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${input}`)
  const a = r?.response?.store_items?.[0]?.assets
  if (!a?.asset_url_format) return { cover: [], hero: [] }
  const url = (file?: string) => (file ? `https://shared.steamstatic.com/store_item_assets/${a.asset_url_format!.replace('${FILENAME}', file)}` : '')
  return {
    cover: [url(a.library_capsule_2x), url(a.library_capsule)].filter(Boolean),
    hero: [url(a.library_hero), url(a.library_hero_2x)].filter(Boolean)
  }
}

function steamUrls(id: string, file: string): string[] {
  return [
    `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/${file}`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/${file}`,
    `https://steamcdn-a.akamaihd.net/steam/apps/${id}/${file}`
  ]
}

// ---------- Epic (local catalog cache, no network needed to find URLs) ----------

interface EpicItem {
  title?: string
  description?: string
  developer?: string
  keyImages?: { type: string; url: string }[]
  releaseInfo?: { appId?: string }[]
}

let epicCache: EpicItem[] | null = null
function epicCatalog(): EpicItem[] {
  if (epicCache) return epicCache
  epicCache = []
  try {
    const file = path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Catalog', 'catcache.bin')
    const text = Buffer.from(fs.readFileSync(file, 'utf8'), 'base64').toString('utf8')
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) epicCache = parsed
  } catch {
    /* Epic not installed or cache unreadable */
  }
  return epicCache
}

function findEpicItem(game: Game): EpicItem | null {
  const items = epicCatalog()
  if (game.source === 'epic' && game.sourceId) {
    const hit = items.find((i) => i.releaseInfo?.some((r) => r.appId === game.sourceId))
    if (hit) return hit
  }
  const t = norm(game.title)
  return items.find((i) => i.title && norm(i.title) === t && i.keyImages?.length) ?? null
}

// ---------- main entry ----------

/** Fill in missing cover / banner / description / developer. Returns true if anything changed. */
export async function fetchArtwork(gameId: string, force = false): Promise<boolean> {
  const game = getGame(gameId)
  if (!game) return false
  // v2: recheck everything once, now that hashed Steam cover paths are supported.
  const metaKey = `art_checked_v2:${game.id}`
  if (!force && Date.now() - Number(getMeta(metaKey) ?? 0) < RECHECK_MS) return false
  if (game.cover && game.hero && game.description) return false

  const patch: GamePatch = {}
  const need = () => !(patch.cover || game.cover) || !(patch.hero || game.hero)

  const epic = findEpicItem(game)
  if (epic) {
    const img = (types: string[]) => types.map((t) => epic.keyImages?.find((k) => k.type === t)?.url).filter((u): u is string => !!u)
    if (!game.cover) {
      const c = await firstImage(img(['DieselGameBoxTall', 'OfferImageTall', 'Thumbnail']))
      if (c) patch.cover = saveMediaBuffer(c.buf, c.ext, 'cover')
    }
    if (!game.hero) {
      const h = await firstImage(img(['DieselStoreFrontWide', 'OfferImageWide', 'DieselGameBox']))
      if (h) patch.hero = saveMediaBuffer(h.buf, h.ext, 'hero')
    }
    if (!game.description && epic.description) patch.description = decode(epic.description)
    if (!game.developer && epic.developer) patch.developer = epic.developer
  }

  if (need() || (!game.description && !patch.description)) {
    const appid = game.source === 'steam' && game.sourceId ? game.sourceId : await findSteamAppId(game.title)
    if (appid) {
      const details = await fetchJson<SteamDetails>(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`)
      const data = details?.[appid]?.success ? details[appid]!.data : undefined
      const assets = need() ? await steamAssets(appid) : { cover: [], hero: [] }
      if (!game.cover && !patch.cover) {
        const c = await firstImage([...assets.cover, ...steamUrls(appid, 'library_600x900_2x.jpg'), ...steamUrls(appid, 'library_600x900.jpg')])
        if (c) patch.cover = saveMediaBuffer(c.buf, c.ext, 'cover')
      }
      if (!game.hero && !patch.hero) {
        const h = await firstImage([...assets.hero, ...steamUrls(appid, 'library_hero.jpg'), ...(data?.header_image ? [data.header_image] : [])])
        if (h) patch.hero = saveMediaBuffer(h.buf, h.ext, 'hero')
      }
      if (!game.description && !patch.description && data?.short_description) patch.description = decode(data.short_description)
      if (!game.developer && !patch.developer && data?.developers?.length) patch.developer = data.developers.join(', ')
    }
  }

  setMeta(metaKey, String(Date.now()))
  if (!Object.keys(patch).length) return false
  // The game may have been edited or removed while we were downloading.
  const fresh = getGame(game.id)
  if (!fresh) return false
  for (const k of ['cover', 'hero', 'description', 'developer'] as const) if (fresh[k]) delete patch[k]
  if (!Object.keys(patch).length) return false
  updateGame(game.id, patch)
  return true
}

let running: Promise<{ updated: number; checked: number }> | null = null

/** Fetch artwork for every game missing some. Runs one batch at a time. */
export function fetchAllArtwork(force: boolean, onProgress: (p: ArtworkProgress) => void, onUpdated: () => void) {
  if (running) return running
  running = (async () => {
    epicCache = null
    const targets = listGames().filter((g) => !g.cover || !g.hero || !g.description)
    let updated = 0
    for (let i = 0; i < targets.length; i++) {
      const g = targets[i]!
      onProgress({ done: i, total: targets.length, current: g.title })
      try {
        if (await fetchArtwork(g.id, force)) {
          updated++
          onUpdated()
        }
      } catch (err) {
        log.warn('Artwork fetch failed for', g.title, (err as Error).message)
      }
    }
    onProgress({ done: targets.length, total: targets.length, current: '' })
    return { updated, checked: targets.length }
  })().finally(() => (running = null))
  return running
}
