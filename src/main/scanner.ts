import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import type { ScanCandidate, ScanProgress, ScanResult, Settings } from '@shared/types'
import { prettifyTitle, rankExes, walkExes } from './exe'
import { log } from './log'

/** Sub-folder names that mean "you picked a game folder itself, not a folder of games". */
const GENERIC_SUBDIRS = new Set(['bin', 'bin64', 'binaries', 'x64', 'x86', 'win64', 'win32', 'game', 'engine', 'data', 'content', 'redist', 'plugins'])

interface ScanContext {
  depth: number
  exclude: string[]
  knownExe: Set<string>
  knownDirs: Set<string>
  knownSource: Set<string>
  onProgress: (p: ScanProgress) => void
}

const lc = (p: string) => path.resolve(p).toLowerCase()

function folderCandidate(dir: string, ctx: ScanContext, depthBoost = 0): ScanCandidate | null {
  const name = path.basename(dir)
  const exes = walkExes(dir, ctx.depth + depthBoost, 300, ctx.exclude)
  if (!exes.length) return null
  const ranked = rankExes(exes, name)
  const best = ranked[0]!
  if (ctx.knownExe.has(lc(best.path)) || ctx.knownDirs.has(lc(dir))) return null
  return {
    key: `scan:${lc(best.path)}`,
    title: prettifyTitle(name),
    exePath: best.path,
    installDir: dir,
    source: 'scan',
    sourceId: '',
    launchUri: '',
    alternatives: ranked.slice(0, 8).map((e) => ({ path: e.path, size: e.size })),
    coverFile: '',
    heroFile: ''
  }
}

function scanRoot(root: string, ctx: ScanContext, out: ScanCandidate[], warnings: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch (err) {
    warnings.push(`Cannot read folder ${root}: ${(err as Error).message}`)
    return
  }
  const dirs = entries.filter((e) => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.') && !e.name.startsWith('$'))
  const rootHasExe = entries.some((e) => e.isFile() && e.name.toLowerCase().endsWith('.exe'))
  const looksLikeGame = rootHasExe || dirs.some((d) => GENERIC_SUBDIRS.has(d.name.toLowerCase()))

  if (looksLikeGame) {
    ctx.onProgress({ phase: 'folders', current: root, found: out.length })
    const c = folderCandidate(root, ctx, 1)
    if (c) out.push(c)
    return
  }
  for (const d of dirs) {
    const dir = path.join(root, d.name)
    if (ctx.exclude.some((w) => d.name.toLowerCase().includes(w))) continue
    ctx.onProgress({ phase: 'folders', current: dir, found: out.length })
    const c = folderCandidate(dir, ctx)
    if (c) out.push(c)
  }
}

// ---------- Steam ----------

type Vdf = { [k: string]: string | Vdf }

/** Minimal Valve KeyValues (VDF/ACF) parser. */
export function parseVdf(text: string): Vdf {
  const tokens: string[] = []
  const re = /"((?:\\.|[^"\\])*)"|([{}])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) tokens.push(m[2] ?? m[1]!.replace(/\\\\/g, '\\'))
  let i = 0
  const parseObj = (): Vdf => {
    const obj: Vdf = {}
    while (i < tokens.length) {
      const key = tokens[i++]!
      if (key === '}') break
      const next = tokens[i++]
      if (next === '{') obj[key] = parseObj()
      else if (next !== undefined) obj[key] = next
    }
    return obj
  }
  return parseObj()
}

function regQuery(key: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const line = stdout.split(/\r?\n/).find((l) => l.includes('REG_SZ'))
      resolve(line ? line.split('REG_SZ')[1]!.trim() : null)
    })
  })
}

async function findSteamDir(): Promise<string | null> {
  const candidates = [
    await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
    await regQuery('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam'
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'steamapps'))) return path.normalize(c)
  }
  return null
}

const STEAM_SKIP_NAME = /(redistributable|proton|steam linux runtime|steamvr|dedicated server|\bsdk\b|soundtrack|steamworks)/i
const STEAM_SKIP_IDS = new Set(['228980', '1070560', '1391110', '1628350', '1493710', '250820', '1826330'])

function findSteamArt(steamDir: string, appid: string, kind: 'library_600x900' | 'library_hero'): string {
  const cache = path.join(steamDir, 'appcache', 'librarycache')
  const direct = [path.join(cache, `${appid}_${kind}.jpg`), path.join(cache, appid, `${kind}.jpg`)]
  for (const p of direct) if (fs.existsSync(p)) return p
  // Newer Steam clients store art in hashed sub-folders.
  const appDir = path.join(cache, appid)
  try {
    for (const sub of fs.readdirSync(appDir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue
      const p = path.join(appDir, sub.name, `${kind}.jpg`)
      if (fs.existsSync(p)) return p
    }
  } catch {
    /* none */
  }
  return ''
}

async function scanSteam(ctx: ScanContext, out: ScanCandidate[], warnings: string[]): Promise<void> {
  const steamDir = await findSteamDir()
  if (!steamDir) return
  ctx.onProgress({ phase: 'steam', current: steamDir, found: out.length })
  const libs = new Set<string>([steamDir])
  try {
    const vdf = parseVdf(fs.readFileSync(path.join(steamDir, 'steamapps', 'libraryfolders.vdf'), 'utf8'))
    const root = (vdf.libraryfolders ?? vdf.LibraryFolders) as Vdf | undefined
    for (const v of Object.values(root ?? {})) {
      if (typeof v === 'string' && /[\\/]/.test(v)) libs.add(path.normalize(v))
      else if (typeof v === 'object' && typeof v.path === 'string') libs.add(path.normalize(v.path))
    }
  } catch (err) {
    warnings.push(`Steam library list unreadable: ${(err as Error).message}`)
  }

  for (const lib of libs) {
    const apps = path.join(lib, 'steamapps')
    let files: string[] = []
    try {
      files = fs.readdirSync(apps).filter((f) => /^appmanifest_\d+\.acf$/i.test(f))
    } catch {
      continue
    }
    for (const f of files) {
      try {
        const st = parseVdf(fs.readFileSync(path.join(apps, f), 'utf8')).AppState as Vdf | undefined
        if (!st) continue
        const appid = String(st.appid ?? '')
        const name = String(st.name ?? '')
        const installdir = String(st.installdir ?? '')
        if (!appid || !name || STEAM_SKIP_IDS.has(appid) || STEAM_SKIP_NAME.test(name)) continue
        if (ctx.knownSource.has(`steam:${appid}`)) continue
        const dir = path.join(apps, 'common', installdir)
        if (!fs.existsSync(dir)) continue
        ctx.onProgress({ phase: 'steam', current: name, found: out.length })
        const ranked = rankExes(walkExes(dir, 4, 200), installdir)
        out.push({
          key: `steam:${appid}`,
          title: name,
          exePath: ranked[0]?.path ?? '',
          installDir: dir,
          source: 'steam',
          sourceId: appid,
          launchUri: `steam://rungameid/${appid}`,
          alternatives: ranked.slice(0, 8).map((e) => ({ path: e.path, size: e.size })),
          coverFile: findSteamArt(steamDir, appid, 'library_600x900'),
          heroFile: findSteamArt(steamDir, appid, 'library_hero')
        })
      } catch (err) {
        log.warn('Bad Steam manifest', f, (err as Error).message)
      }
    }
  }
}

// ---------- Epic Games ----------

async function scanEpic(ctx: ScanContext, out: ScanCandidate[]): Promise<void> {
  const dir = path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.item'))
  } catch {
    return
  }
  ctx.onProgress({ phase: 'epic', current: dir, found: out.length })
  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      if (m.bIsIncompleteInstall) continue
      if (m.MainGameAppName && m.AppName && m.MainGameAppName !== m.AppName) continue // DLC
      if (Array.isArray(m.AppCategories) && m.AppCategories.length && !m.AppCategories.includes('games')) continue
      const appName = String(m.AppName ?? '')
      if (!appName || ctx.knownSource.has(`epic:${appName}`)) continue
      const install = String(m.InstallLocation ?? '')
      if (!install || !fs.existsSync(install)) continue
      const exe = m.LaunchExecutable ? path.join(install, m.LaunchExecutable) : ''
      const ranked = rankExes(walkExes(install, 4, 200), path.basename(install))
      const ns = encodeURIComponent(String(m.CatalogNamespace ?? ''))
      const item = encodeURIComponent(String(m.CatalogItemId ?? ''))
      out.push({
        key: `epic:${appName}`,
        title: String(m.DisplayName ?? appName),
        exePath: exe && fs.existsSync(exe) ? exe : (ranked[0]?.path ?? ''),
        installDir: install,
        source: 'epic',
        sourceId: appName,
        launchUri: `com.epicgames.launcher://apps/${ns}%3A${item}%3A${encodeURIComponent(appName)}?action=launch&silent=true`,
        alternatives: ranked.slice(0, 8).map((e) => ({ path: e.path, size: e.size })),
        coverFile: '',
        heroFile: ''
      })
    } catch (err) {
      log.warn('Bad Epic manifest', f, (err as Error).message)
    }
  }
}

// ---------- entry ----------

export async function scanForGames(
  settings: Settings,
  known: { exePaths: string[]; installDirs: string[]; sources: string[] },
  opts: { folders?: string[]; includeStores?: boolean },
  onProgress: (p: ScanProgress) => void
): Promise<ScanResult> {
  const ctx: ScanContext = {
    depth: settings.scanning.depth,
    exclude: settings.scanning.excludeKeywords.map((k) => k.toLowerCase().trim()).filter(Boolean),
    knownExe: new Set(known.exePaths.filter(Boolean).map(lc)),
    knownDirs: new Set(known.installDirs.filter(Boolean).map(lc)),
    knownSource: new Set(known.sources),
    onProgress
  }
  const out: ScanCandidate[] = []
  const warnings: string[] = []
  const folders = opts.folders ?? settings.scanning.folders
  let scanned = 0
  for (const root of folders) {
    if (!fs.existsSync(root)) {
      warnings.push(`Folder not found: ${root}`)
      continue
    }
    scanned++
    // Yield between roots so IPC stays responsive on huge folders.
    await new Promise((r) => setImmediate(r))
    scanRoot(root, ctx, out, warnings)
  }
  if (opts.includeStores !== false) {
    if (settings.scanning.detectSteam) await scanSteam(ctx, out, warnings)
    if (settings.scanning.detectEpic) await scanEpic(ctx, out)
  }
  // De-duplicate (store entries win over raw folder hits for the same install dir).
  const byDir = new Map<string, ScanCandidate>()
  for (const c of out) {
    const k = lc(c.installDir)
    const prev = byDir.get(k)
    if (!prev || (prev.source === 'scan' && c.source !== 'scan')) byDir.set(k, c)
  }
  onProgress({ phase: 'done', current: '', found: byDir.size })
  return { candidates: [...byDir.values()], scannedFolders: scanned, warnings }
}
