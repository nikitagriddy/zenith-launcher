import { create } from 'zustand'
import type { ComponentType } from 'react'
import type { Category, DeepPartial, FreeDealsResult, Game, GameInput, RunningInfo, Settings, ToastPayload } from '@shared/types'
import { DEFAULT_SETTINGS, mergeSettings } from '@shared/settings'
import { api } from './api'
import type { LibFilter } from './library'

export type SettingsTab = 'general' | 'appearance' | 'library' | 'scanning' | 'startup' | 'storage' | 'data' | 'shortcuts' | 'updates' | 'about'

export type Route =
  | { page: 'home' }
  | { page: 'library'; categoryId?: string; filter?: LibFilter }
  | { page: 'game'; id: string }
  | { page: 'stats' }
  | { page: 'deals' }
  | { page: 'settings'; tab?: SettingsTab }

export interface Toast extends ToastPayload {
  id: number
}

export interface MenuItem {
  label: string
  icon?: ComponentType<{ className?: string }>
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  checked?: boolean
}

interface ConfirmState {
  title: string
  message: string
  confirmLabel: string
  danger: boolean
  resolve: (ok: boolean) => void
}

interface State {
  booted: boolean
  games: Game[]
  categories: Category[]
  settings: Settings
  running: Record<string, RunningInfo>
  route: Route
  backStack: Route[]
  fwdStack: Route[]
  toasts: Toast[]
  editor: { open: boolean; gameId?: string; preset?: Partial<GameInput> }
  scanOpen: boolean
  confirm: ConfirmState | null
  menu: { x: number; y: number; items: MenuItem[] } | null
  search: string
  searchFocusTick: number
  deals: FreeDealsResult | null
  dealsLoading: boolean
  dealsError: string | null
  /** Free-now deals the user hasn't seen on the Discount Games page yet. */
  dealsUnseen: number
}

interface Actions {
  boot(): Promise<void>
  refreshGames(): Promise<void>
  refreshCategories(): Promise<void>
  navigate(route: Route): void
  goBack(): void
  goForward(): void
  updateSettings(patch: DeepPartial<Settings>): Promise<void>
  launch(id: string): Promise<void>
  toggleFavorite(id: string): Promise<void>
  removeGame(id: string): Promise<boolean>
  openEditor(gameId?: string, preset?: Partial<GameInput>): void
  closeEditor(): void
  setScanOpen(open: boolean): void
  toast(kind: Toast['kind'], title: string, message?: string): void
  dismissToast(id: number): void
  ask(opts: { title: string; message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>
  resolveConfirm(ok: boolean): void
  openMenu(x: number, y: number, items: MenuItem[]): void
  closeMenu(): void
  setSearch(s: string): void
  focusSearch(): void
  loadDeals(force: boolean): Promise<void>
  markDealsSeen(): void
  /** Run an async action, reporting failures as a toast. Returns undefined on failure. */
  attempt<T>(fn: () => Promise<T>, errorTitle?: string): Promise<T | undefined>
}

const SEEN_KEY = 'zenith.dealsSeen'
function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

let toastId = 1
let unsubscribers: (() => void)[] = []

const sameRoute = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b)

export const useStore = create<State & Actions>((set, get) => ({
  booted: false,
  games: [],
  categories: [],
  settings: DEFAULT_SETTINGS,
  running: {},
  route: { page: 'home' },
  backStack: [],
  fwdStack: [],
  toasts: [],
  editor: { open: false },
  scanOpen: false,
  confirm: null,
  menu: null,
  search: '',
  searchFocusTick: 0,
  deals: null,
  dealsLoading: false,
  dealsError: null,
  dealsUnseen: 0,

  async loadDeals(force) {
    if (get().dealsLoading) return
    set({ dealsLoading: true })
    try {
      const deals = await api.deals.list(force)
      const seen = readSeen()
      const unseen = deals.deals.filter((d) => !d.upcoming && !seen.has(d.id)).length
      set({ deals, dealsError: null, dealsUnseen: get().route.page === 'deals' ? 0 : unseen })
    } catch (err) {
      set({ dealsError: (err as Error).message })
    } finally {
      set({ dealsLoading: false })
    }
  },
  markDealsSeen() {
    const ids = (get().deals?.deals ?? []).filter((d) => !d.upcoming).map((d) => d.id)
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(ids))
    } catch {
      /* storage unavailable: badge just reappears next launch */
    }
    if (get().dealsUnseen) set({ dealsUnseen: 0 })
  },

  async boot() {
    const [settings, games, categories, running] = await Promise.all([
      api.settings.get(),
      api.games.list(),
      api.categories.list(),
      api.games.running()
    ])
    set({
      settings,
      games,
      categories,
      running: Object.fromEntries(running.map((r) => [r.gameId, r])),
      route: settings.startup.startPage === 'library' ? { page: 'library' } : { page: 'home' },
      booted: true
    })
    unsubscribers.forEach((u) => u())
    unsubscribers = [
      api.on('library:changed', () => {
        void get().refreshGames()
        void get().refreshCategories()
      }),
      api.on('settings:changed', (s: Settings) => set({ settings: s })),
      api.on('running:changed', (list: RunningInfo[]) =>
        set({ running: Object.fromEntries(list.map((r) => [r.gameId, r])) })
      ),
      api.on('toast', (t: ToastPayload) => get().toast(t.kind, t.title, t.message)),
      api.on('navigate', (r: Route) => get().navigate(r)),
      api.on('data:restored', () => window.location.reload())
    ]
    // Fill the Discount Games badge in the background; refresh every hour.
    setTimeout(() => void get().loadDeals(false), 3000)
    setInterval(() => void get().loadDeals(false), 3600_000)
  },

  async refreshGames() {
    try {
      set({ games: await api.games.list() })
    } catch (err) {
      get().toast('error', 'Could not load library', (err as Error).message)
    }
  },

  async refreshCategories() {
    try {
      set({ categories: await api.categories.list() })
    } catch (err) {
      get().toast('error', 'Could not load categories', (err as Error).message)
    }
  },

  navigate(route) {
    const { route: cur, backStack } = get()
    if (sameRoute(cur, route)) return
    set({ route, backStack: [...backStack.slice(-49), cur], fwdStack: [], menu: null })
  },
  goBack() {
    const { backStack, route, fwdStack } = get()
    const prev = backStack[backStack.length - 1]
    if (!prev) return
    set({ route: prev, backStack: backStack.slice(0, -1), fwdStack: [route, ...fwdStack] })
  },
  goForward() {
    const { backStack, route, fwdStack } = get()
    const next = fwdStack[0]
    if (!next) return
    set({ route: next, backStack: [...backStack, route], fwdStack: fwdStack.slice(1) })
  },

  async updateSettings(patch) {
    const prev = get().settings
    set({ settings: mergeSettings(prev, patch) })
    try {
      set({ settings: await api.settings.set(patch) })
    } catch (err) {
      set({ settings: prev })
      get().toast('error', 'Could not save settings', (err as Error).message)
    }
  },

  async launch(id) {
    const g = get().games.find((x) => x.id === id)
    try {
      await api.games.launch(id)
    } catch (err) {
      get().toast('error', g ? `Can't launch ${g.title}` : 'Launch failed', (err as Error).message)
    }
  },

  async toggleFavorite(id) {
    const games = get().games
    set({ games: games.map((g) => (g.id === id ? { ...g, favorite: !g.favorite } : g)) })
    const res = await get().attempt(() => api.games.toggleFavorite(id), 'Could not update favorite')
    if (!res) set({ games })
  },

  async removeGame(id) {
    const g = get().games.find((x) => x.id === id)
    if (!g) return false
    if (get().settings.general.confirmBeforeRemove) {
      const ok = await get().ask({
        title: `Remove ${g.title}?`,
        message: 'The game is removed from your Zenith library along with its playtime history. Game files on disk are not touched.',
        confirmLabel: 'Remove',
        danger: true
      })
      if (!ok) return false
    }
    const res = await get().attempt(() => api.games.remove(id).then(() => true), 'Could not remove game')
    if (!res) return false
    get().toast('success', 'Game removed', g.title)
    const r = get().route
    if (r.page === 'game' && r.id === id) get().navigate({ page: 'library' })
    return true
  },

  openEditor(gameId, preset) {
    set({ editor: { open: true, gameId, preset }, menu: null })
  },
  closeEditor() {
    set({ editor: { open: false } })
  },
  setScanOpen(open) {
    set({ scanOpen: open, menu: null })
  },

  toast(kind, title, message) {
    const id = toastId++
    set({ toasts: [...get().toasts.slice(-4), { id, kind, title, message }] })
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4200)
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },

  ask({ title, message, confirmLabel = 'Confirm', danger = false }) {
    return new Promise<boolean>((resolve) => set({ confirm: { title, message, confirmLabel, danger, resolve } }))
  },
  resolveConfirm(ok) {
    get().confirm?.resolve(ok)
    set({ confirm: null })
  },

  openMenu(x, y, items) {
    set({ menu: { x, y, items } })
  },
  closeMenu() {
    if (get().menu) set({ menu: null })
  },

  setSearch(search) {
    set({ search })
  },
  focusSearch() {
    set({ searchFocusTick: get().searchFocusTick + 1 })
  },

  async attempt(fn, errorTitle = 'Something went wrong') {
    try {
      return await fn()
    } catch (err) {
      get().toast('error', errorTitle, (err as Error).message)
      return undefined
    }
  }
}))

export const useGame = (id: string | undefined) => useStore((s) => (id ? s.games.find((g) => g.id === id) : undefined))
