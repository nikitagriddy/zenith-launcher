import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { DeepPartial, GameInput, GamePatch, ScanCandidate, ScanOptions, Settings, StorageInfo } from '@shared/types'
import * as repo from './repo'
import * as backup from './backup'
import { databaseFile, flushNow } from './db'
import { deleteMedia, extractExeIcon, getMediaDir, importMediaFile, listMediaFiles } from './media'
import { addGameWithDefaults, importCandidates, removeGameAndMedia, runScan } from './library'
import type { GameLauncher } from './launcher'
import { fetchAllArtwork, fetchArtwork } from './artwork'
import { getExtras, getInstallSize, getUninstallInfo, runUninstall } from './extras'
import { getFreeGames } from './deals'
import { checkForUpdates, downloadUpdate, getUpdateStatus, installUpdate, postponeInstall } from './updater'
import { log } from './log'

export interface IpcContext {
  window: () => BrowserWindow | null
  launcher: GameLauncher
  send: (event: string, payload?: unknown) => void
  launchGame: (id: string) => Promise<void>
  createShortcut: (id: string, where: 'desktop' | 'startMenu') => string
  onSettingsChanged: (prev: Settings, next: Settings) => void
  /** Fetch artwork in the background for games that are missing some (respects the auto-artwork setting). */
  queueArtwork: () => void
}

type Handler = (...args: any[]) => unknown

function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`IPC ${channel} failed:`, message)
      return { ok: false, error: message }
    }
  })
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new Error(`Invalid ${name}`)
  return v
}

function dirSize(dir: string): number {
  let total = 0
  try {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name)
      total += f.isDirectory() ? dirSize(p) : fs.statSync(p).size
    }
  } catch {
    /* ignore */
  }
  return total
}

export function registerIpc(ctx: IpcContext): void {
  const libraryChanged = () => ctx.send('library:changed')

  // ---- games ----
  handle('games:list', () => repo.listGames())
  handle('games:add', async (input: GameInput) => {
    const g = await addGameWithDefaults(input)
    libraryChanged()
    ctx.queueArtwork()
    return g
  })
  handle('games:update', (id: unknown, patch: GamePatch) => {
    const prev = repo.requireGame(str(id, 'id'))
    const exe = (patch.exePath ?? prev.exePath).trim()
    const uri = (patch.launchUri ?? prev.launchUri).trim()
    if (!exe && !uri) throw new Error('A game needs an executable or a launch URI.')
    const g = repo.updateGame(prev.id, patch)
    // Clean up media files that were replaced.
    for (const k of ['cover', 'icon', 'hero'] as const) if (prev[k] && prev[k] !== g[k]) deleteMedia(prev[k])
    libraryChanged()
    return g
  })
  handle('games:remove', (id: unknown) => {
    const gid = str(id, 'id')
    if (ctx.launcher.isRunning(gid)) throw new Error('This game is running. Close it before removing it.')
    removeGameAndMedia(gid)
    libraryChanged()
  })
  handle('games:toggleFavorite', (id: unknown) => {
    const g = repo.requireGame(str(id, 'id'))
    const next = repo.updateGame(g.id, { favorite: !g.favorite })
    libraryChanged()
    return next
  })
  handle('games:setCategories', (id: unknown, cats: unknown) => {
    const g = repo.setGameCategories(str(id, 'id'), Array.isArray(cats) ? cats.map(String) : [])
    libraryChanged()
    return g
  })
  handle('games:launch', (id: unknown) => ctx.launchGame(str(id, 'id')))
  handle('games:running', () => ctx.launcher.list())
  handle('games:openFolder', async (id: unknown) => {
    const g = repo.requireGame(str(id, 'id'))
    const dir = g.installDir || (g.exePath ? path.dirname(g.exePath) : '')
    if (!dir || !fs.existsSync(dir)) throw new Error('Install folder not found on disk.')
    const err = await shell.openPath(dir)
    if (err) throw new Error(err)
  })
  handle('games:createShortcut', (id: unknown, where: unknown) =>
    ctx.createShortcut(str(id, 'id'), where === 'startMenu' ? 'startMenu' : 'desktop')
  )
  handle('games:extractIcon', (exe: unknown) => extractExeIcon(str(exe, 'path')))
  handle('games:sessions', (gameId?: unknown, limit?: unknown) =>
    repo.listSessions(typeof gameId === 'string' && gameId ? gameId : undefined, Math.min(Number(limit) || 100, 1000))
  )
  handle('games:clearPlaytime', (id: unknown) => {
    const g = repo.clearPlaytime(str(id, 'id'))
    libraryChanged()
    return g
  })

  // ---- categories ----
  handle('categories:list', () => repo.listCategories())
  handle('categories:create', (name: unknown, color?: unknown) => {
    const c = repo.createCategory(str(name, 'name'), typeof color === 'string' ? color : undefined)
    libraryChanged()
    return c
  })
  handle('categories:update', (id: unknown, patch: Record<string, unknown>) => {
    const c = repo.updateCategory(str(id, 'id'), patch)
    libraryChanged()
    return c
  })
  handle('categories:remove', (id: unknown) => {
    repo.removeCategory(str(id, 'id'))
    libraryChanged()
  })

  // ---- scanning ----
  handle('scan:run', (opts?: ScanOptions) => runScan(opts ?? {}, (p) => ctx.send('scan:progress', p)))
  handle('scan:import', async (candidates: ScanCandidate[]) => {
    const r = await importCandidates(Array.isArray(candidates) ? candidates : [])
    libraryChanged()
    if (r.added) ctx.queueArtwork()
    return r
  })

  // ---- settings ----
  handle('settings:get', () => repo.getSettings())
  handle('settings:set', (patch: DeepPartial<Settings>) => {
    const prev = repo.getSettings()
    const next = repo.saveSettings(patch)
    ctx.onSettingsChanged(prev, next)
    return next
  })

  // ---- dialogs / media ----
  handle('dialog:openFile', async (opts: { title?: string; filters?: Electron.FileFilter[] }) => {
    const win = ctx.window()
    const r = await (win ? dialog.showOpenDialog(win, { title: opts?.title, filters: opts?.filters, properties: ['openFile'] }) : dialog.showOpenDialog({ title: opts?.title, filters: opts?.filters, properties: ['openFile'] }))
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  handle('dialog:openFolder', async (title?: unknown) => {
    const win = ctx.window()
    const o: Electron.OpenDialogOptions = { title: typeof title === 'string' ? title : 'Select folder', properties: ['openDirectory'] }
    const r = await (win ? dialog.showOpenDialog(win, o) : dialog.showOpenDialog(o))
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  handle('media:import', (file: unknown, prefix: unknown) => importMediaFile(str(file, 'file'), typeof prefix === 'string' ? prefix : 'img'))

  // ---- data ----
  const saveDialog = async (title: string, defaultName: string, ext: string, label: string) => {
    const win = ctx.window()
    const o: Electron.SaveDialogOptions = {
      title,
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [{ name: label, extensions: [ext] }]
    }
    const r = await (win ? dialog.showSaveDialog(win, o) : dialog.showSaveDialog(o))
    return r.canceled || !r.filePath ? null : r.filePath
  }
  const openDialog = async (title: string, ext: string[], label: string) => {
    const win = ctx.window()
    const o: Electron.OpenDialogOptions = { title, filters: [{ name: label, extensions: ext }], properties: ['openFile'] }
    const r = await (win ? dialog.showOpenDialog(win, o) : dialog.showOpenDialog(o))
    return r.canceled ? null : (r.filePaths[0] ?? null)
  }
  const date = () => new Date().toISOString().slice(0, 10)

  handle('data:exportLibrary', async () => {
    const file = await saveDialog('Export library', `zenith-library-${date()}.json`, 'json', 'Zenith library')
    if (!file) return null
    backup.exportLibrary(file)
    return file
  })
  handle('data:importLibrary', async () => {
    const file = await openDialog('Import library', ['json'], 'Zenith library')
    if (!file) return null
    const r = backup.importLibrary(file)
    libraryChanged()
    return r
  })
  handle('data:backup', async () => {
    const file = await saveDialog('Save backup', `zenith-backup-${date()}.zbak`, 'zbak', 'Zenith backup')
    if (!file) return null
    backup.writeBackup(file)
    return file
  })
  handle('data:backupNow', () => backup.backupNow('manual'))
  handle('data:listBackups', () => backup.listBackups())
  handle('data:restore', async (filePath?: unknown) => {
    const file = typeof filePath === 'string' && filePath ? filePath : await openDialog('Restore backup', ['zbak', 'json'], 'Zenith backup')
    if (!file) return false
    if (ctx.launcher.list().length) throw new Error('Close running games before restoring a backup.')
    const prev = repo.getSettings()
    backup.restoreBackup(file)
    ctx.onSettingsChanged(prev, repo.getSettings())
    ctx.send('data:restored')
    return true
  })
  handle('data:storageInfo', (): StorageInfo => {
    flushNow()
    const media = listMediaFiles()
    const dbFile = databaseFile()
    return {
      dataDir: app.getPath('userData'),
      dbBytes: fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0,
      mediaBytes: media.reduce((a, f) => a + f.size, 0),
      mediaFiles: media.length,
      unusedMedia: backup.unusedMediaNames().length,
      backupsDir: backup.getBackupsDir(),
      backupsBytes: dirSize(backup.getBackupsDir())
    }
  })
  handle('data:openDataFolder', async () => {
    const err = await shell.openPath(app.getPath('userData'))
    if (err) throw new Error(err)
  })
  handle('data:cleanMedia', () => {
    const unused = backup.unusedMediaNames()
    for (const n of unused) fs.rmSync(path.join(getMediaDir(), n), { force: true })
    return unused.length
  })
  handle('data:resetAll', () => {
    if (ctx.launcher.list().length) throw new Error('Close running games before resetting.')
    backup.backupNow('before-reset')
    const prev = repo.getSettings()
    repo.replaceAllTables({})
    for (const f of listMediaFiles()) fs.rmSync(path.join(getMediaDir(), f.name), { force: true })
    ctx.onSettingsChanged(prev, repo.getSettings())
    ctx.send('data:restored')
  })

  // ---- stats ----
  handle('stats:get', () => repo.getStats())

  // ---- game page extras ----
  handle('extras:get', (id: unknown) => getExtras(str(id, 'id')))
  handle('extras:size', (id: unknown, refresh?: unknown) => getInstallSize(str(id, 'id'), refresh === true))
  handle('extras:uninstallInfo', (id: unknown) => getUninstallInfo(str(id, 'id')))
  handle('extras:uninstall', (id: unknown) => {
    const gid = str(id, 'id')
    if (ctx.launcher.isRunning(gid)) throw new Error('Close the game before uninstalling it.')
    return runUninstall(gid)
  })

  // ---- free games ----
  handle('deals:list', (force?: unknown) => getFreeGames(force === true))

  // ---- artwork ----
  handle('art:fetch', async (id: unknown) => {
    const changed = await fetchArtwork(str(id, 'id'), true)
    if (changed) libraryChanged()
    return changed
  })
  handle('art:fetchAll', () =>
    fetchAllArtwork(true, (p) => ctx.send('art:progress', p), libraryChanged)
  )

  // ---- updates ----
  handle('update:status', () => getUpdateStatus())
  handle('update:check', () => checkForUpdates())
  handle('update:download', () => downloadUpdate())
  handle('update:install', () => installUpdate())
  handle('update:postpone', () => postponeInstall())

  // ---- window ----
  handle('win:minimize', () => ctx.window()?.minimize())
  handle('win:toggleMaximize', () => {
    const w = ctx.window()
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  handle('win:close', () => ctx.window()?.close())
  handle('win:isMaximized', () => ctx.window()?.isMaximized() ?? false)

  // ---- app ----
  handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    dataDir: app.getPath('userData'),
    isPackaged: app.isPackaged
  }))
  handle('app:showItemInFolder', (p: unknown) => {
    const file = str(p, 'path')
    if (!fs.existsSync(file)) throw new Error('Path no longer exists.')
    shell.showItemInFolder(file)
  })
  handle('app:openExternal', async (url: unknown) => {
    const u = str(url, 'url')
    if (!/^https?:\/\//i.test(u)) throw new Error('Only web links can be opened.')
    await shell.openExternal(u)
  })
}
