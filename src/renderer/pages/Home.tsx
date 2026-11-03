import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, ChartNoAxesColumn, Download, Info, LibraryBig, Play, Plus, ScanSearch, Settings2, Star } from 'lucide-react'
import type { Game } from '@shared/types'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { cx, formatHours, formatPlaytime, formatRelative } from '../lib/format'
import { visibleGames } from '../lib/library'
import { useNow } from '../lib/hooks'
import { AmbientArt, GameCover } from '../components/GameArt'
import { GameCard } from '../components/GameCard'
import { Shelf } from '../components/Shelf'
import { LogoMark } from '../components/Logo'

const SLIDE_MS = 9000

function FeaturedHero({ pool }: { pool: Game[] }) {
  const [i, setI] = useState(0)
  const running = useStore((s) => s.running)
  const { launch, navigate, toggleFavorite } = useStore.getState()
  const animations = useStore((s) => s.settings.appearance.animations)

  useEffect(() => {
    if (pool.length < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % pool.length), SLIDE_MS)
    return () => clearInterval(t)
  }, [pool.length, i])

  const g = pool[i % pool.length]
  if (!g) return null
  const isRunning = !!running[g.id]

  return (
    <section className="relative h-[400px] overflow-hidden rounded-3xl border border-line/[0.08] bg-surface">
      <div key={g.id} className="absolute inset-0 animate-fade-in">
        <AmbientArt game={g} />
        <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/80 to-bg/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg/90 via-transparent to-transparent" />
      </div>

      <div className="relative flex h-full items-stretch">
        <div key={`c-${g.id}`} className="flex min-w-0 flex-1 flex-col justify-end p-10 animate-page-in">
          <div className="readout mb-4 flex items-center gap-3">
            <span className="!text-accent">Featured</span>
            <span className="h-px w-8 bg-line/30" />
            <span className="num">
              {String((i % pool.length) + 1).padStart(2, '0')} / {String(pool.length).padStart(2, '0')}
            </span>
          </div>
          <h1 className="display line-clamp-2 max-w-2xl text-[44px] uppercase leading-[1.02] text-fg">{g.title}</h1>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Stat label="Played" value={formatPlaytime(g.playtimeSec, '0 min')} />
            <Stat label="Last session" value={formatRelative(g.lastPlayed)} />
            <Stat label="Status" value={isRunning ? 'Running' : g.installed ? 'Ready' : 'Not installed'} accent={isRunning} />
          </div>
          {g.description && <p className="mt-4 line-clamp-2 max-w-xl text-sm leading-relaxed text-fg/70">{g.description}</p>}
          <div className="mt-7 flex items-center gap-3">
            <button className="btn-primary h-12 px-7 text-base" disabled={!g.installed || isRunning} onClick={() => void launch(g.id)}>
              <Play className="h-5 w-5" fill="currentColor" /> {isRunning ? 'Playing' : 'Play'}
            </button>
            <button className="btn-ghost h-12 px-5" onClick={() => navigate({ page: 'game', id: g.id })}>
              <Info className="h-4 w-4" /> Details
            </button>
            <button className={cx('btn-ghost h-12 w-12 px-0', g.favorite && '!text-accent')} onClick={() => void toggleFavorite(g.id)} aria-label="Favorite">
              <Star className="h-5 w-5" fill={g.favorite ? 'currentColor' : 'none'} />
            </button>
          </div>
        </div>

        <div className="hidden shrink-0 items-center pr-12 xl:flex">
          <div key={`a-${g.id}`} className="w-[210px] rotate-[2.5deg] animate-pop-in">
            <GameCover game={g} className="ticks aspect-[2/3] rounded-xl shadow-2xl shadow-black/60 ring-1 ring-line/15" />
          </div>
        </div>
      </div>

      {pool.length > 1 && (
        <div className="absolute bottom-5 right-8 flex gap-2">
          {pool.map((p, idx) => (
            <button key={p.id} onClick={() => setI(idx)} className="h-6 w-10 py-2.5" aria-label={`Show ${p.title}`}>
              <span className="block h-[3px] w-full overflow-hidden rounded-full bg-line/20">
                {idx === i % pool.length && (
                  <span
                    key={`${p.id}-${i}`}
                    className="block h-full bg-accent"
                    style={animations ? { animation: `grow ${SLIDE_MS}ms linear forwards` } : { width: '100%' }}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="readout">{label}</div>
      <div className={cx('num mt-0.5 text-sm font-medium', accent ? 'text-accent' : 'text-fg/90')}>{value}</div>
    </div>
  )
}

function Instruments({ games }: { games: Game[] }) {
  const [week, setWeek] = useState<number | null>(null)
  useEffect(() => {
    void api.stats.get().then((s) => setWeek(s.weekSeconds), () => setWeek(0))
  }, [games])
  const total = games.reduce((a, g) => a + g.playtimeSec, 0)
  const installed = games.filter((g) => g.installed).length
  const items = [
    { label: 'Games in library', value: String(games.length), sub: `${games.filter((g) => g.favorite).length} favorites` },
    { label: 'Total playtime', value: formatHours(total), sub: `${games.reduce((a, g) => a + g.launchCount, 0)} launches` },
    { label: 'Last 7 days', value: week === null ? '…' : formatHours(week), sub: 'tracked play' },
    { label: 'Installed', value: `${installed}/${games.length}`, sub: games.length - installed ? `${games.length - installed} missing` : 'all ready' }
  ]
  return (
    <section className="grid grid-cols-4 divide-x divide-line/[0.07] overflow-hidden rounded-2xl border border-line/[0.08] bg-surface/50 stagger">
      {items.map((it) => (
        <div key={it.label} className="relative px-6 py-5">
          <div className="readout">{it.label}</div>
          <div className="num mt-2 text-[28px] font-semibold leading-none tracking-tight text-fg">{it.value}</div>
          <div className="mt-2 text-xs text-muted">{it.sub}</div>
        </div>
      ))}
    </section>
  )
}

function ContinueCard({ game }: { game: Game }) {
  const running = useStore((s) => !!s.running[game.id])
  const { launch, navigate } = useStore.getState()
  useNow(60_000)
  return (
    <div
      className="game-card group relative h-[170px] w-[360px] shrink-0 cursor-pointer overflow-hidden rounded-2xl border border-line/[0.08] transition-all duration-300 hover:-translate-y-1 hover:border-accent/50 hover:shadow-glow"
      onClick={() => navigate({ page: 'game', id: game.id })}
    >
      <GameCover game={game} variant="landscape" className="absolute inset-0" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-black/10" />
      <div className="relative flex h-full flex-col justify-between p-5">
        <div className="readout !text-white/60">{running ? '● Live now' : formatRelative(game.lastPlayed)}</div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="line-clamp-2 font-display text-base font-semibold uppercase leading-tight text-white">{game.title}</div>
            <div className="num mt-1 text-xs text-white/60">{formatPlaytime(game.playtimeSec)} total</div>
          </div>
          <button
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent shadow-lg transition-transform hover:scale-110 disabled:opacity-40"
            disabled={!game.installed || running}
            onClick={(e) => {
              e.stopPropagation()
              void launch(game.id)
            }}
            aria-label={`Play ${game.title}`}
          >
            <Play className="h-5 w-5" fill="currentColor" />
          </button>
        </div>
      </div>
    </div>
  )
}

function QuickAccess() {
  const { navigate, openEditor, setScanOpen } = useStore.getState()
  const items = [
    { icon: LibraryBig, label: 'Library', text: 'Browse everything', onClick: () => navigate({ page: 'library' }) },
    { icon: ScanSearch, label: 'Scan', text: 'Find installed games', onClick: () => setScanOpen(true) },
    { icon: Plus, label: 'Add game', text: 'Any .exe or shortcut', onClick: () => openEditor() },
    { icon: ChartNoAxesColumn, label: 'Statistics', text: 'Your play history', onClick: () => navigate({ page: 'stats' }) },
    { icon: Settings2, label: 'Settings', text: 'Make it yours', onClick: () => navigate({ page: 'settings' }) }
  ]
  return (
    <section className="animate-page-in">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="readout !text-accent">—</span>
        <h2 className="section-title">Quick access</h2>
      </div>
      <div className="grid grid-cols-5 gap-3 stagger">
        {items.map((it) => (
          <button
            key={it.label}
            onClick={it.onClick}
            className="group flex items-center gap-3 rounded-xl border border-line/[0.08] bg-surface/50 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:bg-surface/80"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20 transition-colors group-hover:bg-accent group-hover:text-on-accent">
              <it.icon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{it.label}</span>
              <span className="block truncate text-xs text-muted">{it.text}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function Onboarding() {
  const { openEditor, setScanOpen, attempt, toast } = useStore.getState()
  const importLib = async () => {
    const r = await attempt(() => api.data.importLibrary(), 'Import failed')
    if (r) toast('success', `Imported ${r.added} games`, r.skipped ? `${r.skipped} skipped` : undefined)
  }
  return (
    <section className="relative overflow-hidden rounded-3xl border border-line/[0.08] bg-surface/40 px-12 py-16">
      <div className="starfield absolute inset-0 opacity-60" />
      <div className="absolute -right-24 -top-40 h-[420px] w-[420px] rounded-full border border-accent/20" />
      <div className="absolute -right-10 -top-24 h-[300px] w-[300px] rounded-full border border-accent/10" />
      <div className="absolute right-[150px] top-[54px] h-4 w-4 rounded-full bg-accent shadow-[0_0_40px_10px_rgb(var(--accent)/0.5)]" />
      <div className="relative max-w-2xl animate-page-in">
        <LogoMark size={44} />
        <div className="readout mt-8 !text-accent">Alt 90° · Az 000°</div>
        <h1 className="display mt-3 text-[52px] uppercase leading-[0.98]">
          Your sky
          <br />
          is empty.
        </h1>
        <p className="mt-5 max-w-lg text-base leading-relaxed text-fg/70">
          Zenith keeps every game you own in one place - Steam, Epic, or a folder of DRM-free classics. Scan your drives or add a game by hand to get started.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <button className="btn-primary h-12 px-6 text-base" onClick={() => setScanOpen(true)}>
            <ScanSearch className="h-5 w-5" /> Scan for games
          </button>
          <button className="btn-ghost h-12 px-5" onClick={() => openEditor()}>
            <Plus className="h-4 w-4" /> Add manually
          </button>
          <button className="btn-ghost h-12 px-5" onClick={() => void importLib()}>
            <Download className="h-4 w-4" /> Import library
          </button>
        </div>
        <div className="mt-6 text-xs text-muted">Tip: drag any .exe file onto this window to add it.</div>
      </div>
    </section>
  )
}

export function HomePage() {
  const all = useStore((s) => s.games)
  const settings = useStore((s) => s.settings)
  const navigate = useStore((s) => s.navigate)
  const games = useMemo(() => visibleGames(all, settings), [all, settings])

  const recent = useMemo(() => games.filter((g) => g.lastPlayed > 0).sort((a, b) => b.lastPlayed - a.lastPlayed), [games])
  const favorites = useMemo(() => games.filter((g) => g.favorite).sort((a, b) => b.lastPlayed - a.lastPlayed), [games])
  const added = useMemo(() => [...games].sort((a, b) => b.addedAt - a.addedAt), [games])
  const featured = useMemo(() => {
    // Rotate through favorites, most-played and newest arrivals; reshuffles daily.
    const seed = new Date().toDateString()
    const picks = new Map<string, Game>()
    for (const g of [...favorites.slice(0, 3), ...[...games].sort((a, b) => b.playtimeSec - a.playtimeSec).slice(0, 3), ...added.slice(0, 2)]) {
      if (g.installed) picks.set(g.id, g)
    }
    if (picks.size === 0) for (const g of games.slice(0, 5)) picks.set(g.id, g)
    const list = [...picks.values()].slice(0, 6)
    let h = 0
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
    return list.map((g, i) => ({ g, k: (h + i * 2654435761) % 1000 })).sort((a, b) => a.k - b.k).map((x) => x.g)
  }, [games, favorites, added])

  if (games.length === 0) {
    return (
      <div className="space-y-10 p-8">
        <Onboarding />
        <QuickAccess />
      </div>
    )
  }

  const hour = new Date().getHours()
  const greeting = hour < 5 ? 'Late night session' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const seeAll = (label = 'See all', onClick = () => navigate({ page: 'library' })) => (
    <button className="readout mr-2 flex items-center gap-1 hover:!text-fg" onClick={onClick}>
      {label} <ArrowUpRight className="h-3 w-3" />
    </button>
  )

  return (
    <div className="space-y-10 p-8 pb-14">
      <div className="flex items-end justify-between animate-page-in">
        <div>
          <div className="readout">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <h1 className="display mt-1 text-2xl uppercase">{greeting}</h1>
        </div>
      </div>

      <FeaturedHero pool={featured} />
      <Instruments games={games} />

      {recent.length > 0 && (
        <Shelf index="01" title="Continue playing" action={seeAll('History', () => navigate({ page: 'stats' }))}>
          {recent.slice(0, 6).map((g) => (
            <ContinueCard key={g.id} game={g} />
          ))}
        </Shelf>
      )}
      {recent.length > 0 && (
        <Shelf index="02" title="Recently played" action={seeAll()}>
          {recent.slice(0, 14).map((g) => (
            <GameCard key={g.id} game={g} width={176} />
          ))}
        </Shelf>
      )}
      {favorites.length > 0 && (
        <Shelf index="03" title="Favorites" action={seeAll('All favorites', () => navigate({ page: 'library', filter: 'favorites' }))}>
          {favorites.slice(0, 14).map((g) => (
            <GameCard key={g.id} game={g} width={176} />
          ))}
        </Shelf>
      )}
      <Shelf index="04" title="Recently added" action={seeAll()}>
        {added.slice(0, 14).map((g) => (
          <GameCard key={g.id} game={g} width={176} />
        ))}
      </Shelf>
      <QuickAccess />
    </div>
  )
}
