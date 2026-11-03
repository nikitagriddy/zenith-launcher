import { shell } from 'electron'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type { Game, RunningInfo } from '@shared/types'
import { SYSTEM_PROCESS_NAMES, isDriveRoot, walkExes } from './exe'
import { log } from './log'

interface RunState {
  gameId: string
  title: string
  startedAt: number
  launchedAt: number
  tracking: 'process' | 'waiting'
  exeNames: Set<string>
  timer: NodeJS.Timeout | null
  child: ChildProcess | null
  /** Give up waiting for a process to appear after this timestamp. */
  waitUntil: number
  finished: boolean
}

export interface LauncherEvents {
  changed: []
  started: [game: { id: string; title: string }]
  ended: [info: { gameId: string; title: string; startedAt: number; endedAt: number; tracked: boolean }]
  error: [info: { gameId: string; title: string; message: string }]
}

/** Split a command-line string into arguments, honouring double quotes. */
export function parseArgs(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  let has = false
  for (const ch of input.trim()) {
    if (ch === '"') {
      quoted = !quoted
      has = true
    } else if (/\s/.test(ch) && !quoted) {
      if (has || cur) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += ch
      has = true
    }
  }
  if (has || cur) out.push(cur)
  return out
}

/** Names of all running processes (lower-cased image names). Works for elevated processes too. */
function runningImageNames(): Promise<Set<string>> {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      const names = new Set<string>()
      if (!err) {
        for (const line of stdout.split(/\r?\n/)) {
          const m = /^"([^"]+)"/.exec(line)
          if (m) names.add(m[1]!.toLowerCase())
        }
      }
      resolve(names)
    })
  })
}

function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

export class GameLauncher extends EventEmitter<LauncherEvents> {
  private running = new Map<string, RunState>()

  list(): RunningInfo[] {
    return [...this.running.values()].map((s) => ({ gameId: s.gameId, startedAt: s.startedAt, tracking: s.tracking }))
  }

  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  /** Executable names that count as "the game is running": the exe itself plus every exe in its install folder. */
  private exeNamesFor(game: Game): Set<string> {
    const names = new Set<string>()
    if (game.exePath) names.add(path.basename(game.exePath).toLowerCase())
    const dir = game.installDir || (game.exePath ? path.dirname(game.exePath) : '')
    if (dir && fs.existsSync(dir) && !isDriveRoot(dir)) {
      const found = walkExes(dir, 4, 301)
      // A huge folder (e.g. someone pointed at Program Files) would cause false positives.
      if (found.length <= 300) for (const e of found) names.add(path.basename(e.path).toLowerCase())
    }
    for (const n of SYSTEM_PROCESS_NAMES) names.delete(n)
    return names
  }

  async launch(game: Game): Promise<void> {
    if (this.running.has(game.id)) throw new Error(`${game.title} is already running.`)

    const exeOk = !!game.exePath && fs.existsSync(game.exePath)
    const useUri = !!game.launchUri && (!exeOk || game.source === 'steam' || game.source === 'epic')
    if (!useUri && !game.exePath) throw new Error('No executable set for this game. Edit the game and choose its .exe file.')
    if (!useUri && !exeOk) throw new Error(`Executable not found:\n${game.exePath}\nThe game may have been moved or uninstalled.`)

    const now = Date.now()
    const state: RunState = {
      gameId: game.id,
      title: game.title,
      startedAt: now,
      launchedAt: now,
      tracking: 'process',
      exeNames: this.exeNamesFor(game),
      timer: null,
      child: null,
      waitUntil: 0,
      finished: false
    }

    if (useUri) {
      await shell.openExternal(game.launchUri)
      this.beginWaiting(state, 180_000)
    } else {
      const cwd = game.workingDir && fs.existsSync(game.workingDir) ? game.workingDir : path.dirname(game.exePath)
      const args = parseArgs(game.launchArgs)
      const ext = path.extname(game.exePath).toLowerCase()
      if (game.runAsAdmin) {
        this.spawnElevated(state, game.exePath, game.launchArgs, cwd)
      } else if (ext === '.exe') {
        try {
          await this.spawnDirect(state, game.exePath, args, cwd)
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          // ERROR_ELEVATION_REQUIRED surfaces as EACCES / UNKNOWN: retry through UAC.
          if (code === 'EACCES' || code === 'UNKNOWN' || code === 'EPERM') {
            log.info('Elevation required, retrying as administrator:', game.exePath)
            this.spawnElevated(state, game.exePath, game.launchArgs, cwd)
          } else {
            throw new Error(`Could not start ${game.title}: ${(err as Error).message}`)
          }
        }
      } else if (ext === '.bat' || ext === '.cmd') {
        await this.spawnDirect(state, `"${game.exePath}"`, args.map((a) => (/\s/.test(a) ? `"${a}"` : a)), cwd, true)
      } else {
        // .lnk, .url and anything else: let Windows decide how to open it.
        const err = await shell.openPath(game.exePath)
        if (err) throw new Error(`Could not open ${game.exePath}: ${err}`)
        this.beginWaiting(state, 120_000)
      }
    }

    this.running.set(game.id, state)
    this.emit('started', { id: game.id, title: game.title })
    this.emit('changed')
  }

  private spawnDirect(state: RunState, file: string, args: string[], cwd: string, useShell = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false, shell: useShell })
      let spawned = false
      child.once('spawn', () => {
        spawned = true
        state.child = child
        child.unref()
        resolve()
      })
      child.once('error', (err) => {
        if (!spawned) reject(err)
        else log.error('Game process error', err)
      })
      child.once('exit', () => {
        if (!spawned) return
        state.child = null
        void this.afterExit(state)
      })
    })
  }

  private spawnElevated(state: RunState, exe: string, args: string, cwd: string): void {
    const script = [
      '$ErrorActionPreference = "Stop"',
      `$p = Start-Process -FilePath ${psQuote(exe)} -WorkingDirectory ${psQuote(cwd)}${args.trim() ? ` -ArgumentList ${psQuote(args)}` : ''} -Verb RunAs -PassThru`,
      'if ($p) { $p.WaitForExit() }'
    ].join('; ')
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr?.on('data', (d) => (stderr += String(d)))
    state.child = child
    child.once('error', (err) => {
      this.emit('error', { gameId: state.gameId, title: state.title, message: `Could not request administrator rights: ${err.message}` })
      this.finish(state, false)
    })
    child.once('exit', (code) => {
      state.child = null
      if (code !== 0) {
        const cancelled = /cancel/i.test(stderr)
        this.emit('error', {
          gameId: state.gameId,
          title: state.title,
          message: cancelled ? 'Administrator permission was declined.' : `Launch as administrator failed. ${stderr.split('\n')[0] ?? ''}`.trim()
        })
        this.finish(state, false)
        return
      }
      void this.afterExit(state)
    })
  }

  /** The process we started exited. Keep tracking if the game lives on in another process (launcher stubs). */
  private async afterExit(state: RunState): Promise<void> {
    if (state.finished) return
    const names = await runningImageNames()
    if ([...state.exeNames].some((n) => names.has(n))) {
      state.tracking = 'process'
      this.schedulePoll(state, 5000)
    } else {
      this.finish(state, true)
    }
  }

  /** Launched via a URI/shortcut: wait for one of the game's executables to show up. */
  private beginWaiting(state: RunState, timeoutMs: number): void {
    state.tracking = 'waiting'
    state.waitUntil = Date.now() + timeoutMs
    this.schedulePoll(state, 2500)
  }

  private schedulePoll(state: RunState, ms: number): void {
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => void this.poll(state), ms)
  }

  private async poll(state: RunState): Promise<void> {
    if (state.finished) return
    if (state.child) return this.schedulePoll(state, 5000) // direct child still alive; 'exit' will handle it
    const names = await runningImageNames()
    const alive = [...state.exeNames].some((n) => names.has(n))
    if (state.tracking === 'waiting') {
      if (alive) {
        state.tracking = 'process'
        state.startedAt = Date.now()
        this.emit('changed')
        return this.schedulePoll(state, 5000)
      }
      if (Date.now() > state.waitUntil || state.exeNames.size === 0) {
        this.emit('error', {
          gameId: state.gameId,
          title: state.title,
          message: 'The game was opened, but its process could not be detected, so playtime was not tracked.'
        })
        return this.finish(state, false)
      }
      return this.schedulePoll(state, 2500)
    }
    if (alive) return this.schedulePoll(state, 5000)
    this.finish(state, true)
  }

  private finish(state: RunState, tracked: boolean): void {
    if (state.finished) return
    state.finished = true
    if (state.timer) clearTimeout(state.timer)
    this.running.delete(state.gameId)
    this.emit('ended', {
      gameId: state.gameId,
      title: state.title,
      startedAt: state.startedAt,
      endedAt: Date.now(),
      tracked: tracked && state.tracking === 'process'
    })
    this.emit('changed')
  }

  /** On app quit: close out sessions so playtime up to now is kept. */
  finishAll(): void {
    for (const s of [...this.running.values()]) this.finish(s, true)
  }
}
