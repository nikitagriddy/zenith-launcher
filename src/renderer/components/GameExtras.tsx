import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ExternalLink, HardDrive, Loader2, Newspaper, Play, RefreshCw, Trash2, WifiOff, X } from 'lucide-react'
import type { Game, GameExtras, InstallSize, UninstallInfo } from '@shared/types'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { cx, formatBytes, formatRelative } from '../lib/format'

export function useGameExtras(gameId: string, title: string) {
  const [data, setData] = useState<GameExtras | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setLoading(true)
    api.extras.get(gameId).then(
      (d) => alive && (setData(d), setLoading(false)),
      () => alive && (setData(null), setLoading(false))
    )
    return () => {
      alive = false
    }
  }, [gameId, title])
  return { data, loading }
}

function Trailer({ trailer }: { trailer: NonNullable<GameExtras['trailer']> }) {
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!playing || !videoRef.current) return
    const video = videoRef.current
    let hls: { destroy(): void } | null = null
    let cancelled = false
    const start = async () => {
      if (trailer.mp4) {
        video.src = trailer.mp4
      } else if (trailer.hls) {
        const { default: Hls } = await import('hls.js')
        if (cancelled) return
        if (!Hls.isSupported()) return setError(true)
        const h = new Hls({ enableWorker: false, capLevelToPlayerSize: true })
        h.on(Hls.Events.ERROR, (_e, d) => d.fatal && setError(true))
        h.loadSource(trailer.hls)
        h.attachMedia(video)
        hls = h
      }
      video.play().catch(() => undefined)
    }
    void start()
    return () => {
      cancelled = true
      hls?.destroy()
      video.removeAttribute('src')
    }
  }, [playing, trailer])

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-black ring-1 ring-line/10">
      {playing && !error ? (
        <video ref={videoRef} className="h-full w-full" controls autoPlay playsInline poster={trailer.thumbnail} />
      ) : (
        <button className="group absolute inset-0" onClick={() => (setError(false), setPlaying(true))} aria-label="Play trailer">
          <img src={trailer.thumbnail} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" alt="" />
          <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
          <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-on-accent shadow-2xl transition-transform group-hover:scale-110">
            <Play className="ml-1 h-7 w-7" fill="currentColor" />
          </span>
          <span className="absolute bottom-3 left-4 text-left">
            <span className="readout block !text-white/70">{error ? 'Trailer unavailable · retry' : 'Trailer'}</span>
            <span className="line-clamp-1 text-sm font-semibold text-white">{trailer.name}</span>
          </span>
        </button>
      )}
    </div>
  )
}

function Lightbox({ shots, index, onClose }: { shots: GameExtras['screenshots']; index: number; onClose: () => void }) {
  const [i, setI] = useState(index)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % shots.length)
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + shots.length) % shots.length)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [shots.length, onClose])
  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/90 p-10 animate-fade-in" onMouseDown={onClose}>
      <img src={shots[i]!.full} className="max-h-full max-w-full rounded-lg shadow-2xl" alt="" onMouseDown={(e) => e.stopPropagation()} />
      <button className="btn-icon absolute right-5 top-5 bg-black/50 text-white" onClick={onClose} aria-label="Close">
        <X className="h-5 w-5" />
      </button>
      {shots.length > 1 && (
        <>
          <button
            className="btn-icon absolute left-5 top-1/2 h-12 w-12 -translate-y-1/2 bg-black/50 text-white"
            onMouseDown={(e) => (e.stopPropagation(), setI((x) => (x - 1 + shots.length) % shots.length))}
            aria-label="Previous"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            className="btn-icon absolute right-5 top-1/2 h-12 w-12 -translate-y-1/2 bg-black/50 text-white"
            onMouseDown={(e) => (e.stopPropagation(), setI((x) => (x + 1) % shots.length))}
            aria-label="Next"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
          <div className="readout num absolute bottom-5 left-1/2 -translate-x-1/2 !text-white/70">
            {i + 1} / {shots.length}
          </div>
        </>
      )}
    </div>,
    document.body
  )
}

export function MediaSection({ extras, loading }: { extras: GameExtras | null; loading: boolean }) {
  const [box, setBox] = useState<number | null>(null)
  if (loading && !extras) {
    return (
      <section className="panel p-6">
        <div className="skeleton aspect-video rounded-xl" />
        <div className="mt-3 grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton aspect-video rounded-lg" />
          ))}
        </div>
      </section>
    )
  }
  if (!extras || (!extras.trailer && !extras.screenshots.length)) return null
  return (
    <section className="panel p-6 animate-page-in">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="section-title">Media</h2>
        {extras.storeUrl && (
          <button className="readout flex items-center gap-1 hover:!text-fg" onClick={() => void api.app.openExternal(extras.storeUrl!)}>
            Steam store page <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>
      {extras.trailer && <Trailer trailer={extras.trailer} />}
      {extras.screenshots.length > 0 && (
        <div className={cx('grid grid-cols-4 gap-2', extras.trailer && 'mt-3')}>
          {extras.screenshots.slice(0, 8).map((s, i) => (
            <button key={s.thumb} onClick={() => setBox(i)} className="group relative aspect-video overflow-hidden rounded-lg ring-1 ring-line/10">
              <img src={s.thumb} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110" alt="" />
              {i === 7 && extras.screenshots.length > 8 && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-semibold text-white">+{extras.screenshots.length - 8}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {box !== null && <Lightbox shots={extras.screenshots} index={box} onClose={() => setBox(null)} />}
    </section>
  )
}

export function NewsSection({ extras, loading }: { extras: GameExtras | null; loading: boolean }) {
  if (loading && !extras) return null
  if (extras?.offline) {
    return (
      <section className="panel flex items-center gap-3 p-5 text-sm text-muted">
        <WifiOff className="h-4 w-4" /> You’re offline - trailer, screenshots and news show up when you’re connected.
      </section>
    )
  }
  if (!extras?.news.length) return null
  return (
    <section className="panel p-6 animate-page-in">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="section-title">News</h2>
        <Newspaper className="h-4 w-4 text-muted" />
      </div>
      <div className="space-y-1">
        {extras.news.slice(0, 5).map((n) => (
          <button
            key={n.id}
            onClick={() => void api.app.openExternal(n.url)}
            className="group block w-full rounded-lg px-3 py-3 text-left transition-colors hover:bg-line/[0.04]"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-semibold group-hover:text-accent">{n.title}</span>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted opacity-0 group-hover:opacity-100" />
            </div>
            <div className="readout mt-1">
              {formatRelative(n.date)} · {n.author}
            </div>
            {n.excerpt && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{n.excerpt}</p>}
          </button>
        ))}
      </div>
    </section>
  )
}

/** Size on disk + uninstall, shown inside the Installation panel. */
export function InstallExtras({ game }: { game: Game }) {
  const { attempt, ask, toast } = useStore.getState()
  const [size, setSize] = useState<InstallSize | null | undefined>(undefined)
  const [sizing, setSizing] = useState(false)
  const [uninstall, setUninstall] = useState<UninstallInfo | null>(null)

  const loadSize = async (refresh = false) => {
    setSizing(true)
    try {
      setSize(await api.extras.size(game.id, refresh))
    } catch {
      setSize(null)
    } finally {
      setSizing(false)
    }
  }

  useEffect(() => {
    setSize(undefined)
    setUninstall(null)
    if (!game.installed) return
    void loadSize()
    void api.extras.uninstallInfo(game.id).then(setUninstall, () => setUninstall(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, game.installed, game.installDir])

  if (!game.installed) return null

  const doUninstall = async () => {
    const ok = await ask({
      title: `Uninstall ${game.title}?`,
      message: 'This starts the game’s own uninstaller (or its store app). Game files will be deleted from your PC. Your Zenith playtime history is kept.',
      confirmLabel: 'Uninstall',
      danger: true
    })
    if (!ok) return
    const label = await attempt(() => api.extras.uninstall(game.id), 'Could not start uninstaller')
    if (label) toast('info', 'Uninstaller started', `${label}. Zenith marks the game as not installed once its files are gone.`)
  }

  return (
    <div className="mt-2 border-t border-line/[0.06] pt-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="readout">Size on disk</div>
          <div className="num mt-1 flex items-center gap-2 text-base font-medium">
            <HardDrive className="h-4 w-4 text-muted" />
            {size === undefined || (sizing && !size) ? (
              <span className="flex items-center gap-1.5 text-sm text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Measuring…
              </span>
            ) : size ? (
              <span>
                {formatBytes(size.bytes)}
                {size.partial && '+'}
                <span className="ml-2 text-xs text-muted">{size.files.toLocaleString()} files</span>
              </span>
            ) : (
              <span className="text-sm text-muted">Unknown</span>
            )}
          </div>
        </div>
        <button className="btn-icon h-8 w-8" disabled={sizing} onClick={() => void loadSize(true)} title="Measure again">
          <RefreshCw className={cx('h-3.5 w-3.5', sizing && 'animate-spin')} />
        </button>
      </div>
      <button
        className="btn-danger mt-4 w-full"
        disabled={!uninstall?.available}
        onClick={() => void doUninstall()}
        title={uninstall?.label}
      >
        <Trash2 className="h-4 w-4" /> {uninstall ? (uninstall.available ? 'Uninstall game' : uninstall.label) : 'Checking uninstaller…'}
      </button>
    </div>
  )
}
