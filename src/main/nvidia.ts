// "Clay textures" for Potato mode on NVIDIA cards: a positive texture LOD bias set in the NVIDIA driver's
// profile for the game, the same per-game store NVIDIA Control Panel writes to. Game files and the game
// process are never touched. Applied right before launch and removed when the game closes; anything left
// over after a crash is cleaned up on the next start.
import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getMeta, setMeta } from './db'
import { log } from './log'

/** Texture filtering - LOD Bias (DX). Driver units are 1/8 of a mip level. */
const LOD_BIAS_DX = '0x00738E8F'
/** Texture filtering - Driver controlled LOD bias: off, so the value above is used as-is. */
const DRIVER_CONTROLLED_LOD = '0x00638E8F'
const PENDING_KEY = 'nv_pending'

export const CLAY_LEVELS = { smooth: 10, clay: 20, extreme: 69 } as const

interface Pending {
  exe: string
  prev: string[]
  createdProfile: boolean
}

function script(): string {
  const p = path.join(app.getAppPath(), 'resources', 'nvdrs.ps1')
  if (!app.isPackaged) return p
  // Packaged: the script lives inside app.asar; PowerShell needs a real file, so copy it out once.
  const out = path.join(app.getPath('userData'), 'nvdrs.ps1')
  const src = fs.readFileSync(p)
  if (!fs.existsSync(out) || !fs.readFileSync(out).equals(src)) fs.writeFileSync(out, src)
  return out
}

function parse(stdout: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of stdout.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

function runAsync(args: string[]): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    try {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script(), ...args], { windowsHide: true, timeout: 30_000 }, (err, stdout) => {
        const r = parse(stdout ?? '')
        if (r.error) return reject(new Error(r.error))
        if (err) return reject(err)
        resolve(r)
      })
    } catch (err) {
      reject(err as Error)
    }
  })
}

function runSync(args: string[]): Record<string, string> {
  try {
    return parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script(), ...args], { windowsHide: true, timeout: 30_000 }).toString())
  } catch (err) {
    const out = (err as { stdout?: Buffer }).stdout?.toString() ?? ''
    return { error: parse(out).error ?? (err as Error).message }
  }
}

let nvidia: boolean | null = null

/** True when an NVIDIA driver with its settings API is present. Cached after the first check. */
export async function hasNvidiaDriver(): Promise<boolean> {
  if (nvidia !== null) return nvidia
  if (!fs.existsSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvapi64.dll'))) return (nvidia = false)
  try {
    nvidia = (await runAsync(['probe'])).ok === '1'
  } catch (err) {
    log.info('NVIDIA driver settings unavailable:', (err as Error).message)
    nvidia = false
  }
  return nvidia
}

export function nvidiaKnown(): boolean | null {
  return nvidia
}

function readPending(): Pending[] {
  try {
    return JSON.parse(getMeta(PENDING_KEY) ?? '[]') as Pending[]
  } catch {
    return []
  }
}
function writePending(list: Pending[]): void {
  setMeta(PENDING_KEY, JSON.stringify(list))
}

let shuttingDown = false
export function nvidiaShuttingDown(): void {
  shuttingDown = true
}

function revert(p: Pending, sync: boolean): Promise<void> | void {
  const finish = (r: Record<string, string>) => {
    if (r.error) log.warn('Could not restore NVIDIA setting for', p.exe, r.error)
    writePending(readPending().filter((x) => x.exe !== p.exe))
  }
  const steps = [['revert', p.exe, ...p.prev], ...(p.createdProfile ? [['dropprofile', p.exe]] : [])]
  if (sync) {
    let last: Record<string, string> = {}
    for (const s of steps) last = runSync(s)
    return finish(last)
  }
  return steps
    .reduce<Promise<Record<string, string>>>((acc, s) => acc.then(() => runAsync(s)), Promise.resolve({}))
    .then(finish, (err) => finish({ error: (err as Error).message }))
}

/** Set clay textures for one exe. Returns an undo function. */
export async function applyClayTextures(exe: string, value: number): Promise<() => void> {
  const r = await runAsync(['apply', exe, `${LOD_BIAS_DX}=${value}`, `${DRIVER_CONTROLLED_LOD}=0`])
  const pending: Pending = {
    exe,
    prev: [LOD_BIAS_DX, DRIVER_CONTROLLED_LOD].map((id) => `${id}=${r[`prev.${id}`] ?? 'none'}`),
    createdProfile: r.profile === 'zenith' && r[`prev.${LOD_BIAS_DX}`] === 'none' && r[`prev.${DRIVER_CONTROLLED_LOD}`] === 'none'
  }
  writePending([...readPending().filter((x) => x.exe !== exe), pending])
  log.info(`NVIDIA clay textures on for ${exe} (LOD bias ${value / 8})`)
  let done = false
  return () => {
    if (done) return
    done = true
    void revert(pending, shuttingDown)
  }
}

/** On startup: undo anything a crash or power loss left behind. */
export async function recoverClayTextures(): Promise<void> {
  for (const p of readPending()) {
    log.info('Restoring NVIDIA setting left over from last session for', p.exe)
    await revert(p, false)
  }
}
