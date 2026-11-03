// Executable discovery + ranking heuristics shared by the scanner and the playtime tracker.
import fs from 'node:fs'
import path from 'node:path'
import type { ExeOption } from '@shared/types'

/** Folders that never contain the main game executable. */
const SKIP_DIRS = new Set([
  '_commonredist', 'commonredist', 'redist', 'redists', 'redistributables', '_redist', 'directx', 'dotnet',
  'vcredist', '__installer', 'installer', 'installers', 'prereqs', 'prerequisites', 'support', 'crashreporter',
  'crashpad', 'node_modules', '.git', 'monobleedingedge', '$recycle.bin', 'system volume information',
  'logs', 'cache', 'shadercache', 'screenshots', 'saves', 'savegames', '__pycache__', 'backup', 'backups',
  'tools', 'sdk', 'docs', 'manual', 'soundtrack', 'ost', 'artbook', 'extras', 'easyanticheat', 'battleye',
  'eac', 'msvc', 'vc', 'physx', 'uplay', 'origin'
])

/** Executables that are never the game itself (installers, uninstallers, crash handlers, runtimes…). */
const HARD_SKIP =
  /^(unins\d*|uninst.*|uninstall.*|.*setup.*|.*installer.*|install|vc_?redist.*|dxsetup|dxwebsetup|directx.*|dotnet.*|ndp\d.*|.*crash(handler|reporter|pad|report|sender).*|unitycrashhandler(32|64)?|.*prereq.*|easyanticheat.*|be(service|_service|launcher).*|steamerrorreporter.*|cefsharp\..*|qtwebengineprocess|notification_helper|7za?|.*redist.*|oalinst|physx.*|vulkan-?rt.*|dowser|touchup|cleanup|activation(ui)?|unitycrash.*|ue[0-9]?prereq.*|.*_?bugreport.*|zfgamebrowser|gamebarpresencewriter|nvidia.*|amd.*|python[w]?|java[w]?|node)$/i

/** Executables that might be games but are usually helpers. */
const SOFT_PENALTY = /(config|settings|setup|tool|editor|server|dedicated|benchmark|test|debug|helper|update|patch|report|sdk|console|mod|crash|register|repair|webhelper|browser|overlay|service|agent)/i

export const SYSTEM_PROCESS_NAMES = new Set([
  'explorer.exe', 'cmd.exe', 'conhost.exe', 'powershell.exe', 'pwsh.exe', 'steam.exe', 'steamwebhelper.exe',
  'epicgameslauncher.exe', 'epicwebhelper.exe', 'node.exe', 'python.exe', 'pythonw.exe', 'java.exe',
  'rundll32.exe', 'dllhost.exe', 'svchost.exe', 'zenith.exe', 'electron.exe', 'msedge.exe', 'chrome.exe'
])

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function isSkippedExe(file: string): boolean {
  return HARD_SKIP.test(path.basename(file, path.extname(file)))
}

export interface FoundExe extends ExeOption {
  depth: number
}

/** Breadth-first walk collecting .exe files up to `maxDepth` levels below `dir`. */
export function walkExes(dir: string, maxDepth: number, limit = 400, extraSkip: string[] = []): FoundExe[] {
  const out: FoundExe[] = []
  const queue: { dir: string; depth: number }[] = [{ dir, depth: 0 }]
  const skipWords = extraSkip.map((w) => w.toLowerCase()).filter(Boolean)
  while (queue.length && out.length < limit) {
    const cur = queue.shift()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(cur.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      const full = path.join(cur.dir, e.name)
      const lower = e.name.toLowerCase()
      if (skipWords.some((w) => lower.includes(w))) continue
      if (e.isDirectory()) {
        if (cur.depth < maxDepth && !SKIP_DIRS.has(lower) && !lower.startsWith('.')) {
          queue.push({ dir: full, depth: cur.depth + 1 })
        }
      } else if (e.isFile() && lower.endsWith('.exe') && !isSkippedExe(e.name)) {
        let size = 0
        try {
          size = fs.statSync(full).size
        } catch {
          /* ignore */
        }
        out.push({ path: full, size, depth: cur.depth })
        if (out.length >= limit) break
      }
    }
  }
  return out
}

/** Score how likely an exe is to be the main game binary for a folder named `folderName`. */
export function scoreExe(exe: FoundExe, folderName: string): number {
  const base = path.basename(exe.path, '.exe')
  const n = normalize(base)
  const f = normalize(folderName)
  let score = 0
  if (n && f) {
    if (n === f) score += 60
    else if (n.length >= 3 && (f.includes(n) || n.includes(f))) score += 35
    else {
      const initials = folderName
        .split(/[\s_\-.]+/)
        .filter(Boolean)
        .map((w) => w[0]!.toLowerCase())
        .join('')
      if (initials.length >= 2 && n.startsWith(initials)) score += 20
    }
  }
  const mb = exe.size / (1024 * 1024)
  score += Math.min(30, Math.log2(mb + 1) * 5)
  score -= exe.depth * 8
  if (/shipping/i.test(base)) score += 6
  if (/(win64|x64|binaries)/i.test(exe.path)) score += 4
  if (/launcher/i.test(base)) score -= 12
  if (SOFT_PENALTY.test(base)) score -= 40
  if (/(32|x86)$/i.test(base)) score -= 6
  return score
}

export function rankExes(exes: FoundExe[], folderName: string): FoundExe[] {
  return [...exes].sort((a, b) => scoreExe(b, folderName) - scoreExe(a, folderName))
}

/** Turn a folder or file name into a nice display title. */
export function prettifyTitle(raw: string): string {
  let t = raw
    .replace(/\.exe$/i, '')
    .replace(/[[({].*?[\])}]/g, ' ')
    .replace(/[_.]+/g, ' ')
    .replace(/\b(v\d+(\.\d+)*[a-z]?|gog|steam|repack|portable|win(32|64)?|x64|x86|shipping)\b/gi, ' ')
    .replace(/-+(win64|shipping|win32)/gi, ' ')
    .replace(/([a-z])([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) t = raw
  return t.replace(/\b([a-z])/g, (m) => m.toUpperCase())
}

export function isDriveRoot(dir: string): boolean {
  const resolved = path.resolve(dir)
  return path.parse(resolved).root.toLowerCase() === (resolved.endsWith(path.sep) ? resolved : resolved + path.sep).toLowerCase()
}
