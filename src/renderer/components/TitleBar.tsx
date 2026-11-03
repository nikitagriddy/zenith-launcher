import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, ImageDown, Minus, Search, Square, X } from 'lucide-react'
import type { ArtworkProgress } from '@shared/types'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { cx, formatClock } from '../lib/format'
import { useNow } from '../lib/hooks'
import { Wordmark } from './Logo'

function RunningIndicator() {
  const running = useStore((s) => s.running)
  const games = useStore((s) => s.games)
  const navigate = useStore((s) => s.navigate)
  const list = Object.values(running)
  const now = useNow(1000, list.length > 0)
  if (!list.length) return null
  const first = list[0]!
  const g = games.find((x) => x.id === first.gameId)
  return (
    <button
      onClick={() => g && navigate({ page: 'game', id: g.id })}
      className="no-drag flex h-8 items-center gap-2.5 rounded-lg border border-accent/40 bg-accent/10 px-3 transition-colors hover:bg-accent/20"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
      </span>
      <span className="readout !text-accent">{first.tracking === 'waiting' ? 'Starting' : 'In session'}</span>
      <span className="max-w-[160px] truncate text-xs font-semibold">{g?.title ?? 'Game'}</span>
      {first.tracking === 'process' && <span className="num text-xs text-fg/80">{formatClock((now - first.startedAt) / 1000)}</span>}
      {list.length > 1 && <span className="readout">+{list.length - 1}</span>}
    </button>
  )
}

function ArtworkIndicator() {
  const [p, setP] = useState<ArtworkProgress | null>(null)
  useEffect(() => api.on('art:progress', (x: ArtworkProgress) => setP(x.done >= x.total ? null : x)), [])
  if (!p) return null
  return (
    <div className="no-drag flex h-8 items-center gap-2.5 rounded-lg border border-line/[0.1] bg-surface/60 px-3" title={p.current}>
      <ImageDown className="h-3.5 w-3.5 animate-pulse text-accent" />
      <span className="readout">Artwork</span>
      <span className="num text-xs">
        {p.done}/{p.total}
      </span>
    </div>
  )
}

export function TitleBar() {
  const { goBack, goForward, setSearch, navigate } = useStore.getState()
  const canBack = useStore((s) => s.backStack.length > 0)
  const canFwd = useStore((s) => s.fwdStack.length > 0)
  const search = useStore((s) => s.search)
  const focusTick = useStore((s) => s.searchFocusTick)
  const route = useStore((s) => s.route)
  const [maximized, setMaximized] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void api.win.isMaximized().then(setMaximized)
    return api.on('win:maximized', (v: boolean) => setMaximized(v))
  }, [])

  useEffect(() => {
    if (focusTick) inputRef.current?.focus()
  }, [focusTick])

  return (
    <header className="drag relative z-30 flex h-12 shrink-0 items-center gap-3 border-b border-line/[0.06] bg-bg/40 pl-4 backdrop-blur-xl">
      <div className="w-[200px] shrink-0">
        <Wordmark />
      </div>
      <div className="no-drag flex items-center gap-0.5">
        <button className="btn-icon h-8 w-8" disabled={!canBack} onClick={goBack} title="Back (Alt+Left)" aria-label="Back">
          <ChevronLeft className={cx('h-4 w-4', !canBack && 'opacity-30')} />
        </button>
        <button className="btn-icon h-8 w-8" disabled={!canFwd} onClick={goForward} title="Forward (Alt+Right)" aria-label="Forward">
          <ChevronRight className={cx('h-4 w-4', !canFwd && 'opacity-30')} />
        </button>
      </div>

      <div className="no-drag relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            if (route.page !== 'library') navigate({ page: 'library' })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearch('')
              inputRef.current?.blur()
            }
          }}
          placeholder="Search your library"
          className="h-8 w-full rounded-lg border border-line/[0.08] bg-surface/60 pl-9 pr-16 text-sm outline-none transition-colors placeholder:text-muted/70 focus:border-accent/60 focus:bg-surface"
        />
        <kbd className="readout pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line/10 px-1.5 py-0.5 !text-[9px]">
          Ctrl K
        </kbd>
      </div>

      <div className="flex-1" />
      <ArtworkIndicator />
      <RunningIndicator />

      <div className="no-drag flex h-full items-center">
        <button className="flex h-full w-12 items-center justify-center text-muted hover:bg-line/[0.07] hover:text-fg" onClick={() => void api.win.minimize()} aria-label="Minimize">
          <Minus className="h-4 w-4" />
        </button>
        <button className="flex h-full w-12 items-center justify-center text-muted hover:bg-line/[0.07] hover:text-fg" onClick={() => void api.win.toggleMaximize()} aria-label="Maximize">
          {maximized ? <Copy className="h-3.5 w-3.5 -scale-x-100" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button className="flex h-full w-12 items-center justify-center text-muted hover:bg-red-600 hover:text-white" onClick={() => void api.win.close()} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}
