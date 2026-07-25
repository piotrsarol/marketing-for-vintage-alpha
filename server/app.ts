import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { currentProvider, discoverGoogleNews, evaluateTrend, generateContent } from './providers.js'
import { latestCampaigns, saveCampaign, saveLead, storageProvider } from './store.js'
import type { Campaign, ProductConfig } from './types.js'

const distDirectory = path.resolve(process.cwd(), 'dist')
const maxBodyBytes = 64 * 1024
const rateWindowMs = 15 * 60 * 1000
const rateLimit = new Map<string, { count: number; resetAt: number }>()

const defaultProduct: ProductConfig = {
  name: process.env.PRODUCT_NAME || 'Your SaaS product',
  url: process.env.PRODUCT_URL || 'https://example.com',
  description: process.env.PRODUCT_DESCRIPTION || 'A SaaS product for operators who want better market signals.',
  audience: (process.env.PRODUCT_AUDIENCE || 'Vinted sellers, clothing resellers, vintage sellers').split(',').map((item) => item.trim()),
  callToAction: process.env.PRODUCT_CTA || 'Join the waitlist for early access.',
  country: process.env.PRODUCT_COUNTRY || 'PL',
  searchQuery: process.env.PRODUCT_SEARCH_QUERY || undefined,
}

async function body(request: IncomingMessage) {
  let raw = ''
  for await (const chunk of request) {
    raw += chunk
    if (Buffer.byteLength(raw) > maxBodyBytes) throw new Error('Request body is too large')
  }
  return raw ? JSON.parse(raw) as Record<string, unknown> : {}
}

function productFrom(input: unknown): ProductConfig {
  if (!input || typeof input !== 'object') return defaultProduct
  const value = input as Partial<ProductConfig>
  return { ...defaultProduct, ...value, audience: Array.isArray(value.audience) ? value.audience.filter((item): item is string => typeof item === 'string') : defaultProduct.audience }
}

function origin() {
  return process.env.ALLOWED_ORIGIN || '*'
}

function clientIp(request: IncomingMessage) {
  return request.headers['x-forwarded-for']?.toString().split(',')[0].trim() || request.socket.remoteAddress || 'unknown'
}

function consumeRateLimit(key: string, limit: number) {
  const now = Date.now()
  const current = rateLimit.get(key)
  if (!current || current.resetAt <= now) {
    rateLimit.set(key, { count: 1, resetAt: now + rateWindowMs })
    return true
  }
  if (current.count >= limit) return false
  current.count += 1
  return true
}

function hasAdminAccess(request: IncomingMessage) {
  const configuredToken = process.env.ADMIN_API_TOKEN
  if (!configuredToken && process.env.NODE_ENV !== 'production') return true
  if (!configuredToken) return false
  const provided = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : ''
  const expected = Buffer.from(configuredToken)
  const actual = Buffer.from(provided)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

async function json(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': origin(),
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(payload))
}

async function runCampaign(product: ProductConfig) {
  const discovered = await discoverGoogleNews(product)
  const evaluated = await Promise.all(discovered.map(async (trend) => ({ trend, evaluation: await evaluateTrend(trend, product) })))
  const approved = evaluated.filter((item) => item.evaluation.score >= Number(process.env.MIN_TREND_SCORE || 70)).slice(0, 3)
  const campaigns: Campaign[] = []
  for (const { trend, evaluation } of approved) {
    campaigns.push(await saveCampaign({ id: randomUUID(), product, trend, evaluation, content: await generateContent(trend, evaluation, product), provider: currentProvider(), createdAt: new Date().toISOString() }))
  }
  return { discovered: discovered.length, approved: approved.length, campaigns }
}

export async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (request.method === 'OPTIONS') return json(response, 204, null)
    if (url.pathname === '/api/health') return json(response, 200, { ok: true, provider: process.env.OPENAI_API_KEY ? 'openai' : 'mock', storage: storageProvider, time: new Date().toISOString() })
    if (url.pathname === '/api/trends/discover' && request.method === 'GET') {
      if (!hasAdminAccess(request)) return json(response, 401, { error: 'Unauthorized' })
      if (!consumeRateLimit(`trends:${clientIp(request)}`, 10)) return json(response, 429, { error: 'Rate limit exceeded' })
      return json(response, 200, { trends: await discoverGoogleNews(productFrom({ country: url.searchParams.get('country') ?? undefined })) })
    }
    if (url.pathname === '/api/campaigns/run' && request.method === 'POST') {
      if (!hasAdminAccess(request)) return json(response, process.env.ADMIN_API_TOKEN ? 401 : 503, { error: process.env.ADMIN_API_TOKEN ? 'Unauthorized' : 'Admin API is not configured' })
      if (!consumeRateLimit(`campaign:${clientIp(request)}`, 5)) return json(response, 429, { error: 'Rate limit exceeded' })
      return json(response, 200, await runCampaign(productFrom((await body(request)).product)))
    }
    if (url.pathname === '/api/campaigns/latest' && request.method === 'GET') {
      if (!hasAdminAccess(request)) return json(response, process.env.ADMIN_API_TOKEN ? 401 : 503, { error: process.env.ADMIN_API_TOKEN ? 'Unauthorized' : 'Admin API is not configured' })
      return json(response, 200, { campaigns: await latestCampaigns() })
    }
    if (url.pathname === '/api/waitlist' && request.method === 'POST') {
      if (!consumeRateLimit(`waitlist:${clientIp(request)}`, 10)) return json(response, 429, { error: 'Rate limit exceeded' })
      const input = await body(request)
      if (typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return json(response, 400, { error: 'A valid email is required.' })
      return json(response, 201, await saveLead(input.email.trim().toLowerCase(), typeof input.source === 'string' ? input.source.slice(0, 100) : 'direct'))
    }
    if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'Not found' })
    const requested = url.pathname === '/' ? '/index.html' : url.pathname
    const filePath = path.resolve(distDirectory, `.${requested}`)
    if (!filePath.startsWith(`${distDirectory}${path.sep}`)) return json(response, 400, { error: 'Invalid path' })
    const file = await readFile(filePath)
    response.writeHead(200, { 'Content-Type': requested.endsWith('.js') ? 'text/javascript' : requested.endsWith('.css') ? 'text/css' : 'text/html', 'X-Content-Type-Options': 'nosniff' })
    response.end(file)
  } catch (error) {
    console.error(error)
    await json(response, 500, { error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error instanceof Error ? error.message : 'Unexpected server error' })
  }
}
