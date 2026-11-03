import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MainEvent, ZenithApi } from '../shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as { ok: boolean; data?: T; error?: string }
  if (!res.ok) throw new Error(res.error ?? 'Unknown error')
  return res.data as T
}

const listeners = new Map<string, Set<(payload: unknown) => void>>()
ipcRenderer.on('zenith:event', (_e, event: string, payload: unknown) => {
  listeners.get(event)?.forEach((cb) => {
    try {
      cb(payload)
    } catch (err) {
      console.error(err)
    }
  })
})

const api: ZenithApi = {
  games: {
    list: () => invoke('games:list'),
    add: (input) => invoke('games:add', input),
    update: (id, patch) => invoke('games:update', id, patch),
    remove: (id) => invoke('games:remove', id),
    toggleFavorite: (id) => invoke('games:toggleFavorite', id),
    setCategories: (id, ids) => invoke('games:setCategories', id, ids),
    launch: (id) => invoke('games:launch', id),
    running: () => invoke('games:running'),
    openFolder: (id) => invoke('games:openFolder', id),
    createShortcut: (id, where) => invoke('games:createShortcut', id, where),
    extractIcon: (exe) => invoke('games:extractIcon', exe),
    sessions: (gameId, limit) => invoke('games:sessions', gameId, limit),
    clearPlaytime: (id) => invoke('games:clearPlaytime', id)
  },
  categories: {
    list: () => invoke('categories:list'),
    create: (name, color) => invoke('categories:create', name, color),
    update: (id, patch) => invoke('categories:update', id, patch),
    remove: (id) => invoke('categories:remove', id)
  },
  scan: {
    run: (opts) => invoke('scan:run', opts),
    importCandidates: (c) => invoke('scan:import', c)
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch)
  },
  dialog: {
    openFile: (opts) => invoke('dialog:openFile', opts),
    openFolder: (title) => invoke('dialog:openFolder', title)
  },
  media: {
    importFile: (file, prefix) => invoke('media:import', file, prefix)
  },
  data: {
    exportLibrary: () => invoke('data:exportLibrary'),
    importLibrary: () => invoke('data:importLibrary'),
    backup: () => invoke('data:backup'),
    backupNow: () => invoke('data:backupNow'),
    restore: (file) => invoke('data:restore', file),
    listBackups: () => invoke('data:listBackups'),
    storageInfo: () => invoke('data:storageInfo'),
    openDataFolder: () => invoke('data:openDataFolder'),
    cleanMedia: () => invoke('data:cleanMedia'),
    resetAll: () => invoke('data:resetAll')
  },
  stats: {
    get: () => invoke('stats:get')
  },
  win: {
    minimize: () => invoke('win:minimize'),
    toggleMaximize: () => invoke('win:toggleMaximize'),
    close: () => invoke('win:close'),
    isMaximized: () => invoke('win:isMaximized')
  },
  app: {
    info: () => invoke('app:info'),
    showItemInFolder: (p) => invoke('app:showItemInFolder', p),
    openExternal: (url) => invoke('app:openExternal', url)
  },
  files: {
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  on(event: MainEvent, cb) {
    let set = listeners.get(event)
    if (!set) listeners.set(event, (set = new Set()))
    set.add(cb)
    return () => set!.delete(cb)
  }
}

contextBridge.exposeInMainWorld('zenith', api)
