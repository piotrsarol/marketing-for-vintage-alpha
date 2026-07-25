import type { MarketplaceObservation, ProductConfig, TrendSignal } from './types.js'

type ScrappaItem = {
  id: number
  title: string
  brand_title?: string
  price?: { amount?: string; currency_code?: string }
  favourite_count?: number
  url?: string
}

type ScrappaResponse = {
  success?: boolean
  data?: { items?: ScrappaItem[] }
}

export type MarketplaceSnapshot = {
  id?: string
  query: string
  country: string
  observedAt: string
  listingIds: string[]
  listingCount: number
  medianPrice: number
  currency: string
  averageFavourites: number
  topFavourites: number
  previousObservedAt?: string
  listingCountDelta?: number
  medianPriceDelta?: number
  averageFavouritesDelta?: number
  disappearedListingCount?: number
}

export type MarketplaceDiscovery = {
  signal: TrendSignal
  snapshot: MarketplaceSnapshot
}

const timeoutMs = 12_000
const seedQueries = ['Nike Dunk', 'Adidas Samba', 'vintage leather bag', 'denim jacket', 'vintage football shirt']

async function searchScrappa(query: string, country: string): Promise<ScrappaItem[]> {
  const key = process.env.SCRAPPA_API_KEY
  if (!key) return []
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`https://scrappa.co/api/vinted/search?query=${encodeURIComponent(query)}&country=${encodeURIComponent(country)}`, {
      headers: { Accept: 'application/json', 'X-API-KEY': key },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Scrappa request failed with ${response.status}`)
    const payload = await response.json() as ScrappaResponse
    return payload.success === false ? [] : payload.data?.items || []
  } finally {
    clearTimeout(timeout)
  }
}

function median(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] || 0
}

function cleanTopic(value: string | undefined, fallback: string) {
  const topic = (value || '').replace(/\bunknown\b/gi, '').replace(/\s+/g, ' ').trim()
  return topic || fallback
}

export async function discoverMarketplaceData(product: ProductConfig): Promise<MarketplaceDiscovery[]> {
  if (!process.env.SCRAPPA_API_KEY) return []
  const queries = product.searchQuery && !/seller|trend|demand|resale|fashion/i.test(product.searchQuery)
    ? [product.searchQuery, ...seedQueries]
    : seedQueries
  const results = await Promise.all(queries.map(async (query) => ({ query, items: await searchScrappa(query, product.country) })))
  return results.filter(({ items }) => items.length > 0).map(({ query, items }) => {
    const prices = items.map((item) => Number(item.price?.amount)).filter(Number.isFinite)
    const favourites = items.map((item) => item.favourite_count || 0)
    const currency = items.find((item) => item.price?.currency_code)?.price?.currency_code || 'PLN'
    const topItem = items.slice().sort((a, b) => (b.favourite_count || 0) - (a.favourite_count || 0))[0]
    const evidence = `${items.length} active listings, median asking price ${median(prices)} ${currency}, average favourites ${Math.round(favourites.reduce((sum, value) => sum + value, 0) / items.length)}, top listing ${topItem?.favourite_count || 0} favourites. This is a live marketplace demand proxy, not confirmed sales data.`
    const snapshot: MarketplaceSnapshot = {
      query,
      country: product.country,
      observedAt: new Date().toISOString(),
      listingIds: items.map((item) => String(item.id)),
      listingCount: items.length,
      medianPrice: median(prices),
      currency,
      averageFavourites: Math.round(favourites.reduce((sum, value) => sum + value, 0) / items.length),
      topFavourites: topItem?.favourite_count || 0,
    }
    const marketplace: MarketplaceObservation = {
      listingCount: snapshot.listingCount,
      medianPrice: snapshot.medianPrice,
      currency: snapshot.currency,
      averageFavourites: snapshot.averageFavourites,
      topFavourites: snapshot.topFavourites,
    }
    return {
      snapshot,
      signal: {
      topic: cleanTopic(topItem?.title, query),
      category: 'marketplace product demand',
      source: 'Scrappa · Vinted marketplace',
      url: topItem?.url || '',
      discoveryQuery: query,
      country: product.country,
      season: new Date().toLocaleString('en', { month: 'long' }),
      keywords: [query, topItem?.brand_title || 'resale'].filter(Boolean),
      evidence,
      marketplace,
      },
    }
  })
}

export async function discoverMarketplaceSignals(product: ProductConfig): Promise<TrendSignal[]> {
  const discoveries = await discoverMarketplaceData(product)
  return discoveries.map(({ signal }) => signal)
}
