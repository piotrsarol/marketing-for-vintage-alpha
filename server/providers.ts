import type { Evaluation, ProductConfig, TrendSignal } from './types.js'

type OpenAIResponse = { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }
let openAIHealthy = false
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

function numberInRange(value: unknown, fallback: number) {
  return typeof value === 'number' && value >= 0 && value <= 100 ? value : fallback
}

function parseJson<T>(value: string): T {
  const cleaned = value.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
  return JSON.parse(cleaned) as T
}

async function askOpenAI<T>(prompt: string): Promise<T | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) { openAIHealthy = false; return null }
  try {
    const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5-mini', input: prompt, text: { format: { type: 'json_object' } } }),
    })
    if (!response.ok) {
      openAIHealthy = false
      console.warn(`OpenAI request failed with ${response.status}; using the local fallback provider.`)
      return null
    }
    const payload = await response.json() as OpenAIResponse
    const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? '').join('')
    if (!text) { openAIHealthy = false; return null }
    openAIHealthy = true
    return parseJson<T>(text)
  } catch {
    openAIHealthy = false
    console.warn('OpenAI request failed; using the local fallback provider.')
    return null
  }
}

export async function discoverGoogleNews(product: ProductConfig): Promise<TrendSignal[]> {
  const query = encodeURIComponent(product.searchQuery || `${product.name} ${product.audience.join(' ')} ${product.description}`)
  const response = await fetchWithTimeout(`https://news.google.com/rss/search?q=${query}&hl=en-US&gl=${product.country}&ceid=${product.country}:en`)
  if (!response.ok) throw new Error(`Google News RSS request failed with ${response.status}`)
  const xml = await response.text()
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 12)
  return items.map((match, index) => {
    const item = match[1]
    const title = decodeXml(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? `Fashion resale signal ${index + 1}`)
    const url = decodeXml(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '')
    const source = decodeXml(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? 'Google News')
    return { topic: title.split(' - ')[0].trim(), category: 'fashion resale', source, url, country: product.country, season: currentSeason(), keywords: title.toLowerCase().split(/\W+/).filter(Boolean).slice(0, 8), evidence: title }
  })
}

function decodeXml(value: string) {
  return value.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

function currentSeason() {
  const month = new Date().getUTCMonth() + 1
  return month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter'
}

export async function evaluateTrend(signal: TrendSignal, product: ProductConfig): Promise<Evaluation> {
  const result = await askOpenAI<Evaluation>(`Evaluate this fashion resale trend for the product below. Return JSON only with numeric 0-100 fields score, virality, commercialIntent, novelty, evergreenScore, vintedRelevance, predictedEngagement and arrays contentAngles, hooks, targetAudience plus reasoning string.\nProduct: ${JSON.stringify(product)}\nTrend: ${JSON.stringify(signal)}`)
  if (result) return { ...result, score: numberInRange(result.score, 70) }
  const score = Math.min(96, 62 + signal.keywords.length * 4)
  return { score, virality: score - 3, commercialIntent: score + 2, novelty: score - 8, evergreenScore: score - 15, vintedRelevance: score + 1, predictedEngagement: score - 2, reasoning: `Fallback scoring used because OPENAI_API_KEY is not configured. Evidence: ${signal.evidence}`, contentAngles: ['early demand signal', 'how to source before saturation'], hooks: [`The next resale signal may already be in your feed: ${signal.topic}.`], targetAudience: product.audience }
}

export async function generateContent(signal: TrendSignal, evaluation: Evaluation, product: ProductConfig) {
  const result = await askOpenAI<Record<string, unknown>>(`Create one launch campaign from this approved trend for the product below. Return JSON only with keys linkedin, twitterThread, reddit, blog, email, instagram, tiktok, youtubeShort, carousel. Each value should be ready-to-publish copy or a structured outline. Include a clear but non-pushy waitlist CTA using ${product.callToAction}. Product: ${JSON.stringify(product)}\nTrend: ${JSON.stringify(signal)}\nEvaluation: ${JSON.stringify(evaluation)}`)
  return result ?? { linkedin: `A new signal is forming around ${signal.topic}. ${evaluation.reasoning}`, twitterThread: [`Signal: ${signal.topic}`, ...evaluation.hooks, product.callToAction], reddit: `What are sellers seeing around ${signal.topic}? Here is the early evidence: ${signal.evidence}`, blog: { title: `${signal.topic}: early resale signal or noise?`, outline: evaluation.contentAngles }, email: { subject: `Early signal: ${signal.topic}`, body: `We are watching ${signal.topic} before the market gets crowded. ${product.callToAction}` }, instagram: `${signal.topic} is moving. Save this signal and watch your sourcing data. ${product.callToAction}`, tiktok: { hook: evaluation.hooks[0], beats: evaluation.contentAngles, cta: product.callToAction }, youtubeShort: { hook: evaluation.hooks[0], durationSeconds: 35, beats: evaluation.contentAngles }, carousel: { slideCount: 8, title: `${signal.topic}: early or saturated?`, slides: evaluation.contentAngles } }
}
