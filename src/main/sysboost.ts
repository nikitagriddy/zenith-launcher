// Temporary per-session system tweaks for launch modes. Every change returns an undo function.
import { execFile, execFileSync } from 'node:child_process'
import { log } from './log'

const GPU_KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
const HIGH_PERFORMANCE_PLAN = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'

function regGet(name: string): string | null {
  try {
    const out = execFileSync('reg', ['query', GPU_KEY, '/v', name], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    const line = out.split(/\r?\n/).find((l) => l.includes('REG_SZ'))
    return line ? line.split('REG_SZ')[1]!.trim() : null
  } catch {
    return null
  }
}

/** Windows Settings › Graphics › "High performance" for these executables, undone after the session. */
export function preferHighPerformanceGpu(exePaths: string[]): () => void {
  const undo: (() => void)[] = []
  for (const exe of new Set(exePaths.filter(Boolean))) {
    const previous = regGet(exe)
    if (previous?.includes('GpuPreference=2')) continue // the user already chose it themselves
    try {
      execFileSync('reg', ['add', GPU_KEY, '/v', exe, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'], { windowsHide: true, stdio: 'ignore' })
      undo.push(() => {
        try {
          if (previous === null) execFileSync('reg', ['delete', GPU_KEY, '/v', exe, '/f'], { windowsHide: true, stdio: 'ignore' })
          else execFileSync('reg', ['add', GPU_KEY, '/v', exe, '/t', 'REG_SZ', '/d', previous, '/f'], { windowsHide: true, stdio: 'ignore' })
        } catch (err) {
          log.warn('Could not restore GPU preference for', exe, (err as Error).message)
        }
      })
    } catch (err) {
      log.warn('Could not set GPU preference for', exe, (err as Error).message)
    }
  }
  return () => undo.forEach((u) => u())
}

// ---------- power plan (shared by all boosted sessions) ----------

let powerUsers = 0
let previousPlan: string | null = null

function activePlan(): string | null {
  try {
    const out = execFileSync('powercfg', ['/getactivescheme'], { windowsHide: true }).toString()
    return /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(out)?.[1] ?? null
  } catch {
    return null
  }
}

/** Switch to the High performance plan for the session; returns undo, or null if the plan isn't available. */
export function useHighPerformancePlan(): (() => void) | null {
  if (powerUsers === 0) {
    const current = activePlan()
    if (!current) return null
    if (current.toLowerCase() !== HIGH_PERFORMANCE_PLAN) {
      try {
        execFileSync('powercfg', ['/setactive', HIGH_PERFORMANCE_PLAN], { windowsHide: true, stdio: 'ignore' })
      } catch {
        log.info('High performance power plan is not available on this PC')
        return null
      }
      previousPlan = current
    } else previousPlan = null
  }
  powerUsers++
  let released = false
  return () => {
    if (released) return
    released = true
    powerUsers = Math.max(0, powerUsers - 1)
    if (powerUsers === 0 && previousPlan) {
      try {
        execFileSync('powercfg', ['/setactive', previousPlan], { windowsHide: true, stdio: 'ignore' })
      } catch (err) {
        log.warn('Could not restore power plan', (err as Error).message)
      }
      previousPlan = null
    }
  }
}

// ---------- CPU priority ----------

/** Raise the priority of running processes with these image names (elevated/protected ones are skipped). */
export function raisePriority(imageNames: string[]): void {
  const names = [...new Set(imageNames.map((n) => n.toLowerCase().replace(/\.exe$/, '')))].filter(Boolean)
  if (!names.length) return
  const list = names.map((n) => `'${n.replace(/'/g, "''")}'`).join(',')
  const script = `$n=@(${list}); Get-Process | Where-Object { $n -contains $_.ProcessName.ToLower() } | ForEach-Object { try { if ($_.PriorityClass -ne 'High') { $_.PriorityClass = 'High' } } catch {} }`
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15_000 },
    (err) => err && log.warn('Could not raise game priority', err.message)
  )
}
