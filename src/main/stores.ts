// Detection for launchers that don't keep simple manifests: GOG Galaxy, EA app, Ubisoft Connect, Battle.net, Riot.
// Everything comes from the Windows registry (one PowerShell call), so it's fast and works offline.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { GameSource, ScanCandidate, Settings } from '@shared/types'
import { rankExes, walkExes } from './exe'
import { log } from './log'

export interface UninstallEntry {
  key: string
  name: string
  publisher: string
  installLocation: string
  uninstallString: string
  displayIcon: string
  sizeKb: number
}

interface RegistryDump {
  uninstall: UninstallEntry[]
  gog: { id: string; name: string; path: string; exe: string; launchParam: string; workingDir: string }[]
  ubisoft: { id: string; installDir: string }[]
}

const SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$u = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' |
  Where-Object { $_.DisplayName } |
  ForEach-Object { [pscustomobject]@{ key = [string]$_.PSChildName; name = [string]$_.DisplayName; publisher = [string]$_.Publisher; installLocation = [string]$_.InstallLocation; uninstallString = [string]$_.UninstallString; displayIcon = [string]$_.DisplayIcon; sizeKb = [int64]$_.EstimatedSize } }
$g = Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\*' |
  ForEach-Object { [pscustomobject]@{ id = [string]$_.gameID; name = [string]$_.gameName; path = [string]$_.path; exe = [string]$_.exe; launchParam = [string]$_.launchParam; workingDir = [string]$_.workingDir } }
$b = Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\*' |
  ForEach-Object { [pscustomobject]@{ id = [string]$_.PSChildName; installDir = [string]$_.InstallDir } }
[pscustomobject]@{ uninstall = @($u); gog = @($g); ubisoft = @($b) } | ConvertTo-Json -Depth 4 -Compress
`

let cache: { at: number; data: RegistryDump } | null = null

export function readRegistry(maxAgeMs = 60_000): Promise<RegistryDump> {
  if (cache && Date.now() - cache.at < maxAgeMs) return Promise.resolve(cache.data)
  const empty: RegistryDump = { uninstall: [], gog: [], ubisoft: [] }
  return readOnce().then(async (data) => {
    // PowerShell occasionally exits cleanly without printing anything; one retry fixes it.
    const result = data ?? (await readOnce()) ?? empty
    if (data === null && result !== empty) log.info('Registry read succeeded on retry')
    // Only cache real answers, so a bad read never hides installed games for the next minute.
    if (result.uninstall.length) cache = { at: Date.now(), data: result }
    return result
  })
}

function readOnce(): Promise<RegistryDump | null> {
  return new Promise((resolve) => {
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 30_000 },
      (err, stdout) => {
        if (err) {
          log.warn('Registry read failed', err.message)
          return resolve(null)
        }
        if (!stdout.trim()) {
          log.warn('Registry read returned no output')
          return resolve(null)
        }
        try {
          const raw = JSON.parse(stdout.trim())
          const arr = <T>(v: T | T[] | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : [])
          resolve({ uninstall: arr(raw.uninstall), gog: arr(raw.gog), ubisoft: arr(raw.ubisoft) })
        } catch (e) {
          log.warn('Registry output unreadable', (e as Error).message)
          resolve(null)
        }
      }
    )
  })
}

const clean = (p: string) => p.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '').replace(/\//g, '\\')
const exists = (p: string) => !!p && fs.existsSync(p)

function exeCandidates(dir: string, folderName: string, preferLauncher = false) {
  const ranked = rankExes(walkExes(dir, 4, 200), folderName)
  if (preferLauncher) {
    // Blizzard games must start through Battle.net; their "<Game> Launcher.exe" hands off to it.
    const launcher = ranked.find((e) => /launcher\.exe$/i.test(e.path) && path.dirname(e.path).toLowerCase() === dir.toLowerCase())
    if (launcher) return [launcher, ...ranked.filter((e) => e !== launcher)]
  }
  return ranked
}

function candidate(
  source: GameSource,
  sourceId: string,
  title: string,
  installDir: string,
  extra: Partial<ScanCandidate> & { preferLauncher?: boolean } = {}
): ScanCandidate | null {
  if (!exists(installDir)) return null
  const ranked = extra.exePath ? [] : exeCandidates(installDir, path.basename(installDir), extra.preferLauncher)
  const exePath = extra.exePath ?? ranked[0]?.path ?? ''
  if (!exePath && !extra.launchUri) return null
  return {
    key: `${source}:${sourceId}`,
    title: title.replace(/[™®]/g, '').trim(),
    exePath,
    installDir,
    source,
    sourceId,
    launchUri: extra.launchUri ?? '',
    launchArgs: extra.launchArgs ?? '',
    alternatives: ranked.slice(0, 8).map((e) => ({ path: e.path, size: e.size })),
    coverFile: '',
    heroFile: ''
  }
}

/** Steam/Epic games also register uninstall entries; never claim those for another store. */
function ownedByOtherStore(e: UninstallEntry): boolean {
  const loc = e.installLocation.toLowerCase()
  return /^steam app \d+/i.test(e.key) || loc.includes('\\steamapps\\') || loc.includes('/steamapps/') || /epic games\\/i.test(loc)
}

export async function scanStores(
  settings: Settings['scanning'],
  isKnown: (source: string, sourceId: string) => boolean,
  onProgress: (store: string) => void
): Promise<ScanCandidate[]> {
  const want = settings.detectGog || settings.detectEa || settings.detectUbisoft || settings.detectBattlenet || settings.detectRiot
  if (!want) return []
  const reg = await readRegistry(0)
  const out: ScanCandidate[] = []
  const push = (c: ScanCandidate | null) => c && !isKnown(c.source, c.sourceId) && out.push(c)

  if (settings.detectGog) {
    onProgress('GOG Galaxy')
    for (const g of reg.gog) {
      if (!g.id || !g.name) continue
      const dir = clean(g.path)
      const exe = clean(g.exe)
      push(candidate('gog', g.id, g.name, dir, exists(exe) ? { exePath: exe, launchArgs: g.launchParam ?? '' } : {}))
    }
  }

  if (settings.detectUbisoft) {
    onProgress('Ubisoft Connect')
    const names = new Map(reg.uninstall.filter((e) => /^uplay install \d+$/i.test(e.key)).map((e) => [e.key.split(' ').pop()!, e.name]))
    for (const u of reg.ubisoft) {
      const dir = clean(u.installDir)
      const name = names.get(u.id) ?? path.basename(dir)
      push(candidate('ubisoft', u.id, name, dir, { launchUri: `uplay://launch/${u.id}/0` }))
    }
  }

  for (const e of reg.uninstall) {
    if (ownedByOtherStore(e)) continue
    const dir = clean(e.installLocation)

    // Riot: "RiotClientServices.exe --uninstall-product=valorant --uninstall-patchline=live"
    const riot = /^"?(.*?riotclientservices\.exe)"?\s.*--uninstall-product=([\w-]+)\s+--uninstall-patchline=([\w-]+)/i.exec(e.uninstallString)
    if (riot) {
      if (!settings.detectRiot || /^riot[_ ]client$/i.test(riot[2]!)) continue
      onProgress('Riot Games')
      const client = riot[1]!
      push(
        candidate('riot', riot[2]!, e.name, dir, {
          exePath: exists(client) ? client : undefined,
          launchArgs: `--launch-product=${riot[2]} --launch-patchline=${riot[3]}`
        })
      )
      continue
    }

    if (settings.detectBattlenet && /blizzard/i.test(e.publisher) && !/^battle\.net$/i.test(e.name) && /blizzard uninstaller/i.test(e.uninstallString)) {
      onProgress('Battle.net')
      const uid = /--uid=([\w-]+)/i.exec(e.uninstallString)?.[1] ?? e.key
      push(candidate('battlenet', uid, e.name, dir, { preferLauncher: true }))
      continue
    }

    if (
      settings.detectEa &&
      /electronic arts|^ea\b|ea swiss|respawn|criterion/i.test(e.publisher) &&
      !/^(ea app|ea desktop|origin|ea installer)/i.test(e.name)
    ) {
      onProgress('EA app')
      push(candidate('ea', e.key, e.name, dir))
    }
  }
  return out
}

/** Find this game's Windows uninstall entry (by install folder, then by name). */
export async function findUninstallEntry(installDir: string, title: string): Promise<UninstallEntry | null> {
  const reg = await readRegistry()
  const dir = installDir ? clean(installDir).toLowerCase() : ''
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const withCmd = reg.uninstall.filter((e) => e.uninstallString)
  const loc = (e: UninstallEntry) => (e.installLocation ? clean(e.installLocation).toLowerCase() : '')
  // Same title is only trusted when the folders agree, so a manually added copy never triggers the
  // uninstaller of a different install with the same name (entries without a folder are skipped).
  const related = (e: UninstallEntry) => !!dir && !!loc(e) && (dir.startsWith(loc(e) + '\\') || loc(e).startsWith(dir + '\\'))
  return (
    (dir && withCmd.find((e) => loc(e) === dir)) ||
    withCmd.find((e) => norm(e.name) === norm(title) && related(e)) ||
    null
  )
}
