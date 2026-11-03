import { memo } from 'react'
import { Play, Star, Loader2 } from 'lucide-react'
import type { Game } from '@shared/types'
import { useStore } from '../lib/store'
import { cx, formatHours, formatPlaytime, formatRelative } from '../lib/format'
import { openGameMenu } from '../lib/gameMenu'
import { GameCover, GameIcon } from './GameArt'

function StatusTag({ game, running }: { game: Game; running: boolean }) {
  if (running)
    return (
      <span className="flex items-center gap-1.5 rounded-md bg-accent px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-on-accent">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-on-accent" /> Live
      </span>
    )
  if (!game.installed)
    return (
      <span className="rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-white/70 backdrop-blur">
        Not installed
      </span>
    )
  return null
}

export const GameCard = memo(function GameCard({ game, width }: { game: Game; width?: number }) {
  const running = useStore((s) => !!s.running[game.id])
  const showInfo = useStore((s) => s.settings.library.showCardInfo)
  const { navigate, launch, toggleFavorite } = useStore.getState()

  return (
    <div
      className="game-card group cursor-pointer"
      style={width ? { width } : undefined}
      onClick={() => navigate({ page: 'game', id: game.id })}
      onDoubleClick={() => game.installed && !running && void launch(game.id)}
      onContextMenu={(e) => openGameMenu(e, game)}
    >
      <div
        className={cx(
          'relative overflow-hidden rounded-xl ring-1 transition-all duration-300 group-hover:-translate-y-1',
          running ? 'ring-2 ring-accent shadow-glow' : 'ring-line/10 shadow-card group-hover:shadow-glow group-hover:ring-accent/60'
        )}
      >
        <GameCover game={game} className="aspect-[2/3] w-full" imgClassName={!game.installed ? 'grayscale-[70%] opacity-70' : ''} />
        <div className="card-shine pointer-events-none absolute inset-0" />
        <div className="absolute left-2 top-2">
          <StatusTag game={game} running={running} />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            void toggleFavorite(game.id)
          }}
          className={cx(
            'absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg bg-black/45 backdrop-blur transition-all hover:bg-black/70',
            game.favorite ? 'text-accent opacity-100' : 'text-white/80 opacity-0 group-hover:opacity-100'
          )}
          aria-label="Toggle favorite"
        >
          <Star className="h-3.5 w-3.5" fill={game.favorite ? 'currentColor' : 'none'} />
        </button>
        {game.installed && (
          <div className="absolute inset-x-0 bottom-0 flex translate-y-2 items-end justify-between bg-gradient-to-t from-black/90 via-black/40 to-transparent p-3 pt-10 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (!running) void launch(game.id)
              }}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-xs font-bold uppercase tracking-wider text-on-accent shadow-lg shadow-black/40 transition-transform hover:scale-105"
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" fill="currentColor" />}
              {running ? 'Playing' : 'Play'}
            </button>
          </div>
        )}
      </div>
      {showInfo && (
        <div className="mt-2.5 px-0.5">
          <div className="truncate text-sm font-semibold text-fg/95 group-hover:text-fg">{game.title}</div>
          <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {game.playtimeSec > 0 ? `${formatHours(game.playtimeSec)} played` : 'Unplayed'}
            {game.lastPlayed > 0 && ` · ${formatRelative(game.lastPlayed)}`}
          </div>
        </div>
      )}
    </div>
  )
})

export const GameRow = memo(function GameRow({ game }: { game: Game }) {
  const running = useStore((s) => !!s.running[game.id])
  const { navigate, launch, toggleFavorite } = useStore.getState()
  return (
    <div
      className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_120px_140px_110px_auto] items-center gap-4 rounded-xl border border-transparent px-3 py-2 transition-colors hover:border-line/[0.08] hover:bg-line/[0.04]"
      onClick={() => navigate({ page: 'game', id: game.id })}
      onDoubleClick={() => game.installed && !running && void launch(game.id)}
      onContextMenu={(e) => openGameMenu(e, game)}
    >
      <div className="flex min-w-0 items-center gap-3">
        <GameIcon game={game} size={40} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{game.title}</span>
            {game.favorite && <Star className="h-3.5 w-3.5 shrink-0 text-accent" fill="currentColor" />}
          </div>
          <div className="truncate text-xs text-muted">{game.developer || game.installDir || game.exePath || '-'}</div>
        </div>
      </div>
      <div className="num text-xs text-fg/80">{formatPlaytime(game.playtimeSec, '-')}</div>
      <div className="text-xs text-muted">{formatRelative(game.lastPlayed)}</div>
      <div>
        {running ? (
          <span className="readout !text-accent">● Live</span>
        ) : game.installed ? (
          <span className="readout !text-emerald-400/90">Installed</span>
        ) : (
          <span className="readout">Missing</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          className="btn-icon opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            void toggleFavorite(game.id)
          }}
          aria-label="Favorite"
        >
          <Star className="h-4 w-4" fill={game.favorite ? 'currentColor' : 'none'} />
        </button>
        <button
          className="btn-primary h-8 px-3 text-xs"
          disabled={!game.installed || running}
          onClick={(e) => {
            e.stopPropagation()
            void launch(game.id)
          }}
        >
          <Play className="h-3.5 w-3.5" fill="currentColor" /> {running ? 'Playing' : 'Play'}
        </button>
      </div>
    </div>
  )
})

export const GameTile = memo(function GameTile({ game }: { game: Game }) {
  const running = useStore((s) => !!s.running[game.id])
  const { navigate, launch } = useStore.getState()
  return (
    <div
      className={cx(
        'group flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 transition-all hover:-translate-y-0.5',
        running ? 'border-accent/60 bg-accent/10' : 'border-line/[0.07] bg-surface/50 hover:border-accent/40 hover:bg-surface/80'
      )}
      onClick={() => navigate({ page: 'game', id: game.id })}
      onDoubleClick={() => game.installed && !running && void launch(game.id)}
      onContextMenu={(e) => openGameMenu(e, game)}
    >
      <GameIcon game={game} size={44} className={!game.installed ? 'opacity-50 grayscale' : ''} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{game.title}</div>
        <div className="num truncate text-[11px] text-muted">{formatPlaytime(game.playtimeSec, game.installed ? 'Unplayed' : 'Not installed')}</div>
      </div>
      {game.installed && (
        <button
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            if (!running) void launch(game.id)
          }}
          aria-label="Play"
        >
          <Play className="h-3.5 w-3.5" fill="currentColor" />
        </button>
      )}
    </div>
  )
})
