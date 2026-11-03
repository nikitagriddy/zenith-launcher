// Games that are 100% off (free to keep): Epic's official free-games feed + GamerPower for every other store.
import { net } from 'electron'
import type { FreeDeal, FreeDealsResult } from '@shared/types'
import { log } from './log'

const TTL = 20 * 60_000
let cache: FreeDealsResult | null = null

async function fetchJson<T>(url: string): Promise<T> {
  const res = await net.fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

const norm = (s: string) => s.toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]/g, '')
const time = (s?: string | null) => {
  const t = s ? Date.parse(s) : NaN
  return Number.isFinite(t) ? t : null
}

// ---------- Epic Games Store ----------

interface EpicOffer {
  startDate: string
  endDate: string
  discountSetting?: { discountPercentage: number }
}
interface EpicElement {
  id: string
  title: string
  description?: string
  productSlug?: string | null
  urlSlug?: string
  offerType?: string
  keyImages?: { type: string; url: string }[]
  catalogNs?: { mappings?: { pageSlug: string; pageType: string }[] }
  offerMappings?: { pageSlug: string; pageType: string }[]
  price?: { totalPrice?: { originalPrice: number; discountPrice: number; fmtPrice?: { originalPrice?: string } } }
  promotions?: {
    promotionalOffers?: { promotionalOffers: EpicOffer[] }[]
    upcomingPromotionalOffers?: { promotionalOffers: EpicOffer[] }[]
  } | null
}

async function epicDeals(): Promise<FreeDeal[]> {
  const j = await fetchJson<{ data?: { Catalog?: { searchStore?: { elements?: EpicElement[] } } } }>(
    'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US'
  )
  const out: FreeDeal[] = []
  for (const e of j.data?.Catalog?.searchStore?.elements ?? []) {
    const original = e.price?.totalPrice?.originalPrice ?? 0
    if (original <= 0) continue // always-free games aren't a discount
    // Epic's discountPercentage is the share you still pay: 0 means 100% off.
    const now = e.promotions?.promotionalOffers?.flatMap((p) => p.promotionalOffers).find((o) => o.discountSetting?.discountPercentage === 0)
    const next = e.promotions?.upcomingPromotionalOffers?.flatMap((p) => p.promotionalOffers).find((o) => o.discountSetting?.discountPercentage === 0)
    const offer = now ?? next
    if (!offer) continue
    const slug =
      (e.productSlug && e.productSlug.replace(/\/home$/, '')) ||
      e.catalogNs?.mappings?.find((m) => m.pageType === 'productHome')?.pageSlug ||
      e.offerMappings?.[0]?.pageSlug ||
      e.urlSlug
    const img = (types: string[]) => types.map((t) => e.keyImages?.find((k) => k.type === t)?.url).find(Boolean) ?? ''
    out.push({
      id: `epic:${e.id}`,
      title: e.title,
      store: 'Epic Games',
      image: img(['OfferImageWide', 'DieselStoreFrontWide', 'Thumbnail', 'OfferImageTall']),
      worth: e.price?.totalPrice?.fmtPrice?.originalPrice ?? `$${(original / 100).toFixed(2)}`,
      description: e.description ?? '',
      startsAt: time(offer.startDate),
      endsAt: time(offer.endDate),
      upcoming: !now,
      url: slug ? `https://store.epicgames.com/p/${slug}` : 'https://store.epicgames.com/free-games'
    })
  }
  return out
}

// ---------- GamerPower (Steam, GOG, itch.io, Ubisoft, Prime…) ----------

interface GpItem {
  id: number
  title: string
  worth: string
  image: string
  thumbnail: string
  description: string
  open_giveaway_url: string
  platforms: string
  end_date: string
  published_date: string
  status: string
  type: string
}

function storeFromPlatforms(p: string): string {
  const parts = p.split(',').map((s) => s.trim()).filter((s) => s && s !== 'PC')
  const first = parts.find((s) => s !== 'DRM-Free') ?? parts[0] ?? 'Other'
  return first.replace(/ Store$/, '').replace(/^DRM-Free$/, 'DRM-free')
}

async function gamerPowerDeals(): Promise<FreeDeal[]> {
  const items = await fetchJson<GpItem[]>('https://www.gamerpower.com/api/giveaways?platform=pc&type=game&sort-by=date')
  return items
    .filter((i) => i.type === 'Game' && i.status !== 'Expired')
    .map((i) => {
      const store = storeFromPlatforms(i.platforms)
      return {
        id: `gp:${i.id}`,
        title: i.title.replace(/\s*\(([^)]*)\)\s*Giveaway\s*$/i, '').replace(/\s*Giveaway\s*$/i, '').trim(),
        store,
        image: i.image || i.thumbnail,
        worth: i.worth && i.worth !== 'N/A' ? i.worth : '',
        description: i.description,
        startsAt: time(i.published_date?.replace(' ', 'T')),
        endsAt: i.end_date && i.end_date !== 'N/A' ? time(i.end_date.replace(' ', 'T')) : null,
        upcoming: false,
        url: i.open_giveaway_url
      }
    })
}

export async function getFreeGames(force = false): Promise<FreeDealsResult> {
  if (!force && cache && Date.now() - cache.fetchedAt < TTL) return cache
  const errors: string[] = []
  const [epic, gp] = await Promise.all([
    epicDeals().catch((e) => {
      errors.push(`Epic Games: ${(e as Error).message}`)
      return [] as FreeDeal[]
    }),
    gamerPowerDeals().catch((e) => {
      errors.push(`GamerPower: ${(e as Error).message}`)
      return [] as FreeDeal[]
    })
  ])
  // Epic's own feed is authoritative for Epic; drop GamerPower duplicates of the same game.
  const seen = new Set(epic.map((d) => norm(d.title)))
  const deals = [...epic, ...gp.filter((d) => !seen.has(norm(d.title)))]
    .filter((d) => !d.endsAt || d.endsAt > Date.now())
    .sort((a, b) => Number(a.upcoming) - Number(b.upcoming) || (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity))
  if (errors.length) log.warn('Free games fetch:', errors.join('; '))
  const result: FreeDealsResult = { deals, fetchedAt: Date.now(), errors }
  if (deals.length || !cache) cache = result
  if (!deals.length && errors.length === 2) throw new Error('Could not reach the free-games services. Check your internet connection.')
  return result
}
