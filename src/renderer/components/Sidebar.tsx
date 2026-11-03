import { useMemo } from 'react'
import { BadgePercent, ChartNoAxesColumn, Compass, LibraryBig, PanelLeftClose, PanelLeftOpen, Plus, ScanSearch, Settings2 } from 'lucide-react'
import { useStore, type Route } from '../lib/store'
import { cx } from '../lib/format'
import { GameIcon } from './GameArt'

const NAV: { page: Route['page']; label: string; icon: typeof Compass; hint: string }[] = [
  { page: 'home', label: 'Overview', icon: Compass, hint: 'Ctrl+1' },
  { page: 'library', label: 'Library', icon: LibraryBig, hint: 'Ctrl+2' },
  { page: 'deals', label: 'Discount Games', icon: BadgePercent, hint: 'Ctrl+3' },
  { page: 'stats', label: 'Statistics', icon: ChartNoAxesColumn, hint: 'Ctrl+4' },
  { page: 'settings', label: 'Settings', icon: Settings2, hint: 'Ctrl+,' }
]

export function Sidebar() {
  const route = useStore((s) => s.route)
  const games = useStore((s) => s.games)
  const categories = useStore((s) => s.categories)
  const running = useStore((s) => s.running)
  const a = useStore((s) => s.settings.appearance)
  const dealsUnseen = useStore((s) => s.dealsUnseen)
  const { navigate, openEditor, setScanOpen, updateSettings } = useStore.getState()
  const collapsed = a.sidebarCollapsed

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of games) for (const c of g.categoryIds) m.set(c, (m.get(c) ?? 0) + 1)
    return m
  }, [games])
  const favorites = useMemo(() => games.filter((g) => g.favorite && !g.hidden).sort((x, y) => y.lastPlayed - x.lastPlayed).slice(0, 8), [games])

  const isActive = (page: Route['page']) => route.page === page || (page === 'library' && route.page === 'game')

  return (
    <aside
      className={cx(
        'relative z-20 flex shrink-0 flex-col transition-[width] duration-300',
        collapsed ? 'w-[72px]' : 'w-[232px]',
        a.sidebarStyle === 'glass' && 'glass border-y-0 border-l-0',
        a.sidebarStyle === 'solid' && 'border-r border-line/[0.07] bg-surface',
        a.sidebarStyle === 'floating' && 'glass m-3 mr-0 rounded-2xl'
      )}
    >
      <nav className="flex flex-col gap-0.5 p-3">
        {!collapsed && <div className="readout mb-2 px-3 pt-1">Navigate</div>}
        {NAV.map((n) => {
          const active = isActive(n.page)
          return (
            <button
              key={n.page}
              onClick={() => navigate({ page: n.page } as Route)}
              title={collapsed ? `${n.label} (${n.hint})` : n.hint}
              className={cx(
                'group relative flex h-10 items-center gap-3 rounded-lg text-sm font-medium transition-all',
                collapsed ? 'justify-center' : 'px-3',
                active ? 'bg-line/[0.07] text-fg' : 'text-muted hover:bg-line/[0.04] hover:text-fg'
              )}
            >
              <span
                className={cx(
                  'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent transition-all duration-300',
                  active ? 'opacity-100' : 'scale-y-0 opacity-0'
                )}
              />
              <n.icon className={cx('h-[18px] w-[18px] shrink-0', active && 'text-accent')} />
              {!collapsed && <span className="flex-1 text-left">{n.label}</span>}
              {!collapsed && n.page === 'library' && <span className="num text-[11px] text-muted">{games.filter((g) => !g.hidden).length}</span>}
              {n.page === 'deals' && dealsUnseen > 0 && (
                <span
                  className={cx(
                    'num flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent',
                    collapsed && 'absolute right-2 top-1'
                  )}
                  title={`${dealsUnseen} new free game${dealsUnseen === 1 ? '' : 's'}`}
                >
                  {dealsUnseen}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="no-scrollbar flex-1 overflow-y-auto px-3 pb-3">
        {a.sidebarShowCategories && !collapsed && (
          <div className="mt-3">
            <div className="readout mb-2 flex items-center justify-between px-3">
              <span>Collections</span>
              <button className="hover:text-fg" title="Manage collections" onClick={() => navigate({ page: 'settings', tab: 'library' })}>
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {categories.length === 0 && <div className="px-3 py-1 text-xs text-muted/70">No collections yet.</div>}
            {categories.map((c) => {
              const active = route.page === 'library' && route.categoryId === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => navigate({ page: 'library', categoryId: c.id })}
                  className={cx(
                    'flex h-8 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors',
                    active ? 'bg-line/[0.07] text-fg' : 'text-muted hover:bg-line/[0.04] hover:text-fg'
                  )}
                >
                  <span className="h-2 w-2 shrink-0 rotate-45 rounded-[2px]" style={{ background: c.color }} />
                  <span className="flex-1 truncate text-left">{c.name}</span>
                  <span className="num text-[11px] text-muted">{counts.get(c.id) ?? 0}</span>
                </button>
              )
            })}
          </div>
        )}

        {a.sidebarShowFavorites && favorites.length > 0 && (
          <div className="mt-5">
            {!collapsed && <div className="readout mb-2 px-3">Favorites</div>}
            <div className={cx('flex flex-col gap-0.5', collapsed && 'items-center')}>
              {favorites.map((g) => (
                <button
                  key={g.id}
                  onClick={() => navigate({ page: 'game', id: g.id })}
                  title={g.title}
                  className={cx(
                    'flex items-center gap-2.5 rounded-lg text-sm text-muted transition-colors hover:bg-line/[0.04] hover:text-fg',
                    collapsed ? 'p-1.5' : 'h-9 px-2',
                    route.page === 'game' && route.id === g.id && 'bg-line/[0.07] text-fg'
                  )}
                >
                  <span className="relative">
                    <GameIcon game={g} size={24} className="rounded-md" />
                    {running[g.id] && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-bg" />}
                  </span>
                  {!collapsed && <span className="truncate">{g.title}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={cx('flex gap-2 border-t border-line/[0.06] p-3', collapsed ? 'flex-col items-center' : 'flex-col')}>
        <button className={cx('btn-primary', collapsed ? 'h-10 w-10 px-0' : 'w-full')} onClick={() => openEditor()} title="Add game (Ctrl+N)">
          <Plus className="h-4 w-4" />
          {!collapsed && 'Add game'}
        </button>
        <div className={cx('flex gap-2', collapsed && 'flex-col')}>
          <button className={cx('btn-ghost', collapsed ? 'h-10 w-10 px-0' : 'flex-1')} onClick={() => setScanOpen(true)} title="Scan for games">
            <ScanSearch className="h-4 w-4" />
            {!collapsed && 'Scan'}
          </button>
          <button
            className={cx('btn-ghost', collapsed ? 'h-10 w-10 px-0' : 'w-10 px-0')}
            onClick={() => void updateSettings({ appearance: { sidebarCollapsed: !collapsed } })}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </aside>
  )
}
