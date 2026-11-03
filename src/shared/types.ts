export type GameSource = 'manual' | 'scan' | 'steam' | 'epic' | 'import'

export interface Game {
  id: string
  title: string
  description: string
  developer: string
  exePath: string
  workingDir: string
  launchArgs: string
  runAsAdmin: boolean
  installDir: string
  launchUri: string
  source: GameSource
  sourceId: string
  cover: string
  icon: string
  hero: string
  favorite: boolean
  hidden: boolean
  playtimeSec: number
  lastPlayed: number
  launchCount: number
  addedAt: number
  categoryIds: string[]
  /** Computed: executable / install folder exists on disk. */
  installed: boolean
}

export type GameInput = Partial<
  Omit<Game, 'id' | 'installed' | 'playtimeSec' | 'lastPlayed' | 'launchCount' | 'addedAt'>
> & { title: string }

export type GamePatch = Partial<Omit<Game, 'id' | 'installed'>>

export interface Category {
  id: string
  name: string
  color: string
  sort: number
}

export interface Session {
  id: number
  gameId: string
  gameTitle: string
  startedAt: number
  endedAt: number
  durationSec: number
}

export interface ExeOption {
  path: string
  size: number
}

export interface ScanCandidate {
  key: string
  title: string
  exePath: string
  installDir: string
  source: GameSource
  sourceId: string
  launchUri: string
  alternatives: ExeOption[]
  coverFile: string
  heroFile: string
}

export interface ScanOptions {
  folders?: string[]
  includeStores?: boolean
}

export interface ScanResult {
  candidates: ScanCandidate[]
  scannedFolders: number
  warnings: string[]
}

export interface ScanProgress {
  phase: 'folders' | 'steam' | 'epic' | 'done'
  current: string
  found: number
}

export interface ArtworkProgress {
  done: number
  total: number
  current: string
}

export type UpdateInstallMode = 'auto' | 'quit' | 'manual'

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'none' | 'error' | 'unsupported'
  currentVersion: string
  version?: string
  percent?: number
  message?: string
  notes?: string
  releaseDate?: string
  checkedAt?: number
  /** Downloaded and set to auto-install, but waiting for running games to close. */
  waitingForGames?: boolean
}

export interface RunningInfo {
  gameId: string
  startedAt: number
  tracking: 'process' | 'waiting'
}

export interface DayStat {
  date: string
  seconds: number
}

export interface StatsSummary {
  totalPlaytimeSec: number
  totalSessions: number
  avgSessionSec: number
  longestSessionSec: number
  weekSeconds: number
  daily: DayStat[]
  topGames: { gameId: string; title: string; seconds: number; cover: string; icon: string }[]
  byWeekday: number[]
}

export interface StorageInfo {
  dataDir: string
  dbBytes: number
  mediaBytes: number
  mediaFiles: number
  unusedMedia: number
  backupsDir: string
  backupsBytes: number
}

export interface BackupEntry {
  name: string
  path: string
  size: number
  createdAt: number
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  dataDir: string
  isPackaged: boolean
}

export type ThemeName = 'dark' | 'midnight' | 'slate' | 'light'
export type LibraryLayout = 'grid' | 'list' | 'compact'
export type SortKey = 'name' | 'playtime' | 'lastPlayed' | 'added'
export type BackgroundType = 'none' | 'observatory' | 'aurora' | 'nebula' | 'sunset' | 'ocean' | 'image'

export interface Settings {
  general: {
    confirmBeforeRemove: boolean
    minimizeOnLaunch: boolean
    restoreAfterExit: boolean
    closeToTray: boolean
    globalHotkey: string
    showNotifications: boolean
  }
  updates: {
    autoCheck: boolean
    intervalHours: number
    /** auto: restart & install as soon as it's downloaded (waits for games to close) · quit: install on next exit · manual: ask first */
    installMode: UpdateInstallMode
  }
  appearance: {
    theme: ThemeName
    accent: string
    background: BackgroundType
    backgroundImage: string
    backgroundBlur: number
    backgroundDim: number
    animations: boolean
    glass: boolean
    grain: boolean
    sidebarCollapsed: boolean
    sidebarStyle: 'glass' | 'solid' | 'floating'
    sidebarShowCategories: boolean
    sidebarShowFavorites: boolean
    uiScale: number
  }
  library: {
    layout: LibraryLayout
    gridSize: number
    sortBy: SortKey
    sortDir: 'asc' | 'desc'
    showNotInstalled: boolean
    showHidden: boolean
    showCardInfo: boolean
    autoArtwork: boolean
  }
  scanning: {
    folders: string[]
    autoScanOnStartup: boolean
    autoScanIntervalMin: number
    depth: number
    detectSteam: boolean
    detectEpic: boolean
    autoImport: boolean
    excludeKeywords: string[]
  }
  startup: {
    launchOnLogin: boolean
    startMinimized: boolean
    startPage: 'home' | 'library'
  }
  data: {
    autoBackup: 'off' | 'daily' | 'weekly'
    keepBackups: number
  }
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] }

export interface ImportResult {
  added: number
  skipped: number
}

export type MainEvent =
  | 'library:changed'
  | 'settings:changed'
  | 'running:changed'
  | 'scan:progress'
  | 'toast'
  | 'navigate'
  | 'win:maximized'
  | 'data:restored'
  | 'art:progress'
  | 'update:status'

export interface ToastPayload {
  kind: 'info' | 'success' | 'error'
  title: string
  message?: string
}

export interface ZenithApi {
  games: {
    list(): Promise<Game[]>
    add(input: GameInput): Promise<Game>
    update(id: string, patch: GamePatch): Promise<Game>
    remove(id: string): Promise<void>
    toggleFavorite(id: string): Promise<Game>
    setCategories(id: string, categoryIds: string[]): Promise<Game>
    launch(id: string): Promise<void>
    running(): Promise<RunningInfo[]>
    openFolder(id: string): Promise<void>
    createShortcut(id: string, where: 'desktop' | 'startMenu'): Promise<string>
    extractIcon(exePath: string): Promise<string>
    sessions(gameId?: string, limit?: number): Promise<Session[]>
    clearPlaytime(id: string): Promise<Game>
  }
  categories: {
    list(): Promise<Category[]>
    create(name: string, color?: string): Promise<Category>
    update(id: string, patch: Partial<Pick<Category, 'name' | 'color' | 'sort'>>): Promise<Category>
    remove(id: string): Promise<void>
  }
  scan: {
    run(opts?: ScanOptions): Promise<ScanResult>
    importCandidates(candidates: ScanCandidate[]): Promise<ImportResult>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: DeepPartial<Settings>): Promise<Settings>
  }
  dialog: {
    openFile(opts: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>
    openFolder(title?: string): Promise<string | null>
  }
  media: {
    importFile(filePath: string, prefix: string): Promise<string>
  }
  data: {
    exportLibrary(): Promise<string | null>
    importLibrary(): Promise<ImportResult | null>
    backup(): Promise<string | null>
    backupNow(): Promise<BackupEntry>
    restore(filePath?: string): Promise<boolean>
    listBackups(): Promise<BackupEntry[]>
    storageInfo(): Promise<StorageInfo>
    openDataFolder(): Promise<void>
    cleanMedia(): Promise<number>
    resetAll(): Promise<void>
  }
  stats: {
    get(): Promise<StatsSummary>
  }
  art: {
    fetch(gameId: string): Promise<boolean>
    fetchAll(): Promise<{ updated: number; checked: number }>
  }
  update: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    download(): Promise<void>
    install(): Promise<void>
    postpone(): Promise<void>
  }
  win: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
  }
  app: {
    info(): Promise<AppInfo>
    showItemInFolder(path: string): Promise<void>
    openExternal(url: string): Promise<void>
  }
  files: {
    pathForFile(file: File): string
  }
  on(event: MainEvent, cb: (payload: any) => void): () => void
}
