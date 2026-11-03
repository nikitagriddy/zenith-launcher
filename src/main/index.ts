import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  globalShortcut,
  nativeImage,
  net,
  protocol,
  screen,
  shell
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Settings, ToastPayload } from '@shared/types'
import { closeDatabase, flushNow, openDatabase } from './db'
import { initLog, log } from './log'
import { initMedia, mediaPath } from './media'
import { initBackups, maybeAutoBackup } from './backup'
import { GameLauncher } from './launcher'
import { registerIpc } from './ipc'
import { getSettings, listGames, markLaunched, recordSession, requireGame } from './repo'
import { importCandidates, runScan } from './library'
import { fetchAllArtwork } from './artwork'
import { applyUpdateSettings, initUpdater, notifyBusyChanged } from './updater'

if (process.env.ZENITH_USER_DATA) app.setPath('userData', path.resolve(process.env.ZENITH_USER_DATA))

app.setAppUserModelId('com.zenith.launcher')

protocol.registerSchemesAsPrivileged([
  { scheme: 'zenith-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const isDev = !!process.env.VITE_DEV_SERVER_URL
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let scanTimer: NodeJS.Timeout | null = null
let registeredHotkey = ''
const launcher = new GameLauncher()

function resourcePath(...p: string[]): string {
  return path.join(app.getAppPath(), 'resources', ...p)
}

function send(event: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('zenith:event', event, payload)
}

function toast(t: ToastPayload): void {
  send('toast', t)
  const s = getSettings()
  const visible = mainWindow?.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused()
  if (s.general.showNotifications && !visible && Notification.isSupported()) {
    new Notification({ title: t.title, body: t.message ?? '', icon: resourcePath('icon.png'), silent: true }).show()
  }
}

// ---------- window ----------

interface WinState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

const winStateFile = () => path.join(app.getPath('userData'), 'window-state.json')

function loadWinState(): WinState {
  const fallback: WinState = { width: 1440, height: 900, maximized: false }
  try {
    const s = JSON.parse(fs.readFileSync(winStateFile(), 'utf8')) as WinState
    if (typeof s.x === 'number' && typeof s.y === 'number') {
      const visible = screen.getAllDisplays().some((d) => {
        const b = d.workArea
        return s.x! >= b.x - 50 && s.y! >= b.y - 50 && s.x! < b.x + b.width - 100 && s.y! < b.y + b.height - 100
      })
      if (!visible) return { ...fallback, maximized: s.maximized }
    }
    return { ...fallback, ...s }
  } catch {
    return fallback
  }
}

function saveWinState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const b = mainWindow.getNormalBounds()
  const s: WinState = { ...b, maximized: mainWindow.isMaximized() }
  try {
    fs.writeFileSync(winStateFile(), JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

function createWindow(): void {
  const st = loadWinState()
  const settings = getSettings()
  mainWindow = new BrowserWindow({
    x: st.x,
    y: st.y,
    width: st.width,
    height: st.height,
    minWidth: 1024,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: settings.appearance.theme === 'light' ? '#f1f3f7' : '#0b0d12',
    title: 'Zenith',
    icon: resourcePath('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  if (st.maximized) mainWindow.maximize()

  const startHidden = process.argv.includes('--hidden')
  mainWindow.once('ready-to-show', () => {
    if (startHidden) return
    if (settings.startup.startMinimized) mainWindow?.minimize()
    else mainWindow?.show()
  })

  mainWindow.on('maximize', () => send('win:maximized', true))
  mainWindow.on('unmaximize', () => send('win:maximized', false))
  mainWindow.on('resize', debounce(saveWinState, 400))
  mainWindow.on('move', debounce(saveWinState, 400))
  mainWindow.on('close', (e) => {
    saveWinState()
    if (!quitting && getSettings().general.closeToTray && tray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => (mainWindow = null))

  // Never navigate away from the app or open new Electron windows; web links go to the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL!)) return
    e.preventDefault()
  })
  mainWindow.webContents.on('render-process-gone', (_e, d) => log.error('Renderer crashed', d))

  if (isDev) void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function showWindow(): void {
  if (!mainWindow) createWindow()
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function debounce<T extends (...a: never[]) => void>(fn: T, ms: number): T {
  let t: NodeJS.Timeout | null = null
  return ((...a: never[]) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }) as T
}

// ---------- tray ----------

function trayImage(): Electron.NativeImage {
  const img = nativeImage.createFromPath(resourcePath('icon.png'))
  return img.isEmpty() ? img : img.resize({ width: 16, height: 16, quality: 'best' })
}

function refreshTray(): void {
  if (!tray) return
  const recent = listGames()
    .filter((g) => g.lastPlayed > 0 && !g.hidden)
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
    .slice(0, 6)
  const running = new Set(launcher.list().map((r) => r.gameId))
  const menu = Menu.buildFromTemplate([
    { label: 'Open Zenith', click: showWindow },
    { type: 'separator' },
    ...(recent.length
      ? [
          { label: 'Recently played', enabled: false },
          ...recent.map((g) => ({
            label: running.has(g.id) ? `${g.title}  (running)` : g.title,
            enabled: !running.has(g.id),
            click: () => void launchGame(g.id).catch((err) => toast({ kind: 'error', title: g.title, message: err.message }))
          })),
          { type: 'separator' as const }
        ]
      : []),
    { label: 'Library', click: () => (showWindow(), send('navigate', { page: 'library' })) },
    { label: 'Settings', click: () => (showWindow(), send('navigate', { page: 'settings' })) },
    { type: 'separator' },
    { label: 'Quit Zenith', click: () => ((quitting = true), app.quit()) }
  ])
  tray.setContextMenu(menu)
  tray.setToolTip(running.size ? `Zenith - ${running.size} game(s) running` : 'Zenith')
}

function createTray(): void {
  try {
    tray = new Tray(trayImage())
    tray.on('click', showWindow)
    refreshTray()
  } catch (err) {
    log.error('Tray creation failed', err)
    tray = null
  }
}

// ---------- launching ----------

async function launchGame(id: string): Promise<void> {
  const game = requireGame(id)
  await launcher.launch(game)
  markLaunched(game.id, Date.now())
  send('library:changed')
  const s = getSettings()
  if (s.general.minimizeOnLaunch && mainWindow?.isVisible()) mainWindow.minimize()
}

launcher.on('changed', () => {
  send('running:changed', launcher.list())
  refreshTray()
})
launcher.on('started', (g) => toast({ kind: 'success', title: `Launching ${g.title}`, message: 'Have fun! Playtime is being tracked.' }))
launcher.on('error', (e) => toast({ kind: 'error', title: e.title, message: e.message }))
launcher.on('ended', (e) => {
  const seconds = e.tracked ? recordSession(e.gameId, e.startedAt, e.endedAt) : 0
  send('library:changed')
  if (seconds > 0) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const label = h ? `${h}h ${m}m` : m ? `${m}m` : `${seconds}s`
    toast({ kind: 'info', title: `${e.title} closed`, message: `Session length: ${label}` })
  }
  if (getSettings().general.restoreAfterExit && !quitting && mainWindow?.isMinimized()) mainWindow.restore()
})

function createShortcut(id: string, where: 'desktop' | 'startMenu'): string {
  const g = requireGame(id)
  const dir =
    where === 'desktop'
      ? app.getPath('desktop')
      : path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Zenith Games')
  fs.mkdirSync(dir, { recursive: true })
  const safe = g.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'Game'
  const link = path.join(dir, `${safe}.lnk`)
  const args = app.isPackaged ? `--launch=${g.id}` : `"${app.getAppPath()}" --launch=${g.id}`
  const ok = shell.writeShortcutLink(link, 'create', {
    target: process.execPath,
    args,
    description: `Play ${g.title} with Zenith`,
    icon: g.exePath && fs.existsSync(g.exePath) ? g.exePath : process.execPath,
    iconIndex: 0,
    cwd: path.dirname(process.execPath)
  })
  if (!ok) throw new Error('Windows refused to create the shortcut.')
  return link
}

function handleArgv(argv: string[]): void {
  const arg = argv.find((a) => a.startsWith('--launch='))
  if (!arg) return
  const id = arg.slice('--launch='.length).replace(/"/g, '')
  void launchGame(id).catch((err) => {
    showWindow()
    toast({ kind: 'error', title: 'Could not launch game', message: err.message })
  })
}

function queueArtwork(): void {
  if (!getSettings().library.autoArtwork) return
  void fetchAllArtwork(false, (p) => send('art:progress', p), () => send('library:changed')).catch((err) =>
    log.warn('Background artwork fetch failed', err)
  )
}

// ---------- settings side-effects ----------

function applyHotkey(accel: string): void {
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey)
  registeredHotkey = ''
  if (!accel) return
  try {
    const ok = globalShortcut.register(accel, () => {
      if (mainWindow?.isVisible() && mainWindow.isFocused()) mainWindow.hide()
      else showWindow()
    })
    if (ok) registeredHotkey = accel
    else toast({ kind: 'error', title: 'Hotkey unavailable', message: `${accel} is already used by another app.` })
  } catch {
    toast({ kind: 'error', title: 'Invalid hotkey', message: accel })
  }
}

function applyLoginItem(s: Settings): void {
  if (!app.isPackaged) return // registering the dev electron.exe at login would be wrong
  app.setLoginItemSettings({ openAtLogin: s.startup.launchOnLogin, args: s.startup.startMinimized ? ['--hidden'] : [] })
}

function scheduleAutoScan(s: Settings): void {
  if (scanTimer) clearInterval(scanTimer)
  scanTimer = null
  const min = s.scanning.autoScanIntervalMin
  if (min > 0) scanTimer = setInterval(() => void autoScan(), min * 60_000)
}

let autoScanning = false
async function autoScan(): Promise<void> {
  if (autoScanning) return
  const s = getSettings()
  if (!s.scanning.folders.length && !s.scanning.detectSteam && !s.scanning.detectEpic) return
  autoScanning = true
  try {
    const r = await runScan({}, () => undefined)
    if (!r.candidates.length) return
    if (s.scanning.autoImport) {
      const res = await importCandidates(r.candidates)
      if (res.added) {
        send('library:changed')
        queueArtwork()
        toast({ kind: 'success', title: 'Library updated', message: `Found and added ${res.added} new game(s).` })
      }
    } else {
      toast({ kind: 'info', title: 'New games found', message: `${r.candidates.length} game(s) ready to import. Open Scan to review.` })
    }
  } catch (err) {
    log.error('Auto scan failed', err)
  } finally {
    autoScanning = false
  }
}

function onSettingsChanged(prev: Settings, next: Settings): void {
  if (prev.general.globalHotkey !== next.general.globalHotkey) applyHotkey(next.general.globalHotkey)
  if (prev.startup.launchOnLogin !== next.startup.launchOnLogin || prev.startup.startMinimized !== next.startup.startMinimized) {
    applyLoginItem(next)
  }
  if (prev.scanning.autoScanIntervalMin !== next.scanning.autoScanIntervalMin) scheduleAutoScan(next)
  if (JSON.stringify(prev.updates) !== JSON.stringify(next.updates)) applyUpdateSettings(next.updates)
  if (!prev.library.autoArtwork && next.library.autoArtwork) queueArtwork()
  send('settings:changed', next)
}

// ---------- lifecycle ----------

app.on('second-instance', (_e, argv) => {
  if (argv.some((a) => a.startsWith('--launch='))) handleArgv(argv)
  else showWindow()
})

process.on('uncaughtException', (err) => log.error('Uncaught exception', err))
process.on('unhandledRejection', (err) => log.error('Unhandled rejection', err))

app.whenReady().then(async () => {
  const dataDir = app.getPath('userData')
  fs.mkdirSync(dataDir, { recursive: true })
  initLog(dataDir)
  log.info(`Zenith ${app.getVersion()} starting (electron ${process.versions.electron})`)
  try {
    await openDatabase(dataDir)
  } catch (err) {
    log.error('Fatal: could not open database', err)
    const { dialog } = await import('electron')
    dialog.showErrorBox('Zenith', `Could not open the library database.\n\n${(err as Error).message}`)
    app.exit(1)
    return
  }
  initMedia(dataDir)
  initBackups(dataDir)

  protocol.handle('zenith-media', async (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, ''))
    const file = mediaPath(name)
    if (!file || !fs.existsSync(file)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  Menu.setApplicationMenu(null)
  registerIpc({
    window: () => mainWindow,
    launcher,
    send,
    launchGame,
    createShortcut,
    onSettingsChanged,
    queueArtwork
  })
  createWindow()
  createTray()

  const s = getSettings()
  applyHotkey(s.general.globalHotkey)
  applyLoginItem(s)
  scheduleAutoScan(s)
  handleArgv(process.argv)
  setTimeout(maybeAutoBackup, 15_000)
  setTimeout(queueArtwork, 6000)
  let lastUpdateState = ''
  initUpdater(
    {
      onStatus: (st) => {
        send('update:status', st)
        const key = `${st.state}:${st.version}:${st.waitingForGames}`
        if (key === lastUpdateState) return
        lastUpdateState = key
        const mode = getSettings().updates.installMode
        if (st.state === 'available') toast({ kind: 'info', title: `Zenith ${st.version} is available`, message: 'Open Settings › Updates to download it.' })
        else if (st.state === 'downloaded' && st.waitingForGames) toast({ kind: 'info', title: `Zenith ${st.version} downloaded`, message: 'It installs automatically once your game closes.' })
        else if (st.state === 'downloaded' && mode !== 'auto') toast({ kind: 'success', title: `Zenith ${st.version} is ready`, message: mode === 'quit' ? 'It installs the next time you quit Zenith.' : 'Open Settings › Updates to install it.' })
        else if (st.state === 'installing') toast({ kind: 'info', title: `Updating to Zenith ${st.version}`, message: 'Zenith restarts in a few seconds.' })
      },
      isBusy: () => launcher.list().length > 0,
      beforeInstall: () => {
        quitting = true
        launcher.finishAll()
        flushNow()
      }
    },
    s.updates
  )
  launcher.on('changed', notifyBusyChanged)
  if (s.scanning.autoScanOnStartup) setTimeout(() => void autoScan(), 4000)
})

app.on('before-quit', () => {
  quitting = true
  launcher.finishAll()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  closeDatabase()
})

app.on('window-all-closed', () => {
  if (!tray || !getSettings().general.closeToTray) app.quit()
})
