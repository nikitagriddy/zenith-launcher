import { useEffect, useMemo, useState } from 'react'
import { BadgePercent, Check, Clock, ExternalLink, Gift, RefreshCw, WifiOff } from 'lucide-react'
import type { FreeDeal } from '@shared/types'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { cx, formatRelative, hueFrom } from '../lib/format'
import { useNow } from '../lib/hooks'
import { Empty } from '../components/controls'

const norm = (s: string) => s.toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]/g, '')

function countdown(ms: number): string {
  if (ms <= 0) return 'Ending now'
  const m = Math.floor(ms / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m}m`
}

function DealCard({ deal, owned, now }: { deal: FreeDeal; owned: boolean; now: number }) {
  const [imgOk, setImgOk] = useState(true)
  const hue = hueFrom(deal.title)
  const soon = !deal.upcoming && deal.endsAt && deal.endsAt - now < 24 * 3600_000
  return (
    <article className="game-card group flex flex-col overflow-hidden rounded-2xl border border-line/[0.08] bg-surface/60 transition-all duration-300 hover:-translate-y-1 hover:border-accent/50 hover:shadow-glow">
      <button className="relative aspect-video overflow-hidden text-left" onClick={() => void api.app.openExternal(deal.url)}>
        {imgOk && deal.image ? (
          <img src={deal.image} onError={() => setImgOk(false)} loading="lazy" className="cover-img h-full w-full object-cover" alt="" />
        ) : (
          <div className="cover-img flex h-full w-full items-end p-4" style={{ background: `linear-gradient(150deg, hsl(${hue} 50% 25%), hsl(${(hue + 40) % 360} 55% 8%))` }}>
            <span className="font-display text-lg font-bold uppercase text-white/90">{deal.title}</span>
          </div>
        )}
        <div className="card-shine pointer-events-none absolute inset-0" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />
        <span className="readout absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 !text-white backdrop-blur">{deal.store}</span>
        {owned && (
          <span className="absolute right-3 top-3 flex items-center gap-1 rounded-md bg-emerald-500/90 px-2 py-1 text-[11px] font-semibold text-black">
            <Check className="h-3 w-3" /> In your library
          </span>
        )}
        {(deal.upcoming ? deal.startsAt : deal.endsAt) && (
          <span
            className={cx(
              'num absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold backdrop-blur',
              soon ? 'bg-red-500/90 text-white' : 'bg-black/60 text-white'
            )}
          >
            <Clock className="h-3 w-3" />
            {deal.upcoming
              ? `Free in ${countdown((deal.startsAt ?? now) - now)}`
              : `Ends in ${countdown((deal.endsAt ?? now) - now)}`}
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-1 text-base font-semibold" title={deal.title}>
          {deal.title}
        </h3>
        <div className="mt-1 flex items-baseline gap-2">
          {deal.worth && <span className="num text-sm text-muted line-through">{deal.worth}</span>}
          <span className="font-display text-sm font-bold tracking-wide text-accent">{deal.upcoming ? 'FREE SOON' : 'FREE'}</span>
          <span className="readout ml-auto">100% off</span>
        </div>
        {deal.description && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">{deal.description}</p>}
        <div className="flex-1" />
        <button className={cx('mt-4 w-full', deal.upcoming ? 'btn-ghost' : 'btn-primary')} onClick={() => void api.app.openExternal(deal.url)}>
          {deal.upcoming ? 'View in store' : owned ? 'Open store page' : 'Get it free'} <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  )
}

export function DealsPage() {
  const result = useStore((s) => s.deals)
  const loading = useStore((s) => s.dealsLoading)
  const error = useStore((s) => s.dealsError)
  const games = useStore((s) => s.games)
  const { loadDeals, markDealsSeen } = useStore.getState()
  const [store, setStore] = useState('all')
  const now = useNow(60_000)

  useEffect(() => {
    void loadDeals(false)
  }, [loadDeals])
  useEffect(() => {
    if (result) markDealsSeen()
  }, [result, markDealsSeen])

  const owned = useMemo(() => new Set(games.map((g) => norm(g.title))), [games])
  const deals = result?.deals ?? []
  const stores = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of deals) m.set(d.store, (m.get(d.store) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [deals])
  const shown = deals.filter((d) => store === 'all' || d.store === store)
  const live = shown.filter((d) => !d.upcoming)
  const upcoming = shown.filter((d) => d.upcoming)
  const totalWorth = live.reduce((a, d) => a + (Number(d.worth.replace(/[^0-9.]/g, '')) || 0), 0)

  return (
    <div className="space-y-8 p-8 pb-14">
      <div className="flex items-end justify-between gap-6 animate-page-in">
        <div>
          <div className="readout !text-accent">100% off · free to keep</div>
          <h1 className="display mt-1 text-3xl uppercase">Discount games</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Every PC game that’s discounted to $0 right now - Epic Games, Steam, GOG, itch.io and more. Claim it and it’s yours forever.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {result && <span className="readout">Updated {formatRelative(result.fetchedAt)}</span>}
          <button className="btn-ghost" disabled={loading} onClick={() => void loadDeals(true)}>
            <RefreshCw className={cx('h-4 w-4', loading && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>

      {deals.length > 0 && (
        <section className="grid grid-cols-3 divide-x divide-line/[0.07] overflow-hidden rounded-2xl border border-line/[0.08] bg-surface/50">
          <div className="px-6 py-5">
            <div className="readout">Free right now</div>
            <div className="num mt-2 text-[28px] font-semibold leading-none">{deals.filter((d) => !d.upcoming).length}</div>
          </div>
          <div className="px-6 py-5">
            <div className="readout">Total value</div>
            <div className="num mt-2 text-[28px] font-semibold leading-none">${totalWorth.toFixed(2)}</div>
          </div>
          <div className="px-6 py-5">
            <div className="readout">Coming soon</div>
            <div className="num mt-2 text-[28px] font-semibold leading-none">{deals.filter((d) => d.upcoming).length}</div>
          </div>
        </section>
      )}

      {stores.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {[['all', deals.length] as [string, number], ...stores].map(([s, n]) => (
            <button
              key={s}
              onClick={() => setStore(s)}
              className={cx('h-8 rounded-lg px-3 text-xs font-semibold transition-colors', store === s ? 'bg-fg text-bg' : 'text-muted hover:bg-line/[0.06] hover:text-fg')}
            >
              {s === 'all' ? 'All stores' : s} <span className="num ml-1 opacity-60">{n}</span>
            </button>
          ))}
        </div>
      )}

      {!result && loading ? (
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton h-80 rounded-2xl" />
          ))}
        </div>
      ) : error && !deals.length ? (
        <Empty icon={WifiOff} title="Couldn’t load free games" text={error}>
          <button className="btn-primary" onClick={() => void loadDeals(true)}>
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </Empty>
      ) : !shown.length ? (
        <Empty icon={Gift} title="No free games right now" text="Nothing is at 100% off at the moment. Check back soon - new giveaways show up all the time." />
      ) : (
        <>
          {live.length > 0 && (
            <section>
              <div className="mb-4 flex items-baseline gap-3">
                <span className="readout !text-accent">01</span>
                <h2 className="section-title">Free right now</h2>
              </div>
              <div className="stagger grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                {live.map((d) => (
                  <DealCard key={d.id} deal={d} owned={owned.has(norm(d.title))} now={now} />
                ))}
              </div>
            </section>
          )}
          {upcoming.length > 0 && (
            <section>
              <div className="mb-4 flex items-baseline gap-3">
                <span className="readout !text-accent">02</span>
                <h2 className="section-title">Coming soon</h2>
              </div>
              <div className="stagger grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                {upcoming.map((d) => (
                  <DealCard key={d.id} deal={d} owned={owned.has(norm(d.title))} now={now} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {result?.errors.length ? (
        <p className="readout flex items-center gap-2">
          <BadgePercent className="h-3.5 w-3.5" /> Some sources didn’t answer: {result.errors.join(' · ')}
        </p>
      ) : null}
    </div>
  )
}
