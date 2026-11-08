import { shell } from 'electron'
import { spawn, execFile, execFileSync, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type { Game, LaunchPlan, LaunchProfileId, RunningInfo } from '@shared/types'
import { SYSTEM_PROCESS_NAMES, isDriveRoot, walkExes } from './exe'
import { log } from './log'
import { preferHighPerformanceGpu, raisePriority, useHighPerformancePlan } from './sysboost'
import { applyDriverSettings } from './nvidia'
import { applyIniEdits } from './ueconfig'

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
  /** Waiting after a stub exited: on timeout, keep the time already played instead of reporting an error. */
  quietWait: boolean
  exitedAt?: number
  /** Store game or launcher exe: its process may hand off to the real game. */
  stubLike?: boolean
  profile: LaunchProfileId
  /** High CPU priority requested by the launch mode. */
  boostPriority: boolean
  /** Session tweaks to undo when the game closes (GPU preference, power plan). */
  undo: (() => void)[]
  boostTimers: NodeJS.Timeout[]
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
    try {
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
    } catch (err) {
      // Windows refused to start tasklist (rare); treat as "nothing seen" and try again next poll.
      log.warn('Could not list processes', (err as Error).message)
      resolve(new Set())
    }
  })
}

/** Stores whose games launch best through their URI (DRM / client checks). */
const URI_SOURCES = new Set(['steam', 'epic', 'ubisoft'])
/** Store clients we start for the game; the client itself must never count as "playing". */
const CLIENT_EXES = new Set(['riotclientservices.exe', 'battle.net.exe'])
/** Sources whose exe often exits right away and hands off to the real game process. */
const STUB_SOURCES = new Set(['ea', 'gog', 'battlenet', 'ubisoft', 'riot', 'epic', 'steam'])

let steamExeCache: string | null | undefined
/** Steam's own executable, for launching Steam games with launch options. */
function findSteamExe(): string | null {
  if (steamExeCache !== undefined) return steamExeCache
  steamExeCache = null
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamExe'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    const line = out.split(/\r?\n/).find((l) => l.includes('REG_SZ'))
    const exe = line ? path.normalize(line.split('REG_SZ')[1]!.trim()) : ''
    if (exe && fs.existsSync(exe)) steamExeCache = exe
  } catch {
    /* fall through to the usual install folders */
  }
  if (!steamExeCache) for (const p of ['C:\\Program Files (x86)\\Steam\\steam.exe', 'C:\\Program Files\\Steam\\steam.exe']) if (fs.existsSync(p)) steamExeCache = p
  return steamExeCache
}

function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

export class GameLauncher extends EventEmitter<LauncherEvents> {
  private running = new Map<string, RunState>()

  list(): RunningInfo[] {
    return [...this.running.values()].map((s) => ({ gameId: s.gameId, startedAt: s.startedAt, tracking: s.tracking, profile: s.profile }))
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

  async launch(game: Game, plan: LaunchPlan): Promise<void> {
    if (this.running.has(game.id)) throw new Error(`${game.title} is already running.`)

    const exeOk = !!game.exePath && fs.existsSync(game.exePath)
    const useUri = !!game.launchUri && (!exeOk || URI_SOURCES.has(game.source))
    // Riot / Battle.net: we start the store client, which then starts the game. Track the game, not the client.
    const viaClient = !useUri && (CLIENT_EXES.has(path.basename(game.exePath).toLowerCase()) || (game.source === 'battlenet' && /launcher\.exe$/i.test(game.exePath)))
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
      quietWait: false,
      stubLike: STUB_SOURCES.has(game.source) || /launcher/i.test(path.basename(game.exePath)),
      profile: plan.profile,
      boostPriority: plan.priority === 'high',
      undo: [],
      boostTimers: [],
      finished: false
    }
    if (plan.engine.realExe) state.exeNames.add(path.basename(plan.engine.realExe).toLowerCase())
    if (viaClient) for (const n of [...state.exeNames]) if (/launcher|crash|report|setup|unins/i.test(n)) state.exeNames.delete(n)

    // The user's own options are passed exactly as typed; the launch mode's options go after them.
    const argLine = [game.launchArgs.trim(), ...(viaClient ? [] : plan.tokens)].filter(Boolean).join(' ')
    await this.applyBeforeStart(state, game, plan)
    try {

      const steamExe = useUri && game.source === 'steam' && game.sourceId && argLine ? findSteamExe() : null
      if (steamExe) {
        // steam://rungameid can't carry launch options; "steam.exe -applaunch <id> <options>" can.
        await this.spawnDirect(state, steamExe, `-applaunch ${game.sourceId} ${argLine}`, path.dirname(steamExe), false, false)
        this.beginWaiting(state, 180_000)
      } else if (useUri) {
        await shell.openExternal(game.launchUri)
        this.beginWaiting(state, 180_000)
      } else {
        const cwd = game.workingDir && fs.existsSync(game.workingDir) ? game.workingDir : path.dirname(game.exePath)
        const ext = path.extname(game.exePath).toLowerCase()
        if (game.runAsAdmin) {
          this.spawnElevated(state, game.exePath, argLine, cwd)
        } else if (viaClient) {
          await this.spawnDirect(state, game.exePath, argLine, cwd, false, false)
          this.beginWaiting(state, 180_000)
        } else if (ext === '.exe') {
          try {
            await this.spawnDirect(state, game.exePath, argLine, cwd)
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code
            // ERROR_ELEVATION_REQUIRED surfaces as EACCES / UNKNOWN: retry through UAC.
            if (code === 'EACCES' || code === 'UNKNOWN' || code === 'EPERM') {
              log.info('Elevation required, retrying as administrator:', game.exePath)
              this.spawnElevated(state, game.exePath, argLine, cwd)
            } else {
              throw new Error(`Could not start ${game.title}: ${(err as Error).message}`)
            }
          }
        } else if (ext === '.bat' || ext === '.cmd') {
          await this.spawnDirect(state, `"${game.exePath}"`, argLine, cwd, true)
        } else {
          // .lnk, .url and anything else: let Windows decide how to open it.
          const err = await shell.openPath(game.exePath)
          if (err) throw new Error(`Could not open ${game.exePath}: ${err}`)
          this.beginWaiting(state, 120_000)
        }
      }

    } catch (err) {
      // The game never started: put back anything the launch mode changed.
      for (const undo of state.undo.reverse()) {
        try {
          undo()
        } catch {
          /* best effort */
        }
      }
      state.undo = []
      throw err
    }

    this.running.set(game.id, state)
    if (state.boostPriority) {
      // The game (or the real process behind its launcher) may take a moment to appear.
      for (const ms of [3000, 15000, 45000]) state.boostTimers.push(setTimeout(() => this.applyPriority(state), ms))
    }
    this.emit('started', { id: game.id, title: game.title })
    this.emit('changed')
  }

  /**
   * Start a process with a raw command-line tail. The line is passed verbatim (no re-quoting), so options
   * like -ExecCmds="a 1,b 2" reach the game exactly as written.
   */
  private spawnDirect(state: RunState, file: string, argLine: string, cwd: string, useShell = false, track = true): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = argLine ? [argLine] : []
      const child = useShell
        ? spawn(file, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false, shell: true })
        : spawn(file, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true, argv0: `"${file}"` })
      let spawned = false
      child.once('spawn', () => {
        spawned = true
        child.unref()
        if (!track) return resolve()
        state.child = child
        resolve()
      })
      child.once('error', (err) => {
        if (!spawned) reject(err)
        else log.error('Game process error', err)
      })
      child.once('exit', () => {
        if (!spawned || !track) return
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
    } else if (state.stubLike && Date.now() - state.launchedAt < 30_000) {
      // A store game's launcher exited fast: the real game is probably about to start (EA, GOG, Battle.net…).
      state.exitedAt = Date.now()
      state.quietWait = true
      this.beginWaiting(state, 45_000)
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
        if (!state.exitedAt) state.startedAt = Date.now()
        state.exitedAt = 0
        this.applyPriority(state)
        this.emit('changed')
        return this.schedulePoll(state, 5000)
      }
      if (Date.now() > state.waitUntil || state.exeNames.size === 0) {
        if (state.quietWait) {
          // Nothing else showed up: the first process was the game. Keep the time it ran.
          state.tracking = 'process'
          return this.finish(state, true, state.exitedAt || Date.now())
        }
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

  /** GPU preference, power plan and driver textures must be in place before the game starts. */
  private async applyBeforeStart(state: RunState, game: Game, plan: LaunchPlan): Promise<void> {
    if (plan.gpu) {
      const exes = [game.exePath, plan.engine.realExe ?? ''].filter((p) => p && /\.exe$/i.test(p) && !CLIENT_EXES.has(path.basename(p).toLowerCase()))
      if (exes.length) state.undo.push(preferHighPerformanceGpu(exes))
    }
    if (plan.powerPlan) {
      const release = useHighPerformancePlan()
      if (release) state.undo.push(release)
    }
    if (plan.settingsFile && plan.settingsEdits.length) {
      try {
        state.undo.push(applyIniEdits(plan.settingsFile, plan.settingsEdits))
      } catch (err) {
        this.emit('error', { gameId: game.id, title: game.title, message: `Potato settings couldn't be written: ${(err as Error).message}. The game starts with its own settings.` })
      }
    }
    if ((plan.driverTweak !== 'none' || plan.driverLodBias !== null) && plan.driverExe && !CLIENT_EXES.has(plan.driverExe.toLowerCase())) {
      try {
        state.undo.push(await applyDriverSettings(plan.driverExe, plan.driverTweak, plan.driverLodBias))
      } catch (err) {
        this.emit('error', { gameId: game.id, title: game.title, message: `NVIDIA settings couldn't be applied: ${(err as Error).message}. The game starts normally.` })
      }
    }
  }

  private applyPriority(state: RunState): void {
    if (!state.finished && state.boostPriority) raisePriority([...state.exeNames])
  }

  private finish(state: RunState, tracked: boolean, endedAt = Date.now()): void {
    if (state.finished) return
    state.finished = true
    if (state.timer) clearTimeout(state.timer)
    state.boostTimers.forEach(clearTimeout)
    for (const undo of state.undo.reverse()) {
      try {
        undo()
      } catch (err) {
        log.warn('Could not undo launch-mode change', err)
      }
    }
    state.undo = []
    this.running.delete(state.gameId)
    this.emit('ended', {
      gameId: state.gameId,
      title: state.title,
      startedAt: state.startedAt,
      endedAt,
      tracked: tracked && state.tracking === 'process'
    })
    this.emit('changed')
  }

  /** On app quit: close out sessions so playtime up to now is kept. */
  finishAll(): void {
    for (const s of [...this.running.values()]) this.finish(s, true)
  }
}
