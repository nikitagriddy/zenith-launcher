// Temporary per-session system tweaks for launch modes. Every change returns an undo function.
import { execFile, execFileSync } from 'node:child_process'
import os from 'node:os'
import { getMeta, setMeta } from './db'
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

// ---------- crash safety: every change is recorded until it's undone ----------

interface Pending {
  gpu: { exe: string; previous: string | null }[]
  powerPlan: string | null
}
const PENDING_KEY = 'boost_pending'

function readPending(): Pending {
  try {
    return { gpu: [], powerPlan: null, ...(JSON.parse(getMeta(PENDING_KEY) ?? '{}') as Partial<Pending>) }
  } catch {
    return { gpu: [], powerPlan: null }
  }
}
function updatePending(fn: (p: Pending) => void): void {
  const p = readPending()
  fn(p)
  setMeta(PENDING_KEY, JSON.stringify(p))
}

function restoreGpu(exe: string, previous: string | null): void {
  try {
    if (previous === null) execFileSync('reg', ['delete', GPU_KEY, '/v', exe, '/f'], { windowsHide: true, stdio: 'ignore' })
    else execFileSync('reg', ['add', GPU_KEY, '/v', exe, '/t', 'REG_SZ', '/d', previous, '/f'], { windowsHide: true, stdio: 'ignore' })
  } catch (err) {
    log.warn('Could not restore GPU preference for', exe, (err as Error).message)
  }
  updatePending((p) => (p.gpu = p.gpu.filter((g) => g.exe !== exe)))
}

/** Windows Settings › Graphics › "High performance" for these executables, undone after the session. */
export function preferHighPerformanceGpu(exePaths: string[]): () => void {
  const undo: (() => void)[] = []
  for (const exe of new Set(exePaths.filter(Boolean))) {
    const previous = regGet(exe)
    if (previous?.includes('GpuPreference=2')) continue // the user already chose it themselves
    try {
      updatePending((p) => (p.gpu = [...p.gpu.filter((g) => g.exe !== exe), { exe, previous }]))
      execFileSync('reg', ['add', GPU_KEY, '/v', exe, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'], { windowsHide: true, stdio: 'ignore' })
      undo.push(() => restoreGpu(exe, previous))
    } catch (err) {
      log.warn('Could not set GPU preference for', exe, (err as Error).message)
      updatePending((p) => (p.gpu = p.gpu.filter((g) => g.exe !== exe)))
    }
  }
  return () => undo.forEach((u) => u())
}

/** On startup: undo GPU preferences and the power plan a crash left switched. */
export function recoverBoost(): void {
  const p = readPending()
  for (const g of p.gpu) {
    log.info('Restoring GPU preference left over from last session for', g.exe)
    restoreGpu(g.exe, g.previous)
  }
  if (p.powerPlan) {
    log.info('Restoring power plan left over from last session')
    try {
      execFileSync('powercfg', ['/setactive', p.powerPlan], { windowsHide: true, stdio: 'ignore' })
    } catch (err) {
      log.warn('Could not restore power plan', (err as Error).message)
    }
    updatePending((x) => (x.powerPlan = null))
  }
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
      updatePending((p) => (p.powerPlan = current))
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
      updatePending((p) => (p.powerPlan = null))
    }
  }
}

// ---------- CPU priority ----------

/**
 * Raise the priority of running processes with these image names. Uses tasklist + SetPriorityClass
 * directly (no PowerShell). Processes guarded by anti-cheat or running as admin may refuse; that's fine.
 */
export function raisePriority(imageNames: string[]): void {
  const names = new Set(imageNames.map((n) => n.toLowerCase()).filter(Boolean))
  if (!names.size) return
  try {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return log.warn('Could not list processes for priority boost', err.message)
      let raised = 0
      let refused = 0
      for (const line of stdout.split(/\r?\n/)) {
        const m = /^"([^"]+)","(\d+)"/.exec(line)
        if (!m || !names.has(m[1]!.toLowerCase())) continue
        try {
          if (os.getPriority(Number(m[2])) !== os.constants.priority.PRIORITY_HIGH) os.setPriority(Number(m[2]), os.constants.priority.PRIORITY_HIGH)
          raised++
        } catch {
          refused++
        }
      }
      if (refused) log.info(`Priority boost: ${raised} process(es) raised, ${refused} refused (anti-cheat or admin)`)
    })
  } catch (err) {
    log.warn('Could not start priority boost', (err as Error).message)
  }
}
