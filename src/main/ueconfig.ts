// Potato for Unreal Engine games through the game's own graphics settings file (GameUserSettings.ini in
// %LOCALAPPDATA%\<Project>\Saved\Config\...). That's the file the game's Graphics menu saves, so the values
// Zenith writes are ones the menu itself can set. Only the touched lines are changed, and exactly those lines
// are put back when the game closes; anything else the game saved in the meantime is kept.
import fs from 'node:fs'
import path from 'node:path'
import { getMeta, setMeta } from './db'
import { log } from './log'

const PENDING_KEY = 'ueconfig_pending'
const SCALABILITY = ['ViewDistance', 'AntiAliasing', 'Shadow', 'GlobalIllumination', 'Reflection', 'PostProcess', 'Texture', 'Effects', 'Foliage', 'Shading', 'Landscape']

import type { IniEdit } from '@shared/types'
export type { IniEdit }
interface Original extends IniEdit {
  /** null = the line didn't exist before. */
  previous: string | null
}
interface Pending {
  file: string
  originals: Original[]
}

/** <Project> from ".../<Project>/Binaries/Win64/<Project>-Win64-Shipping.exe". */
export function projectOf(realExe: string): string | null {
  const parts = path.normalize(realExe).split(path.sep)
  const bin = parts.findIndex((p, i) => p.toLowerCase() === 'binaries' && i > 0)
  return bin > 0 ? parts[bin - 1]! : null
}

/** The game's GameUserSettings.ini, if it has run at least once on this PC. */
export function findUserSettings(realExe: string | undefined): string | null {
  if (!realExe) return null
  const project = projectOf(realExe)
  const local = process.env.LOCALAPPDATA
  if (!project || !local) return null
  const base = path.join(local, project, 'Saved', 'Config')
  const found = ['WindowsClient', 'Windows', 'WindowsNoEditor']
    .map((d) => path.join(base, d, 'GameUserSettings.ini'))
    .filter((p) => fs.existsSync(p))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return found[0] ?? null
}

// ---------- minimal line-preserving INI editing ----------

function split(text: string): string[] {
  return text.split(/\r?\n/)
}

function sectionRange(lines: string[], section: string): [number, number] | null {
  const start = lines.findIndex((l) => l.trim() === `[${section}]`)
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length && !/^\s*\[.*\]\s*$/.test(lines[end]!)) end++
  return [start, end]
}

function readValue(lines: string[], section: string, key: string): string | null {
  const r = sectionRange(lines, section)
  if (!r) return null
  for (let i = r[0] + 1; i < r[1]; i++) {
    const m = /^([^=;]+)=(.*)$/.exec(lines[i]!)
    if (m && m[1]!.trim() === key) return m[2]!
  }
  return null
}

/** Set (value) or remove (null) a key, keeping every other line exactly as it was. */
function writeValue(lines: string[], section: string, key: string, value: string | null): void {
  let r = sectionRange(lines, section)
  if (!r) {
    if (value === null) return
    if (lines.length && lines[lines.length - 1] !== '') lines.push('')
    lines.push(`[${section}]`)
    r = [lines.length - 1, lines.length]
  }
  for (let i = r[0] + 1; i < r[1]; i++) {
    const m = /^([^=;]+)=/.exec(lines[i]!)
    if (m && m[1]!.trim() === key) {
      if (value === null) lines.splice(i, 1)
      else lines[i] = `${key}=${value}`
      return
    }
  }
  if (value === null) return
  // Insert after the section's last non-empty line.
  let at = r[1]
  while (at > r[0] + 1 && lines[at - 1]!.trim() === '') at--
  lines.splice(at, 0, `${key}=${value}`)
}

/** Section that holds the resolution / window settings (its name differs per game). */
function settingsSection(lines: string[]): string | null {
  let current: string | null = null
  for (const l of lines) {
    const h = /^\s*\[(.+)\]\s*$/.exec(l)
    if (h) current = h[1]!
    else if (current && /^ResolutionSizeX=/.test(l)) return current
  }
  return null
}

/** The potato edits for one settings file. Only keys the game already uses are touched (plus sg.*). */
export function potatoEdits(file: string, opts: { renderScale: number; resolution: [number, number] | null; fortnite: boolean }): IniEdit[] {
  const lines = split(fs.readFileSync(file, 'utf8'))
  const edits: IniEdit[] = [{ section: 'ScalabilityGroups', key: 'sg.ResolutionQuality', value: String(opts.renderScale) }]
  for (const q of SCALABILITY) {
    const key = `sg.${q}Quality`
    if (q === 'Landscape' && readValue(lines, 'ScalabilityGroups', key) === null) continue
    edits.push({ section: 'ScalabilityGroups', key, value: '0' })
  }
  const sec = settingsSection(lines)
  if (sec) {
    const has = (k: string) => readValue(lines, sec, k) !== null
    const set = (k: string, v: string) => has(k) && edits.push({ section: sec, key: k, value: v })
    if (opts.resolution) {
      const [w, h] = opts.resolution.map(String) as [string, string]
      for (const [k, v] of [
        ['ResolutionSizeX', w], ['ResolutionSizeY', h], ['LastUserConfirmedResolutionSizeX', w], ['LastUserConfirmedResolutionSizeY', h],
        ['DesiredScreenWidth', w], ['DesiredScreenHeight', h], ['LastUserConfirmedDesiredScreenWidth', w], ['LastUserConfirmedDesiredScreenHeight', h],
        // A lower resolution only takes effect in real fullscreen (borderless always uses the desktop size).
        ['FullscreenMode', '0'], ['PreferredFullscreenMode', '0'], ['LastConfirmedFullscreenMode', '0']
      ] as const) set(k, v)
    }
    for (const k of ['bMotionBlur', 'bShowGrass', 'bUseNanite', 'bEnableDLSSFrameGeneration']) set(k, 'False')
    // Some games (Fortnite) keep their own 3D resolution lines and rebuild sg.ResolutionQuality from them at
    // startup, and dynamic resolution would scale it back up. Set those too, in the game's own number format.
    const r = sectionRange(lines, sec)!
    for (let i = r[0] + 1; i < r[1]; i++) {
      const m = /^([A-Za-z]*ResolutionQuality)=(-?\d+(?:\.(\d+))?)\s*$/.exec(lines[i]!)
      if (m) edits.push({ section: sec, key: m[1]!, value: m[3] ? opts.renderScale.toFixed(m[3].length) : String(opts.renderScale) })
    }
    set('bUseDynamicResolution', 'False')
  }
  if (opts.fortnite) {
    // Fortnite's "Performance" rendering mode (a choice in its own Graphics menu).
    edits.push({ section: 'D3DRHIPreference', key: 'PreferredFeatureLevel', value: 'es31' })
  }
  return edits
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

function restore(p: Pending): void {
  try {
    const text = fs.readFileSync(p.file, 'utf8')
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const lines = split(text)
    for (const o of p.originals) {
      // Only put a line back if it still has the value Zenith wrote; otherwise the player changed it in-game.
      if (readValue(lines, o.section, o.key) === o.value) writeValue(lines, o.section, o.key, o.previous)
    }
    fs.writeFileSync(p.file, lines.join(eol))
    log.info('Restored game settings in', p.file)
  } catch (err) {
    log.warn('Could not restore game settings', p.file, (err as Error).message)
  }
  writePending(readPending().filter((x) => x.file !== p.file))
}

/** Apply edits to a settings file; returns an undo function. */
export function applyIniEdits(file: string, edits: IniEdit[]): () => void {
  const text = fs.readFileSync(file, 'utf8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = split(text)
  const originals: Original[] = edits.map((e) => ({ ...e, previous: readValue(lines, e.section, e.key) }))
  // Write the pending record first, so a crash mid-way can still be undone.
  writePending([...readPending().filter((x) => x.file !== file), { file, originals }])
  for (const e of edits) writeValue(lines, e.section, e.key, e.value)
  fs.writeFileSync(file, lines.join(eol))
  log.info(`Potato settings written to ${file} (${edits.length} values)`)
  let done = false
  return () => {
    if (done) return
    done = true
    restore({ file, originals })
  }
}

/** On startup: put back settings a crash left behind. */
export function recoverIniEdits(): void {
  for (const p of readPending()) {
    log.info('Restoring game settings left over from last session:', p.file)
    restore(p)
  }
}
