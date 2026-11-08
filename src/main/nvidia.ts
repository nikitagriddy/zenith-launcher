// Per-game NVIDIA driver settings for one play session. Applied right before launch and removed when the game
// closes; anything left over after a crash is cleaned up on the next start. Game files and the game process are
// never touched.
//   - Power management and Texture filtering quality are options in NVIDIA Control Panel.
//   - The texture LOD bias ("clay textures") is not. It's a hidden driver setting that only tools like NVIDIA
//     Profile Inspector show, and some online games ban for it, so it stays off until the user opts in.
import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getMeta, setMeta } from './db'
import { log } from './log'
import type { LaunchPlan } from '@shared/types'

/** Power management mode (NVIDIA Control Panel). */
const POWER_MODE = '0x1057EB71'
/** Texture filtering - LOD Bias (DX). Driver units are 1/8 of a mip level. */
const LOD_BIAS_DX = '0x00738E8F'
/** Texture filtering - Negative LOD bias (1 = clamp, so the bias only ever goes towards blurrier). */
const NEGATIVE_LOD = '0x0019BB68'
/** Texture filtering - Quality (NVIDIA Control Panel). */
const TEX_QUALITY = '0x00CE2691'
/**
 * Antialiasing - Transparency Supersampling. In DirectX 10/11/12 games the driver only applies the LOD bias
 * above when this is set, so without it the bias does nothing.
 */
const TRANSPARENCY_SS = '0x10D48A85'
const PENDING_KEY = 'nv_pending'

/** Driver values for a session. A Map because Texture quality belongs to more than one group. */
function settingsFor(tweak: LaunchPlan['driverTweak'], lodBias: number | null): [string, number][] {
  const values = new Map<string, number>()
  if (tweak !== 'none') values.set(POWER_MODE, 1) // Prefer maximum performance
  if (tweak === 'potato') values.set(TEX_QUALITY, 20) // High performance
  if (lodBias !== null) {
    values.set(NEGATIVE_LOD, 1)
    values.set(LOD_BIAS_DX, lodBias)
    values.set(TEX_QUALITY, 20)
    values.set(TRANSPARENCY_SS, 8)
  }
  return [...values]
}

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

/** Set this session's driver options for one exe. Returns an undo function. */
export async function applyDriverSettings(exe: string, tweak: LaunchPlan['driverTweak'], lodBias: number | null): Promise<() => void> {
  const settings = settingsFor(tweak, lodBias)
  // One call: either every setting is saved or none is.
  const r = await runAsync(['apply', exe, ...settings.map(([id, v]) => `${id}=${v}`)])
  const pending: Pending = {
    exe,
    prev: settings.map(([id]) => `${id}=${r[`prev.${id}`] ?? 'none'}`),
    createdProfile: r.profile === 'zenith' && settings.every(([id]) => r[`prev.${id}`] === 'none')
  }
  writePending([...readPending().filter((x) => x.exe !== exe), pending])
  log.info(`NVIDIA settings on for ${exe} (${tweak}${lodBias === null ? '' : `, LOD bias ${lodBias / 8}`})`)
  let done = false
  return () => {
    if (done) return
    done = true
    void revert(pending, shuttingDown)
  }
}

/** On startup: undo anything a crash or power loss left behind. */
export async function recoverDriverSettings(): Promise<void> {
  for (const p of readPending()) {
    log.info('Restoring NVIDIA setting left over from last session for', p.exe)
    await revert(p, false)
  }
}
