// Detects which engine a game is built on from its install folder, so launch modes can pass the
// engine's own command-line options. Detection only reads the folder; results are cached per folder.
import fs from 'node:fs'
import path from 'node:path'
import type { Game, GameEngine } from '@shared/types'
import { getMeta, setMeta } from './db'
import { walkExes } from './exe'

const LABELS: Record<GameEngine['id'], string> = {
  unreal: 'Unreal Engine',
  unity: 'Unity',
  source: 'Source',
  source2: 'Source 2',
  godot: 'Godot',
  unknown: 'Unknown engine'
}

const DAY_MS = 24 * 60 * 60 * 1000

const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}
const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}
const list = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/** Unity stamps its version (e.g. "2021.3.16f1") near the start of its data files. */
function unityVersion(dataDir: string): string | undefined {
  for (const f of ['globalgamemanagers', 'data.unity3d', 'mainData']) {
    const p = path.join(dataDir, f)
    if (!isFile(p)) continue
    try {
      const fd = fs.openSync(p, 'r')
      const buf = Buffer.alloc(4096)
      fs.readSync(fd, buf, 0, buf.length, 0)
      fs.closeSync(fd)
      const m = /\b(20\d{2}|[3-6])\.\d+\.\d+[abfpx]\d+\b/.exec(buf.toString('latin1'))
      if (m) return m[0]
    } catch {
      /* unreadable: version stays unknown */
    }
  }
  return undefined
}

/** Names each anti-cheat leaves in a game's install folder. */
const ANTI_CHEATS: [RegExp, string][] = [
  [/^easyanticheat|_eac(_eos)?\.exe$|^start_protected_game\.exe$/i, 'Easy Anti-Cheat'],
  [/^battleye$|^beservice|^beclient|_be\.exe$/i, 'BattlEye'],
  [/^eaanticheat/i, 'EA Anti-Cheat'],
  [/^pnkbstr/i, 'PunkBuster'],
  [/^gameguard/i, 'GameGuard'],
  [/^xigncode|^xhunter/i, 'XIGNCODE3']
]

/** Stores whose games always run under the publisher's own anti-cheat. */
const ANTI_CHEAT_BY_SOURCE: Partial<Record<Game['source'], string>> = { riot: 'Riot Vanguard', battlenet: 'Warden' }

/** Reads names only, five folder levels deep at most, and gives up on very large folders. */
function findAntiCheat(root: string): string | undefined {
  let level = [root]
  let visited = 0
  for (let depth = 0; depth < 5 && level.length; depth++) {
    const next: string[] = []
    for (const dir of level) {
      if (++visited > 3000) return undefined
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        const hit = ANTI_CHEATS.find(([re]) => re.test(e.name))
        if (hit) return hit[1]
        if (e.isDirectory()) next.push(path.join(dir, e.name))
      }
    }
    level = next
  }
  return undefined
}

function detect(root: string, exePath: string): GameEngine {
  const exeDir = exePath ? path.dirname(exePath) : root
  const exeBase = exePath ? path.basename(exePath, path.extname(exePath)) : ''
  const dirs = [...new Set([root, exeDir])]

  // Unreal: an Engine/ folder next to the game, or a "<Game>-Win64-Shipping.exe".
  const shipping = walkExes(root, 4, 300).find((e) => /-win64-shipping\.exe$/i.test(e.path))
  if (dirs.some((d) => isDir(path.join(d, 'Engine'))) || shipping) {
    return { id: 'unreal', label: LABELS.unreal, realExe: shipping?.path }
  }

  // Unity: UnityPlayer.dll and a "<Game>_Data" folder.
  for (const d of dirs) {
    const data = list(d).find((n) => /_Data$/i.test(n) && isDir(path.join(d, n)))
    if (isFile(path.join(d, 'UnityPlayer.dll')) || (data && isFile(path.join(d, data, 'globalgamemanagers')))) {
      const version = data ? unityVersion(path.join(d, data)) : undefined
      return { id: 'unity', label: version ? `Unity ${version.replace(/[abfpx]\d+$/, '')}` : LABELS.unity, version }
    }
  }

  // Source 2 (Counter-Strike 2, Dota 2…) and classic Source.
  if (isFile(path.join(root, 'game', 'bin', 'win64', 'engine2.dll')) || /engine2\.dll/i.test(list(exeDir).join(' '))) {
    return { id: 'source2', label: LABELS.source2 }
  }
  if (dirs.some((d) => isFile(path.join(d, 'bin', 'engine.dll')) || isFile(path.join(d, 'hl2.exe')))) {
    return { id: 'source', label: LABELS.source }
  }

  // Godot: "<Game>.pck" next to "<Game>.exe".
  if (exeBase && isFile(path.join(exeDir, `${exeBase}.pck`))) return { id: 'godot', label: LABELS.godot }

  return { id: 'unknown', label: LABELS.unknown }
}

export function detectEngine(game: Game): GameEngine {
  const root = game.installDir || (game.exePath ? path.dirname(game.exePath) : '')
  const bySource = ANTI_CHEAT_BY_SOURCE[game.source]
  if (!root || !isDir(root)) return { id: 'unknown', label: LABELS.unknown, antiCheat: bySource }
  const key = `engine2:${game.id}`
  try {
    const cached = JSON.parse(getMeta(key) ?? 'null') as (GameEngine & { root: string; exe: string; at: number }) | null
    // Checked again every day, because a game update can add an anti-cheat.
    if (cached && cached.root === root && cached.exe === game.exePath && Date.now() - cached.at < DAY_MS) {
      const { root: _r, exe: _e, at: _a, ...engine } = cached
      return engine
    }
  } catch {
    /* re-detect */
  }
  // A game added by hand may only know an exe inside <Game>/<Project>/Binaries; anti-cheat folders can sit up at <Game>.
  const top = /^(.*?)[\\/][^\\/]+[\\/]Binaries[\\/]/i.exec(root + path.sep)?.[1] ?? root
  const engine: GameEngine = { ...detect(root, game.exePath), antiCheat: bySource ?? findAntiCheat(top) }
  setMeta(key, JSON.stringify({ ...engine, root, exe: game.exePath, at: Date.now() }))
  return engine
}
