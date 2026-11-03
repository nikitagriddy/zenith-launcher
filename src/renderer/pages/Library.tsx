import { useMemo } from 'react'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, List, Plus, Rows3, ScanSearch, SearchX, Gamepad2, X } from 'lucide-react'
import type { LibraryLayout, SortKey } from '@shared/types'
import { useStore, type Route } from '../lib/store'
import { filterGames, type LibFilter } from '../lib/library'
import { cx } from '../lib/format'
import { Empty, Segmented, Select, Slider } from '../components/controls'
import { GameCard, GameRow, GameTile } from '../components/GameCard'

const FILTERS: { value: LibFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'installed', label: 'Installed' },
  { value: 'favorites', label: 'Favorites' },
  { value: 'recent', label: 'Played' },
  { value: 'neverPlayed', label: 'Unplayed' },
  { value: 'notInstalled', label: 'Missing' },
  { value: 'hidden', label: 'Hidden' }
]

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'lastPlayed', label: 'Recently played' },
  { value: 'playtime', label: 'Playtime' },
  { value: 'added', label: 'Date added' }
]

export function LibraryPage({ route }: { route: Extract<Route, { page: 'library' }> }) {
  const games = useStore((s) => s.games)
  const categories = useStore((s) => s.categories)
  const settings = useStore((s) => s.settings)
  const search = useStore((s) => s.search)
  const { navigate, updateSettings, openEditor, setScanOpen, setSearch } = useStore.getState()
  const lib = settings.library
  const filter = route.filter ?? 'all'
  const category = categories.find((c) => c.id === route.categoryId)

  const list = useMemo(
    () => filterGames(games, { search, filter, categoryId: route.categoryId, sortBy: lib.sortBy, sortDir: lib.sortDir }, settings),
    [games, search, filter, route.categoryId, lib.sortBy, lib.sortDir, settings]
  )

  const setRoute = (patch: Partial<Extract<Route, { page: 'library' }>>) => navigate({ page: 'library', categoryId: route.categoryId, filter, ...patch })

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-line/[0.06] bg-bg/70 px-8 pb-4 pt-7 backdrop-blur-xl">
        <div className="flex items-end justify-between gap-6 animate-page-in">
          <div className="min-w-0">
            <div className="readout flex items-center gap-2">
              <span className="!text-accent">{category ? 'Collection' : 'Library'}</span>
              <span className="num">· {list.length} shown</span>
            </div>
            <div className="mt-1 flex items-center gap-3">
              {category && <span className="h-3 w-3 rotate-45 rounded-[3px]" style={{ background: category.color }} />}
              <h1 className="display truncate text-3xl uppercase">{category ? category.name : 'All games'}</h1>
              {category && (
                <button className="btn-icon h-8 w-8" onClick={() => setRoute({ categoryId: undefined })} title="Show all games">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button className="btn-ghost" onClick={() => setScanOpen(true)}>
              <ScanSearch className="h-4 w-4" /> Scan
            </button>
            <button className="btn-primary" onClick={() => openEditor()}>
              <Plus className="h-4 w-4" /> Add game
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setRoute({ filter: f.value })}
                className={cx(
                  'h-8 rounded-lg px-3 text-xs font-semibold transition-colors',
                  filter === f.value ? 'bg-fg text-bg' : 'text-muted hover:bg-line/[0.06] hover:text-fg'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {search && (
            <button className="chip h-8 gap-2" onClick={() => setSearch('')}>
              “{search}” <X className="h-3 w-3" />
            </button>
          )}
          <Select
            className="h-8 w-44 text-xs"
            value={lib.sortBy}
            options={SORTS}
            onChange={(v) => void updateSettings({ library: { sortBy: v, sortDir: v === 'name' ? 'asc' : 'desc' } })}
          />
          <button
            className="btn-ghost h-8 w-8 px-0"
            title={lib.sortDir === 'asc' ? 'Ascending' : 'Descending'}
            onClick={() => void updateSettings({ library: { sortDir: lib.sortDir === 'asc' ? 'desc' : 'asc' } })}
          >
            {lib.sortDir === 'asc' ? <ArrowUpNarrowWide className="h-4 w-4" /> : <ArrowDownWideNarrow className="h-4 w-4" />}
          </button>
          {lib.layout === 'grid' && (
            <div className="w-48 shrink-0">
              <Slider value={lib.gridSize} min={130} max={320} step={10} onChange={(v) => void updateSettings({ library: { gridSize: v } })} format={(v) => `${v}px`} />
            </div>
          )}
          <Segmented<LibraryLayout>
            size="sm"
            value={lib.layout}
            onChange={(v) => void updateSettings({ library: { layout: v } })}
            options={[
              { value: 'grid', label: <LayoutGrid className="h-3.5 w-3.5" />, title: 'Grid' },
              { value: 'compact', label: <Rows3 className="h-3.5 w-3.5" />, title: 'Compact' },
              { value: 'list', label: <List className="h-3.5 w-3.5" />, title: 'List' }
            ]}
          />
        </div>
      </div>

      <div className="flex-1 px-8 py-7">
        {games.length === 0 ? (
          <Empty icon={Gamepad2} title="No games yet" text="Scan your drives for installed games or add one manually. You can also drop an .exe onto this window.">
            <button className="btn-primary" onClick={() => setScanOpen(true)}>
              <ScanSearch className="h-4 w-4" /> Scan for games
            </button>
            <button className="btn-ghost" onClick={() => openEditor()}>
              <Plus className="h-4 w-4" /> Add manually
            </button>
          </Empty>
        ) : list.length === 0 ? (
          <Empty icon={SearchX} title="Nothing matches" text="Try a different filter or search term.">
            <button
              className="btn-ghost"
              onClick={() => {
                setSearch('')
                navigate({ page: 'library' })
              }}
            >
              Clear filters
            </button>
          </Empty>
        ) : lib.layout === 'grid' ? (
          <div key={`${filter}-${route.categoryId}`} className="stagger grid gap-x-5 gap-y-7" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${lib.gridSize}px, 1fr))` }}>
            {list.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
        ) : lib.layout === 'compact' ? (
          <div key={`${filter}-${route.categoryId}`} className="stagger grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {list.map((g) => (
              <GameTile key={g.id} game={g} />
            ))}
          </div>
        ) : (
          <div className="animate-page-in">
            <div className="readout grid grid-cols-[minmax(0,1fr)_120px_140px_110px_auto] gap-4 border-b border-line/[0.07] px-3 pb-2">
              <span>Title</span>
              <span>Playtime</span>
              <span>Last played</span>
              <span>Status</span>
              <span className="w-[136px]" />
            </div>
            <div className="mt-1 space-y-0.5">
              {list.map((g) => (
                <GameRow key={g.id} game={g} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
