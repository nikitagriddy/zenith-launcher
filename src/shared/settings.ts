import type { DeepPartial, Settings } from './types'

export const ACCENT_PRESETS: { hex: string; name: string }[] = [
  { hex: '#ff6b2c', name: 'Solar' },
  { hex: '#ffb340', name: 'Sodium' },
  { hex: '#e8ff59', name: 'Signal' },
  { hex: '#3ee08f', name: 'Aurora' },
  { hex: '#38c8f5', name: 'Ice' },
  { hex: '#5b7cff', name: 'Cobalt' },
  { hex: '#9d6bff', name: 'Nebula' },
  { hex: '#ff4f7b', name: 'Flare' },
  { hex: '#e9e2d3', name: 'Bone' }
]

export const DEFAULT_SETTINGS: Settings = {
  general: {
    confirmBeforeRemove: true,
    minimizeOnLaunch: true,
    restoreAfterExit: true,
    closeToTray: true,
    globalHotkey: 'Control+Alt+Z',
    showNotifications: true
  },
  launch: {
    defaultProfile: 'default',
    potatoResolution: '1280x720',
    potatoRenderScale: 50,
    boostPriority: true,
    boostGpu: true,
    boostPowerPlan: false,
    customArgs: '',
    customBoost: true
  },
  discord: {
    enabled: true,
    clientId: '',
    showElapsed: true,
    showPlaytime: true,
    showStore: true,
    showButton: true,
    showBrowsing: false,
    statusShows: 'launcher'
  },
  updates: {
    autoCheck: true,
    intervalHours: 6,
    installMode: 'auto'
  },
  appearance: {
    theme: 'dark',
    accent: '#ff6b2c',
    background: 'observatory',
    backgroundImage: '',
    backgroundBlur: 24,
    backgroundDim: 70,
    animations: true,
    glass: true,
    grain: true,
    sidebarCollapsed: false,
    sidebarStyle: 'glass',
    sidebarShowCategories: true,
    sidebarShowFavorites: true,
    uiScale: 100
  },
  library: {
    layout: 'grid',
    gridSize: 190,
    sortBy: 'name',
    sortDir: 'asc',
    showNotInstalled: true,
    showHidden: false,
    showCardInfo: true,
    autoArtwork: true
  },
  scanning: {
    folders: [],
    autoScanOnStartup: false,
    autoScanIntervalMin: 0,
    depth: 3,
    detectSteam: true,
    detectEpic: true,
    detectGog: true,
    detectEa: true,
    detectUbisoft: true,
    detectBattlenet: true,
    detectRiot: true,
    autoImport: true,
    excludeKeywords: []
  },
  startup: {
    launchOnLogin: false,
    startMinimized: false,
    startPage: 'home'
  },
  data: {
    autoBackup: 'weekly',
    keepBackups: 5
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Deep merge `patch` into `base`, only keeping keys that exist in `base` and match its type. */
export function mergeSettings<T>(base: T, patch: DeepPartial<T> | unknown): T {
  if (!isPlainObject(patch) || !isPlainObject(base)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const key of Object.keys(base as Record<string, unknown>)) {
    if (!(key in patch)) continue
    const b = (base as Record<string, unknown>)[key]
    const p = (patch as Record<string, unknown>)[key]
    if (isPlainObject(b)) out[key] = mergeSettings(b, p)
    else if (Array.isArray(b)) out[key] = Array.isArray(p) ? p.filter((x) => typeof x === typeof (b[0] ?? x)) : b
    else if (typeof p === typeof b) out[key] = p
  }
  return out as T
}
