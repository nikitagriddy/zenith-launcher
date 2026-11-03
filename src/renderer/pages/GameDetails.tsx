import { useMemo, useRef, useState } from 'react'
import { LaunchModePicker } from '../components/LaunchModePicker'
import { effectiveMode, modeOf } from '../lib/modes'
import { AlertTriangle, ChevronDown, ChevronLeft, FolderOpen, MoreHorizontal, Pencil, Play, ShieldCheck, Star, Trash2 } from 'lucide-react'
import { SOURCE_LABELS, type Game } from '@shared/types'
import { InstallExtras, MediaSection, NewsSection, useGameExtras } from '../components/GameExtras'
import { api } from '../lib/api'
import { useGame, useStore } from '../lib/store'
import { cx, formatClock, formatDate, formatDateTime, formatPlaytime, formatRelative } from '../lib/format'
import { gameMenuItems } from '../lib/gameMenu'
import { useAsync, useNow } from '../lib/hooks'
import { AmbientArt, GameCover, GameIcon } from '../components/GameArt'
import { Empty, Toggle } from '../components/controls'

const SOURCE: Record<string, string> = { ...SOURCE_LABELS, scan: 'Folder scan' }

function PlayButton({ game }: { game: Game }) {
  const run = useStore((s) => s.running[game.id])
  const now = useNow(1000, !!run)
  if (run) {
    return (
      <div className="flex h-14 items-center gap-4 rounded-xl border border-accent/50 bg-accent/10 px-6">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
        </span>
        <div>
          <div className="readout !text-accent">
            {run.tracking === 'waiting' ? 'Waiting for game' : 'In session'}
            {run.profile && run.profile !== 'default' && ` · ${modeOf(run.profile).name} mode`}
          </div>
          <div className="num text-lg font-semibold leading-tight">{run.tracking === 'waiting' ? 'Starting…' : formatClock((now - run.startedAt) / 1000)}</div>
        </div>
      </div>
    )
  }
  return <SplitPlay game={game} />
}

function SplitPlay({ game }: { game: Game }) {
  const launch = useStore((s) => s.launch)
  const settings = useStore((s) => s.settings)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const mode = modeOf(effectiveMode(game, settings))
  return (
    <div ref={anchor} className="flex h-14">
      <button
        className="btn-primary h-14 min-w-[170px] rounded-xl rounded-r-none px-7 text-lg tracking-wide"
        disabled={!game.installed}
        onClick={() => void launch(game.id)}
        title={`Play (${mode.name} mode)`}
      >
        {mode.id === 'default' ? <Play className="h-5 w-5" fill="currentColor" /> : <mode.icon className="h-5 w-5" />}
        <span className="flex flex-col items-start leading-none">
          PLAY
          {mode.id !== 'default' && <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] opacity-80">{mode.name}</span>}
        </span>
      </button>
      <button
        className="btn-primary h-14 w-11 rounded-xl rounded-l-none border-l border-on-accent/20 px-0"
        disabled={!game.installed}
        onClick={() => setOpen((v) => !v)}
        aria-label="Choose launch mode"
        aria-expanded={open}
        title="Choose launch mode"
      >
        <ChevronDown className={cx('h-5 w-5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && anchor.current && <LaunchModePicker game={game} anchor={anchor.current} onClose={() => setOpen(false)} />}
    </div>
  )
}

function Readout({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-b border-line/[0.06] py-3.5 last:border-0">
      <div className="readout">{label}</div>
      <div className="num mt-1 text-base font-medium">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  )
}

function PathRow({ label, value, onOpen }: { label: string; value: string; onOpen?: () => void }) {
  return (
    <div className="py-2.5">
      <div className="readout mb-1">{label}</div>
      {value ? (
        <button
          disabled={!onOpen}
          onClick={onOpen}
          className="group flex w-full items-start gap-2 text-left font-mono text-[11px] leading-relaxed text-fg/80 enabled:hover:text-accent"
          title={value}
        >
          <span className="break-all">{value}</span>
          {onOpen && <FolderOpen className="mt-0.5 h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100" />}
        </button>
      ) : (
        <div className="font-mono text-[11px] text-muted">-</div>
      )}
    </div>
  )
}

export function GameDetailsPage({ id }: { id: string }) {
  const game = useGame(id)
  const categories = useStore((s) => s.categories)
  const { navigate, goBack, toggleFavorite, openEditor, removeGame, openMenu, attempt, toast } = useStore.getState()
  const lastPlayed = game?.lastPlayed
  const sessions = useAsync(() => api.games.sessions(id, 30), [id, lastPlayed, game?.playtimeSec])
  const extras = useGameExtras(id, game?.title ?? '')
  const engine = useAsync(() => api.games.launchPlans(id).then((p) => p.default.engine), [id, game?.exePath, game?.installDir])

  const maxSession = useMemo(() => Math.max(1, ...(sessions.data ?? []).map((s) => s.durationSec)), [sessions.data])

  if (!game) {
    return (
      <Empty icon={AlertTriangle} title="Game not found" text="It may have been removed from your library.">
        <button className="btn-ghost" onClick={() => navigate({ page: 'library' })}>
          Back to library
        </button>
      </Empty>
    )
  }

  const cats = categories.filter((c) => game.categoryIds.includes(c.id))
  const showItem = (p: string) => void attempt(() => api.app.showItemInFolder(p), 'Could not open location')

  return (
    <div className="pb-14">
      {/* Banner */}
      <div className="relative h-[360px] overflow-hidden">
        <AmbientArt game={game} className="animate-fade-in" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-bg/80 via-transparent to-transparent" />
        <div className="absolute left-8 top-6">
          <button className="readout flex items-center gap-1.5 rounded-lg bg-black/30 px-2.5 py-1.5 !text-white/80 backdrop-blur hover:!text-white" onClick={goBack}>
            <ChevronLeft className="h-3.5 w-3.5" /> Back
          </button>
        </div>
      </div>

      <div className="relative -mt-56 grid grid-cols-[240px_minmax(0,1fr)] gap-10 px-8">
        <div className="animate-page-in">
          <GameCover game={game} className="ticks aspect-[2/3] w-full rounded-xl shadow-2xl shadow-black/60 ring-1 ring-line/15" />
        </div>

        <div className="min-w-0 pt-20 animate-page-in" style={{ animationDelay: '60ms' }}>
          <div className="readout flex items-center gap-2">
            <span className="!text-accent">{SOURCE[game.source] ?? game.source}</span>
            {game.developer && (
              <>
                <span>·</span>
                <span>{game.developer}</span>
              </>
            )}
          </div>
          <h1 className="display mt-2 text-[42px] uppercase leading-[1.02]">{game.title}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {game.installed ? (
              <span className="chip !border-emerald-500/30 !text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Installed
              </span>
            ) : (
              <span className="chip !border-amber-500/30 !text-amber-400">
                <AlertTriangle className="h-3 w-3" /> Executable not found
              </span>
            )}
            {game.runAsAdmin && (
              <span className="chip">
                <ShieldCheck className="h-3 w-3 text-accent" /> Administrator
              </span>
            )}
            {cats.map((c) => (
              <button key={c.id} className="chip hover:text-fg" onClick={() => navigate({ page: 'library', categoryId: c.id })}>
                <span className="h-1.5 w-1.5 rotate-45 rounded-[1px]" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
          </div>

          <div className="mt-7 flex items-center gap-3">
            <PlayButton game={game} />
            <button
              className={cx('btn-ghost h-14 w-14 rounded-xl px-0', game.favorite && '!border-accent/50 !text-accent')}
              onClick={() => void toggleFavorite(game.id)}
              title={game.favorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star className="h-5 w-5" fill={game.favorite ? 'currentColor' : 'none'} />
            </button>
            <button className="btn-ghost h-14 rounded-xl px-5" onClick={() => openEditor(game.id)}>
              <Pencil className="h-4 w-4" /> Edit
            </button>
            <button className="btn-ghost h-14 w-14 rounded-xl px-0" onClick={(e) => openMenu(e.clientX, e.clientY, gameMenuItems(game))} title="More">
              <MoreHorizontal className="h-5 w-5" />
            </button>
            <button className="btn-danger h-14 w-14 rounded-xl px-0" onClick={() => void removeGame(game.id)} title="Remove from library">
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
          {!game.installed && (
            <p className="mt-3 text-sm text-amber-300/90">
              Zenith can’t find this game on disk. If you moved it,{' '}
              <button className="underline underline-offset-2 hover:text-amber-200" onClick={() => openEditor(game.id)}>
                point it to the new executable
              </button>
              .
            </p>
          )}
        </div>
      </div>

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)_320px] gap-6 px-8">
        <div className="space-y-6">
          <MediaSection extras={extras.data} loading={extras.loading} />
          <section className="panel p-6">
            <h2 className="section-title mb-3">About</h2>
            {game.description ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-fg/80">{game.description}</p>
            ) : (
              <p className="text-sm text-muted">
                No description yet.{' '}
                <button className="text-accent hover:underline" onClick={() => openEditor(game.id)}>
                  Add one
                </button>
              </p>
            )}
          </section>

          <section className="panel p-6">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="section-title">Session log</h2>
              <span className="readout num">{game.launchCount} launches</span>
            </div>
            {sessions.loading && !sessions.data ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-9 rounded-lg" />
                ))}
              </div>
            ) : (sessions.data ?? []).length === 0 ? (
              <p className="text-sm text-muted">No sessions recorded yet. Press Play - Zenith tracks how long you play automatically.</p>
            ) : (
              <div className="space-y-1">
                {sessions.data!.map((s) => (
                  <div key={s.id} className="grid grid-cols-[150px_minmax(0,1fr)_80px] items-center gap-4 rounded-lg px-2 py-2 hover:bg-line/[0.03]">
                    <span className="num text-xs text-muted">{formatDateTime(s.startedAt)}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-line/[0.06]">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(3, (s.durationSec / maxSession) * 100)}%` }} />
                    </span>
                    <span className="num text-right text-xs">{formatPlaytime(s.durationSec, '< 1 min')}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <NewsSection extras={extras.data} loading={extras.loading} />
        </div>

        <aside className="space-y-6">
          <section className="panel px-6 py-2">
            <Readout label="Total playtime" value={formatPlaytime(game.playtimeSec, '0 min')} />
            <Readout label="Last played" value={formatRelative(game.lastPlayed)} sub={game.lastPlayed ? formatDateTime(game.lastPlayed) : undefined} />
            <Readout label="Launches" value={String(game.launchCount)} />
            <Readout label="Added" value={formatDate(game.addedAt)} />
          </section>

          <section className="panel px-6 py-4">
            <div className="mb-1 flex items-center gap-3">
              <GameIcon game={game} size={36} />
              <h2 className="section-title">Installation</h2>
            </div>
            <div className="py-2.5">
              <div className="readout mb-1">Engine</div>
              <div className="text-sm">{engine.data ? engine.data.label : '…'}</div>
            </div>
            <PathRow label="Location" value={game.installDir} onOpen={() => void attempt(() => api.games.openFolder(game.id), 'Could not open folder')} />
            <PathRow label="Executable" value={game.exePath} onOpen={game.installed && game.exePath ? () => showItem(game.exePath) : undefined} />
            {game.launchUri && <PathRow label="Launch URI" value={game.launchUri} />}
            <PathRow label="Arguments" value={game.launchArgs} />
            <div className="mt-2 flex items-center justify-between border-t border-line/[0.06] pt-4">
              <div>
                <div className="text-sm font-medium">Run as administrator</div>
                <div className="text-xs text-muted">Prompts UAC on launch</div>
              </div>
              <Toggle
                checked={game.runAsAdmin}
                onChange={(v) =>
                  void attempt(async () => {
                    await api.games.update(game.id, { runAsAdmin: v })
                    toast('success', v ? 'Will run as administrator' : 'Will run normally')
                  })
                }
              />
            </div>
            <InstallExtras game={game} />
          </section>
        </aside>
      </div>
    </div>
  )
}
