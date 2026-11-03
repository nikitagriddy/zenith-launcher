// Auto-update from GitHub Releases (configured by the `publish` block in electron-builder.yml).
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import type { Settings, UpdateStatus } from '@shared/types'
import { log } from './log'

const INSTALL_DELAY_MS = 8000

interface UpdaterHooks {
  onStatus: (s: UpdateStatus) => void
  /** True while a game is running: automatic restarts wait until it closes. */
  isBusy: () => boolean
  beforeInstall: () => void
}

let status: UpdateStatus = { state: 'idle', currentVersion: app.getVersion() }
let hooks: UpdaterHooks = { onStatus: () => undefined, isBusy: () => false, beforeInstall: () => undefined }
let opts: Settings['updates'] = { autoCheck: true, intervalHours: 6, installMode: 'auto' }
let timer: NodeJS.Timeout | null = null
let startupCheck: NodeJS.Timeout | null = null
let installTimer: NodeJS.Timeout | null = null
/** User pressed "Later": skip the automatic restart this session (it still installs on quit). */
let postponed = false

function set(next: Partial<UpdateStatus>): void {
  status = { ...status, ...next, currentVersion: app.getVersion() }
  hooks.onStatus(status)
}

/** Updates only work in a packaged build that was built with a publish target. */
function supported(): string | null {
  if (!app.isPackaged) return 'Updates are only available in the installed app.'
  if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return 'This build has no update source configured.'
  return null
}

function notesOf(info: UpdateInfo): string | undefined {
  const raw = Array.isArray(info.releaseNotes) ? info.releaseNotes.map((n) => n.note ?? '').join('\n') : (info.releaseNotes ?? '')
  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/^co-authored-by:.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, 1500) : undefined
}

export function initUpdater(h: UpdaterHooks, settings: Settings['updates']): void {
  hooks = h
  opts = settings
  const why = supported()
  if (why) {
    set({ state: 'unsupported', message: why })
    return
  }
  autoUpdater.autoInstallOnAppQuit = true
  // Always ask GitHub fresh; a cached release feed can hide a just-published version.
  autoUpdater.requestHeaders = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
  autoUpdater.logger = {
    info: (m: unknown) => log.info('[updater]', m),
    warn: (m: unknown) => log.warn('[updater]', m),
    error: (m: unknown) => log.error('[updater]', m),
    debug: () => undefined
  }
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: undefined }))
  autoUpdater.on('update-available', (i) =>
    set({
      state: autoUpdater.autoDownload ? 'downloading' : 'available',
      version: i.version,
      notes: notesOf(i),
      releaseDate: i.releaseDate,
      percent: 0,
      checkedAt: Date.now()
    })
  )
  autoUpdater.on('update-not-available', () => set({ state: 'none', checkedAt: Date.now() }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => {
    set({ state: 'downloaded', version: i.version, notes: notesOf(i) ?? status.notes, percent: 100 })
    if (opts.installMode === 'auto') scheduleAutoInstall()
  })
  autoUpdater.on('error', (err) => set({ state: 'error', message: err?.message?.split('\n')[0] ?? 'Update failed' }))
  applyUpdateSettings(settings)
}

/** Re-apply settings (download behaviour, schedule, install mode). Safe to call any time. */
export function applyUpdateSettings(next: Settings['updates']): void {
  const scheduleChanged = next.autoCheck !== opts.autoCheck || next.intervalHours !== opts.intervalHours || !timer
  opts = next
  if (status.state === 'unsupported') return
  autoUpdater.autoDownload = next.installMode !== 'manual'
  if (scheduleChanged) {
    if (timer) clearInterval(timer)
    if (startupCheck) clearTimeout(startupCheck)
    timer = startupCheck = null
    if (next.autoCheck) {
      startupCheck = setTimeout(() => void checkForUpdates(), 12_000)
      timer = setInterval(() => void checkForUpdates(), next.intervalHours * 3600_000)
    }
  }
  if (next.installMode === 'auto' && status.state === 'downloaded') scheduleAutoInstall()
  if (next.installMode !== 'auto') cancelAutoInstall()
}

function cancelAutoInstall(): void {
  if (installTimer) clearTimeout(installTimer)
  installTimer = null
  if (status.state === 'installing') set({ state: 'downloaded', waitingForGames: false })
  else if (status.waitingForGames) set({ waitingForGames: false })
}

/** Restart into the new version shortly, unless a game is running (then wait for it to close). */
function scheduleAutoInstall(): void {
  if (installTimer || postponed || status.state !== 'downloaded') return
  if (hooks.isBusy()) {
    if (!status.waitingForGames) set({ waitingForGames: true })
    return
  }
  set({ state: 'installing', waitingForGames: false })
  installTimer = setTimeout(() => {
    installTimer = null
    if (hooks.isBusy()) {
      set({ state: 'downloaded', waitingForGames: true })
      return
    }
    doInstall()
  }, INSTALL_DELAY_MS)
}

export function postponeInstall(): void {
  postponed = true
  cancelAutoInstall()
}

/** Call whenever the set of running games changes. */
export function notifyBusyChanged(): void {
  if (opts.installMode === 'auto' && status.state === 'downloaded' && status.waitingForGames && !hooks.isBusy()) {
    set({ waitingForGames: false })
    scheduleAutoInstall()
  }
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  const why = supported()
  if (why) {
    set({ state: 'unsupported', message: why })
    return status
  }
  if (['checking', 'downloading', 'downloaded', 'installing'].includes(status.state)) return status
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ state: 'error', message: (err as Error).message.split('\n')[0] })
  }
  return status
}

export async function downloadUpdate(): Promise<void> {
  if (status.state !== 'available') throw new Error('There is no update waiting to be downloaded.')
  set({ state: 'downloading', percent: 0 })
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    set({ state: 'error', message: (err as Error).message.split('\n')[0] })
    throw err
  }
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

function doInstall(): void {
  set({ state: 'installing' })
  hooks.beforeInstall()
  // Silent install, then relaunch the new version.
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}

export function installUpdate(): void {
  if (status.state !== 'downloaded' && status.state !== 'installing') throw new Error('No update has been downloaded yet.')
  if (installTimer) clearTimeout(installTimer)
  installTimer = null
  doInstall()
}
