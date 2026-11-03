import { useMemo, useState } from 'react'
import { ChartNoAxesColumn, History } from 'lucide-react'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { cx, formatDateTime, formatHours, formatPlaytime } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { Empty } from '../components/controls'
import { GameIcon } from '../components/GameArt'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function niceMax(v: number): number {
  if (v <= 0) return 3600
  const hours = v / 3600
  const step = hours <= 1 ? 0.25 : hours <= 3 ? 0.5 : hours <= 8 ? 1 : 2
  return Math.ceil(hours / step) * step * 3600
}

function DailyChart({ data }: { data: { date: string; seconds: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(...data.map((d) => d.seconds)))
  const ticks = [1, 0.75, 0.5, 0.25, 0]
  return (
    <div className="relative">
      <div className="flex h-56">
        <div className="flex w-12 flex-col justify-between pb-6 pr-2 text-right">
          {ticks.map((t) => (
            <span key={t} className="num text-[10px] text-muted">
              {formatHours(max * t)}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          <div className="absolute inset-x-0 bottom-6 top-0 flex flex-col justify-between">
            {ticks.map((t) => (
              <div key={t} className={cx('border-t', t === 0 ? 'border-line/20' : 'border-dashed border-line/[0.07]')} />
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-6 top-0 flex items-end gap-[3px]">
            {data.map((d, i) => {
              const today = i === data.length - 1
              return (
                <div
                  key={d.date}
                  className="group relative flex h-full flex-1 items-end"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <div
                    className={cx(
                      'w-full rounded-t-[3px] transition-all duration-500',
                      d.seconds ? (today ? 'bg-accent' : 'bg-accent/60 group-hover:bg-accent') : 'bg-line/[0.05]'
                    )}
                    style={{ height: d.seconds ? `${Math.max(2, (d.seconds / max) * 100)}%` : '2px' }}
                  />
                  {hover === i && (
                    <div className="glass pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg px-3 py-2 shadow-xl">
                      <div className="readout">{new Date(d.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                      <div className="num text-sm font-semibold">{formatPlaytime(d.seconds, 'No play')}</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="absolute inset-x-0 bottom-0 flex justify-between">
            {data
              .filter((_, i) => i % 5 === 0 || i === data.length - 1)
              .map((d) => (
                <span key={d.date} className="num text-[10px] text-muted">
                  {new Date(d.date + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function StatsPage() {
  const games = useStore((s) => s.games)
  const navigate = useStore((s) => s.navigate)
  const stamp = games.reduce((a, g) => a + g.playtimeSec + g.lastPlayed, 0)
  const stats = useAsync(() => api.stats.get(), [stamp])
  const history = useAsync(() => api.games.sessions(undefined, 60), [stamp])
  const gameMap = useMemo(() => new Map(games.map((g) => [g.id, g])), [games])

  const s = stats.data
  if (stats.error) return <Empty icon={ChartNoAxesColumn} title="Could not load statistics" text={stats.error} />

  const maxTop = Math.max(1, ...(s?.topGames ?? []).map((t) => t.seconds))
  const maxWd = Math.max(1, ...(s?.byWeekday ?? [0]))
  const tiles = [
    { label: 'Total playtime', value: s ? formatHours(s.totalPlaytimeSec) : '…' },
    { label: 'Sessions', value: s ? String(s.totalSessions) : '…' },
    { label: 'Average session', value: s ? formatPlaytime(s.avgSessionSec, '-') : '…' },
    { label: 'Longest session', value: s ? formatPlaytime(s.longestSessionSec, '-') : '…' },
    { label: 'Last 7 days', value: s ? formatHours(s.weekSeconds) : '…' }
  ]

  return (
    <div className="space-y-6 p-8 pb-14">
      <div className="animate-page-in">
        <div className="readout !text-accent">Telemetry</div>
        <h1 className="display mt-1 text-3xl uppercase">Statistics</h1>
      </div>

      <section className="grid grid-cols-5 divide-x divide-line/[0.07] overflow-hidden rounded-2xl border border-line/[0.08] bg-surface/50 stagger">
        {tiles.map((t) => (
          <div key={t.label} className="px-6 py-5">
            <div className="readout">{t.label}</div>
            <div className="num mt-2 text-[26px] font-semibold leading-none">{t.value}</div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-6">
        <section className="panel p-6 animate-page-in">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="section-title">Last 30 days</h2>
            <span className="readout">Daily playtime</span>
          </div>
          {s ? <DailyChart data={s.daily} /> : <div className="skeleton h-56 rounded-xl" />}
        </section>
        <section className="panel p-6 animate-page-in">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="section-title">By weekday</h2>
            <span className="readout">All time</span>
          </div>
          <div className="space-y-2.5">
            {WEEKDAYS.map((d, i) => {
              const v = s?.byWeekday[i] ?? 0
              return (
                <div key={d} className="grid grid-cols-[36px_minmax(0,1fr)_56px] items-center gap-3">
                  <span className="readout">{d}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-line/[0.06]">
                    <span className="block h-full rounded-full bg-gradient-to-r from-accent/60 to-accent transition-all duration-700" style={{ width: `${(v / maxWd) * 100}%` }} />
                  </span>
                  <span className="num text-right text-xs text-muted">{v ? formatHours(v) : '-'}</span>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <section className="panel p-6 animate-page-in">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="section-title">Most played</h2>
            <span className="readout">Top 10</span>
          </div>
          {s && s.topGames.length === 0 && <p className="text-sm text-muted">Play something and your top games will show up here.</p>}
          <div className="space-y-2">
            {(s?.topGames ?? []).map((t, i) => {
              const g = gameMap.get(t.gameId)
              return (
                <button
                  key={t.gameId}
                  onClick={() => navigate({ page: 'game', id: t.gameId })}
                  className="grid w-full grid-cols-[24px_36px_minmax(0,1fr)_64px] items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-line/[0.04]"
                >
                  <span className={cx('num text-sm font-semibold', i === 0 ? 'text-accent' : 'text-muted')}>{String(i + 1).padStart(2, '0')}</span>
                  <GameIcon game={g ?? { title: t.title, icon: t.icon, cover: t.cover }} size={36} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{t.title}</span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-line/[0.06]">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${(t.seconds / maxTop) * 100}%` }} />
                    </span>
                  </span>
                  <span className="num text-right text-xs">{formatHours(t.seconds)}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="panel p-6 animate-page-in">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="section-title">Launch history</h2>
            <span className="readout">Latest 60</span>
          </div>
          {history.data && history.data.length === 0 ? (
            <Empty icon={History} title="No sessions yet" text="Every time you play through Zenith, the session is logged here." />
          ) : (
            <div className="max-h-[460px] space-y-0.5 overflow-y-auto pr-1">
              {(history.data ?? []).map((h) => {
                const g = gameMap.get(h.gameId)
                return (
                  <button
                    key={h.id}
                    disabled={!g}
                    onClick={() => g && navigate({ page: 'game', id: g.id })}
                    className="grid w-full grid-cols-[28px_minmax(0,1fr)_110px_70px] items-center gap-3 rounded-lg px-2 py-2 text-left enabled:hover:bg-line/[0.04]"
                  >
                    <GameIcon game={g ?? { title: h.gameTitle, icon: '', cover: '' }} size={28} className="rounded-md" />
                    <span className="truncate text-sm">{h.gameTitle}</span>
                    <span className="num text-xs text-muted">{formatDateTime(h.startedAt)}</span>
                    <span className="num text-right text-xs">{formatPlaytime(h.durationSec, '< 1 min')}</span>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
