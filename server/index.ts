import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { currentProvider, discoverGoogleNews, evaluateTrend, generateContent } from './providers.js'
import { latestCampaigns, saveCampaign, saveLead, storageProvider } from './store.js'
import type { Campaign, ProductConfig } from './types.js'

const port = Number(process.env.PORT || 3000)
const distDirectory = path.resolve(process.cwd(), 'dist')

const defaultProduct: ProductConfig = {
  name: process.env.PRODUCT_NAME || 'Your SaaS product',
  url: process.env.PRODUCT_URL || 'https://example.com',
  description: process.env.PRODUCT_DESCRIPTION || 'A SaaS product for operators who want better market signals.',
  audience: (process.env.PRODUCT_AUDIENCE || 'Vinted sellers, clothing resellers, vintage sellers').split(',').map((item) => item.trim()),
  callToAction: process.env.PRODUCT_CTA || 'Join the waitlist for early access.',
  country: process.env.PRODUCT_COUNTRY || 'PL',
  searchQuery: process.env.PRODUCT_SEARCH_QUERY || undefined,
}

async function body(request: import('node:http').IncomingMessage) {
  let raw = ''
  for await (const chunk of request) raw += chunk
  return raw ? JSON.parse(raw) as Record<string, unknown> : {}
}

function productFrom(input: unknown): ProductConfig {
  if (!input || typeof input !== 'object') return defaultProduct
  const value = input as Partial<ProductConfig>
  return { ...defaultProduct, ...value, audience: Array.isArray(value.audience) ? value.audience.filter((item): item is string => typeof item === 'string') : defaultProduct.audience }
}

async function json(response: import('node:http').ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
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

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }); response.end(); return }
    if (url.pathname === '/api/health') return json(response, 200, { ok: true, provider: process.env.OPENAI_API_KEY ? 'openai' : 'mock', storage: storageProvider, time: new Date().toISOString() })
    if (request.method === 'GET' && url.pathname === '/api/trends/discover') return json(response, 200, { trends: await discoverGoogleNews(productFrom({ country: url.searchParams.get('country') ?? undefined })) })
    if (request.method === 'POST' && url.pathname === '/api/campaigns/run') return json(response, 200, await runCampaign(productFrom((await body(request)).product)))
    if (request.method === 'GET' && url.pathname === '/api/campaigns/latest') return json(response, 200, { campaigns: await latestCampaigns() })
    if (request.method === 'POST' && url.pathname === '/api/waitlist') { const input = await body(request); if (typeof input.email !== 'string' || !input.email.includes('@')) return json(response, 400, { error: 'A valid email is required.' }); return json(response, 201, await saveLead(input.email, typeof input.source === 'string' ? input.source : 'direct')) }
    if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'Not found' })
    const requested = url.pathname === '/' ? '/index.html' : url.pathname
    const file = await readFile(path.join(distDirectory, requested))
    response.writeHead(200, { 'Content-Type': requested.endsWith('.js') ? 'text/javascript' : requested.endsWith('.css') ? 'text/css' : 'text/html' })
    response.end(file)
  } catch (error) {
    await json(response, 500, { error: error instanceof Error ? error.message : 'Unexpected server error' })
  }
})

server.listen(port, () => console.log(`Vinted Signal API listening on http://localhost:${port}`))
