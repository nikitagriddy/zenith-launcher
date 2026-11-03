// Auto-update from GitHub Releases (configured by the `publish` block in electron-builder.yml).
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { log } from './log'

let status: UpdateStatus = { state: 'idle', currentVersion: app.getVersion() }
let notify: (s: UpdateStatus) => void = () => undefined
let timer: NodeJS.Timeout | null = null

function set(next: Partial<UpdateStatus>): void {
  status = { ...status, ...next, currentVersion: app.getVersion() }
  notify(status)
}

/** Updates only work in an installed build that was packaged with a publish target. */
function supported(): string | null {
  if (!app.isPackaged) return 'Updates are only available in the installed app.'
  if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return 'This build has no update source configured.'
  return null
}

export function initUpdater(onStatus: (s: UpdateStatus) => void, autoCheck: boolean): void {
  notify = onStatus
  const why = supported()
  if (why) {
    set({ state: 'unsupported', message: why })
    return
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: (m: unknown) => log.info('[updater]', m), warn: (m: unknown) => log.warn('[updater]', m), error: (m: unknown) => log.error('[updater]', m), debug: () => undefined }
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', message: undefined }))
  autoUpdater.on('update-available', (i) => set({ state: 'downloading', version: i.version, percent: 0 }))
  autoUpdater.on('update-not-available', () => set({ state: 'none', checkedAt: Date.now() }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => set({ state: 'downloaded', version: i.version, percent: 100 }))
  autoUpdater.on('error', (err) => set({ state: 'error', message: err?.message?.split('\n')[0] ?? 'Update failed' }))
  setAutoCheck(autoCheck)
}

export function setAutoCheck(on: boolean): void {
  if (timer) clearInterval(timer)
  timer = null
  if (!on || status.state === 'unsupported') return
  setTimeout(() => void checkForUpdates(), 12_000)
  timer = setInterval(() => void checkForUpdates(), 6 * 3600_000)
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  const why = supported()
  if (why) {
    set({ state: 'unsupported', message: why })
    return status
  }
  if (status.state === 'checking' || status.state === 'downloading' || status.state === 'downloaded') return status
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ state: 'error', message: (err as Error).message.split('\n')[0] })
  }
  return status
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function installUpdate(beforeQuit: () => void): void {
  if (status.state !== 'downloaded') throw new Error('No update has been downloaded yet.')
  beforeQuit()
  autoUpdater.quitAndInstall(false, true)
}
