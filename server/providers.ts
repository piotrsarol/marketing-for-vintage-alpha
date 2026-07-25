import type { Evaluation, ProductConfig, TrendSignal } from './types.js'

type OpenAIResponse = { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }
let openAIHealthy = false
let lastProvider: 'openai' | 'mock' | 'unknown' = 'unknown'
const providerTimeoutMs = 15_000

async function fetchWithTimeout(input: string, init?: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export function currentProvider(): 'openai' | 'mock' {
  return openAIHealthy ? 'openai' : 'mock'
}

export function providerStatus() {
  return {
    configured: Boolean(process.env.OPENAI_API_KEY),
    lastProvider,
  }
}

function numberInRange(value: unknown, fallback: number) {
  return typeof value === 'number' && value >= 0 && value <= 100 ? value : fallback
}

function parseJson<T>(value: string): T {
  const cleaned = value.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
  return JSON.parse(cleaned) as T
}

async function askOpenAI<T>(prompt: string): Promise<T | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) { openAIHealthy = false; lastProvider = 'mock'; return null }
  try {
    const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5-mini', input: prompt, text: { format: { type: 'json_object' } } }),
    })
    if (!response.ok) {
      openAIHealthy = false
      lastProvider = 'mock'
      console.warn(`OpenAI request failed with ${response.status}; using the local fallback provider.`)
      return null
    }
    const payload = await response.json() as OpenAIResponse
    const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? '').join('')
    if (!text) { openAIHealthy = false; lastProvider = 'mock'; return null }
    openAIHealthy = true
    lastProvider = 'openai'
    return parseJson<T>(text)
  } catch {
    openAIHealthy = false
    lastProvider = 'mock'
    console.warn('OpenAI request failed; using the local fallback provider.')
    return null
  }
}

export async function discoverGoogleNews(product: ProductConfig): Promise<TrendSignal[]> {
  const queries = [
    { category: 'market momentum', query: `${product.audience[0] || 'Vinted sellers'} resale trends` },
    { category: 'pricing', query: 'Vinted seller pricing demand resale fashion' },
    { category: 'seasonality and sourcing', query: 'second hand fashion seasonal demand sourcing' },
    { category: 'inventory and margins', query: 'resale fashion inventory margins sell through' },
    ...(product.searchQuery ? [{ category: 'custom signal', query: product.searchQuery }] : []),
  ]
  const language = product.language || 'en'
  const feeds = (await Promise.all(queries.map(async ({ category, query: rawQuery }) => {
    try {
      const query = encodeURIComponent(rawQuery)
      const response = await fetchWithTimeout(`https://news.google.com/rss/search?q=${query}&hl=${language}&gl=${product.country}&ceid=${product.country}:${language}`)
      if (!response.ok) throw new Error(`Google News RSS request failed with ${response.status}`)
      return { category, query: rawQuery, xml: await response.text() }
    } catch (error) {
      console.warn(error instanceof Error ? error.message : `Discovery query failed: ${rawQuery}`)
      return null
    }
  }))).filter((feed): feed is { category: string; query: string; xml: string } => feed !== null)
  if (!feeds.length) throw new Error('All market signal queries failed')
  const signals = feeds.flatMap(({ category, query, xml }) => {
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8)
    return items.map((match, index) => {
      const item = match[1]
      const title = decodeXml(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? `Fashion resale signal ${index + 1}`)
      const description = decodeXml(item.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      const url = decodeXml(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '')
      const source = decodeXml(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? 'Google News')
      return { topic: title.split(' - ')[0].trim(), category, source, url, discoveryQuery: query, country: product.country, season: currentSeason(), keywords: `${title} ${description}`.toLowerCase().split(/\W+/).filter(Boolean).slice(0, 8), evidence: `${title}${description ? ` — ${description}` : ''}` }
    })
  })
  const signalTerms = /\b(trend|trends|demand|popular|popularity|growth|growing|price|pricing|sales|selling|sell-through|inventory|sourcing|resale|reseller|second-hand|category|popyt|popularn|rośnie|wzrost|cena|ceny|sprzedaż|sprzedają|zapas|zatowarowanie|odsprzedaż|kategoria|marża)\b/i
  const sellerContextTerms = /\b(vinted|resale|reseller|second-hand|fashion|clothing|sneaker|vintage|odzież|ubrania|buty|moda|vintage|sprzedawc)\b/i
  const politicalTerms = /\b(politic|political|government|minister|election|sejm|rząd|polityk|polityka|wybory|wojna|felieton|opinia|opinion)\b/i
  const relevant = signals.filter((signal) => {
    const evidence = `${signal.evidence} ${signal.source}`
    return sellerContextTerms.test(evidence) && signalTerms.test(evidence) && !(politicalTerms.test(evidence) && !/\b(resale|second-hand|fashion|clothing|sneaker|odzież|ubrania|buty|moda)\b/i.test(evidence))
  })
  const seen = new Set<string>()
  return relevant.filter((signal) => {
    const key = normalizeTrendTopic(signal.topic)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function normalizeTrendTopic(topic: string) {
  return topic.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function decodeXml(value: string) {
  return value.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

function currentSeason() {
  const month = new Date().getUTCMonth() + 1
  return month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter'
}

export async function evaluateTrend(signal: TrendSignal, product: ProductConfig): Promise<Evaluation> {
  const result = await askOpenAI<Evaluation>(`Evaluate whether this is an actionable market signal for a product that predicts what will grow on Vinted. Ignore political, celebrity, opinion, brand-news, or general culture stories unless they contain concrete evidence about seller demand, product categories, prices, sales, inventory, sourcing, or resale growth. Score irrelevant stories below 50. Return JSON only with numeric 0-100 fields score, virality, commercialIntent, novelty, evergreenScore, vintedRelevance, predictedEngagement, opportunityConfidence and arrays contentAngles, hooks, targetAudience plus strings opportunityType (product_rising_interest, pricing, seasonality, inventory, or education), productCategory, demandEvidence, supplyStatus (unverified or hypothesis), recommendedAction and reasoning. Never state that supply is low unless the source provides supply/listing evidence; use supplyStatus=hypothesis otherwise. Write all natural-language fields in ${product.language}.\nProduct: ${JSON.stringify(product)}\nTrend: ${JSON.stringify(signal)}`)
  if (result) return { ...result, score: numberInRange(result.score, 70) }
  const score = Math.min(96, 62 + signal.keywords.length * 4)
  return { score, virality: score - 3, commercialIntent: score + 2, novelty: score - 8, evergreenScore: score - 15, vintedRelevance: score + 1, predictedEngagement: score - 2, reasoning: `Fallback scoring used because OPENAI_API_KEY is not configured. Evidence: ${signal.evidence}`, contentAngles: ['early demand signal', 'how to source before saturation'], hooks: [`The next resale signal may already be in your feed: ${signal.topic}.`], targetAudience: product.audience, opportunityType: 'product_rising_interest', productCategory: signal.topic, demandEvidence: signal.evidence, supplyStatus: 'unverified', opportunityConfidence: Math.max(0, score - 20), recommendedAction: 'Validate current listings, prices, and competition before sourcing.' }
}

export async function generateContent(signal: TrendSignal, evaluation: Evaluation, product: ProductConfig) {
  const result = await askOpenAI<Record<string, unknown>>(`Create one product-opportunity campaign from this approved Vinted market signal. Focus on what may be gaining demand and how Vinted Analytics helps sellers validate it before the market gets crowded. Do not claim low supply as fact unless the evidence supports it; frame unverified supply as a hypothesis to check. Return JSON only with keys linkedin, twitterThread, reddit, blog, email, instagram, tiktok, youtubeShort, carousel. Each value should be ready-to-publish copy or a structured outline. Write all user-facing copy in ${product.language}. Include a clear but non-pushy waitlist CTA using ${product.callToAction}. Product: ${JSON.stringify(product)}\nTrend: ${JSON.stringify(signal)}\nOpportunity: ${JSON.stringify(evaluation)}`)
  if (result) return result
  const polish = product.language.toLowerCase().startsWith('pl')
  return polish
    ? { linkedin: `Pojawia się nowy sygnał: ${signal.topic}. ${evaluation.reasoning}`, twitterThread: [`Sygnał: ${signal.topic}`, ...evaluation.hooks, product.callToAction], reddit: `Co sprzedający widzą wokół ${signal.topic}? Oto wczesne dane: ${signal.evidence}`, blog: { title: `${signal.topic}: chwilowy szum czy realny popyt?`, outline: evaluation.contentAngles }, email: { subject: `Nowy sygnał: ${signal.topic}`, body: `Obserwujemy ${signal.topic}, zanim rynek się zatłoczy. ${product.callToAction}` }, instagram: `${signal.topic} zyskuje na znaczeniu. Obserwuj dane i decyzje zakupowe. ${product.callToAction}`, tiktok: { hook: evaluation.hooks[0], beats: evaluation.contentAngles, cta: product.callToAction }, youtubeShort: { hook: evaluation.hooks[0], durationSeconds: 35, beats: evaluation.contentAngles }, carousel: { slideCount: 8, title: `${signal.topic}: rosnący popyt czy chwilowy trend?`, slides: evaluation.contentAngles } }
    : { linkedin: `A new signal is forming around ${signal.topic}. ${evaluation.reasoning}`, twitterThread: [`Signal: ${signal.topic}`, ...evaluation.hooks, product.callToAction], reddit: `What are sellers seeing around ${signal.topic}? Here is the early evidence: ${signal.evidence}`, blog: { title: `${signal.topic}: early resale signal or noise?`, outline: evaluation.contentAngles }, email: { subject: `Early signal: ${signal.topic}`, body: `We are watching ${signal.topic} before the market gets crowded. ${product.callToAction}` }, instagram: `${signal.topic} is moving. Save this signal and watch your sourcing data. ${product.callToAction}`, tiktok: { hook: evaluation.hooks[0], beats: evaluation.contentAngles, cta: product.callToAction }, youtubeShort: { hook: evaluation.hooks[0], durationSeconds: 35, beats: evaluation.contentAngles }, carousel: { slideCount: 8, title: `${signal.topic}: early or saturated?`, slides: evaluation.contentAngles } }
}
