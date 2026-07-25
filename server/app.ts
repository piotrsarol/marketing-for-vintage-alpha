import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { currentProvider, discoverGoogleNews, evaluateTrend, generateContent } from './providers.js'
import { currentPublisher, publishQueuedItem } from './publishers.js'
import { dashboardSnapshot, finishJobRun, latestCampaigns, saveCampaign, saveFunnelEvent, saveLead, saveQueueItems, saveTrend, startJobRun, storageProvider, updateQueueItem } from './store.js'
import type { Campaign, FunnelEvent, LeadAttribution, ProductConfig } from './types.js'

const distDirectory = path.resolve(process.cwd(), 'dist')
const maxBodyBytes = 64 * 1024
const rateWindowMs = 15 * 60 * 1000
const rateLimit = new Map<string, { count: number; resetAt: number }>()
const adminCookieName = 'vinted_admin_session'
const adminSessionMaxAge = 60 * 60 * 8
const supabaseCookieName = 'vinted_supabase_session'
const supabaseSessionMaxAge = 60 * 60 * 24 * 7
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '')
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

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

function stringValue(value: unknown, maxLength = 200) {
  return typeof value === 'string' ? value.slice(0, maxLength) : undefined
}

function attributionFrom(input: Record<string, unknown>): LeadAttribution {
  return {
    source: stringValue(input.source, 100) || 'direct',
    landingVariant: stringValue(input.landingVariant, 100),
    utmSource: stringValue(input.utmSource, 100),
    utmMedium: stringValue(input.utmMedium, 100),
    utmCampaign: stringValue(input.utmCampaign, 150),
    utmContent: stringValue(input.utmContent, 150),
    referrer: stringValue(input.referrer, 500),
  }
}

function origin() {
  return process.env.ALLOWED_ORIGIN || '*'
}

function clientIp(request: IncomingMessage) {
  return request.headers['x-forwarded-for']?.toString().split(',')[0].trim() || request.socket.remoteAddress || 'unknown'
}

function safeEqual(left: string, right: string) {
  const expected = Buffer.from(left)
  const actual = Buffer.from(right)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function sessionSignature(expiresAt: number) {
  const token = process.env.ADMIN_API_TOKEN
  return token ? createHmac('sha256', token).update(String(expiresAt)).digest('hex') : ''
}

function sessionCookie(expiresAt: number) {
  return `${expiresAt}.${sessionSignature(expiresAt)}`
}

function cookieValue(request: IncomingMessage, name: string) {
  const cookieHeader = request.headers.cookie || ''
  return cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || ''
}

function encodeCookiePayload(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decodeCookiePayload<T>(value: string) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

function supabaseCookieSecret() {
  return supabaseKey || process.env.ADMIN_API_TOKEN || ''
}

function supabaseCookie(payload: { accessToken: string; refreshToken: string; expiresAt: number }) {
  const encoded = encodeCookiePayload(payload)
  const signature = createHmac('sha256', supabaseCookieSecret()).update(encoded).digest('hex')
  return `${encoded}.${signature}`
}

function supabaseSession(request: IncomingMessage) {
  const [encoded, signature] = cookieValue(request, supabaseCookieName).split('.')
  if (!encoded || !signature || !supabaseCookieSecret()) return null
  const expected = createHmac('sha256', supabaseCookieSecret()).update(encoded).digest('hex')
  if (!safeEqual(expected, signature)) return null
  return decodeCookiePayload<{ accessToken: string; refreshToken: string; expiresAt: number }>(encoded)
}

async function supabaseAuth(pathname: string, init: RequestInit) {
  if (!supabaseUrl || !supabaseKey) return null
  const response = await fetch(`${supabaseUrl}/auth/v1/${pathname}`, {
    ...init,
    headers: { apikey: supabaseKey, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  return response
}

async function hasSupabaseAccess(request: IncomingMessage) {
  const session = supabaseSession(request)
  if (!session || session.expiresAt <= Math.floor(Date.now() / 1000)) return false
  const response = await supabaseAuth('user', { headers: { Authorization: `Bearer ${session.accessToken}` } })
  if (!response?.ok) return false
  const user = await response.json() as { email?: string }
  const allowedEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  return !allowedEmail || user.email?.toLowerCase() === allowedEmail
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

async function hasAdminAccess(request: IncomingMessage) {
  const configuredToken = process.env.ADMIN_API_TOKEN
  if (configuredToken) {
    const provided = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : ''
    if (safeEqual(configuredToken, provided)) return true
  }
  if (!configuredToken && process.env.NODE_ENV !== 'production') return true
  return hasSupabaseAccess(request)
}

async function json(response: ServerResponse, status: number, payload: unknown, extraHeaders: Record<string, string> = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': origin(),
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  })
  response.end(JSON.stringify(payload))
}

async function runCampaign(product: ProductConfig) {
  const discovered = await discoverGoogleNews(product)
  const evaluated = await Promise.all(discovered.slice(0, 6).map(async (trend) => ({ trend, evaluation: await evaluateTrend(trend, product) })))
  const approved = evaluated.filter((item) => item.evaluation.score >= Number(process.env.MIN_TREND_SCORE || 70)).slice(0, 3)
  await Promise.all(evaluated.map(({ trend, evaluation }) => saveTrend(trend, evaluation, evaluation.score >= Number(process.env.MIN_TREND_SCORE || 70) ? 'approved' : 'review')))
  const campaigns: Campaign[] = []
  const generated = await Promise.all(approved.map(async ({ trend, evaluation }) => {
    const campaignId = randomUUID()
    const campaignSlug = `${slug(product.name)}-${slug(trend.topic)}`
    const landingUrl = new URL(product.url)
    landingUrl.searchParams.set('utm_campaign', campaignSlug)
    const links = Object.fromEntries(['linkedin', 'twitter', 'reddit', 'email', 'instagram', 'tiktok', 'youtube', 'pinterest'].map((channel) => {
      const link = new URL(landingUrl)
      link.searchParams.set('utm_source', channel)
      link.searchParams.set('utm_medium', 'organic')
      link.searchParams.set('utm_content', campaignId)
      return [channel, link.toString()]
    }))
    return { id: campaignId, product, trend, evaluation, content: { ...await generateContent(trend, evaluation, product), tracking: { campaign: campaignSlug, links } }, provider: currentProvider(), createdAt: new Date().toISOString() } satisfies Campaign
  }))
  for (const campaign of generated) {
    const saved = await saveCampaign(campaign)
    await saveQueueItems(saved.id, ['linkedin', 'instagram', 'tiktok', 'youtube', 'pinterest', 'email'])
    campaigns.push(saved)
  }
  return { discovered: discovered.length, approved: approved.length, campaigns }
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'campaign'
}

export async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (request.method === 'OPTIONS') return json(response, 204, null)
    if (url.pathname === '/api/health') return json(response, 200, { ok: true, provider: currentProvider(), publisher: currentPublisher(), storage: storageProvider, time: new Date().toISOString() })
    if (url.pathname === '/api/admin/login' && request.method === 'POST') {
      const input = await body(request)
      if (typeof input.token !== 'string' || !safeEqual(process.env.ADMIN_API_TOKEN || '', input.token)) return json(response, 401, { error: 'Invalid admin token' })
      const expiresAt = Math.floor(Date.now() / 1000) + adminSessionMaxAge
      return json(response, 200, { authenticated: true, expiresAt }, { 'Set-Cookie': `${adminCookieName}=${sessionCookie(expiresAt)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${adminSessionMaxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` })
    }
    if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
      return json(response, 200, { authenticated: false }, { 'Set-Cookie': `${adminCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` })
    }
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      const input = await body(request)
      if (typeof input.email !== 'string' || typeof input.password !== 'string') return json(response, 400, { error: 'Email and password are required.' })
      const authResponse = await supabaseAuth('token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: input.email.trim().toLowerCase(), password: input.password }) })
      if (!authResponse?.ok) return json(response, 401, { error: 'Invalid email or password.' })
      const session = await authResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number; user?: { email?: string } }
      if (!session.access_token || !session.refresh_token) return json(response, 401, { error: 'Supabase Auth did not return a session.' })
      const allowedEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase()
      if (allowedEmail && session.user?.email?.toLowerCase() !== allowedEmail) return json(response, 403, { error: 'This account is not allowed to access the operator console.' })
      const expiresAt = Math.floor(Date.now() / 1000) + (session.expires_in || 3600)
      return json(response, 200, { authenticated: true, user: { email: session.user?.email } }, { 'Set-Cookie': `${supabaseCookieName}=${supabaseCookie({ accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt })}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${supabaseSessionMaxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` })
    }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      return json(response, 200, { authenticated: false }, { 'Set-Cookie': `${supabaseCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` })
    }
    if (url.pathname === '/api/admin/session' && request.method === 'GET') return json(response, 200, { authenticated: await hasAdminAccess(request) })
    if (url.pathname === '/api/trends/discover' && request.method === 'GET') {
      if (!await hasAdminAccess(request)) return json(response, 401, { error: 'Unauthorized' })
      if (!consumeRateLimit(`trends:${clientIp(request)}`, 10)) return json(response, 429, { error: 'Rate limit exceeded' })
      return json(response, 200, { trends: await discoverGoogleNews(productFrom({ country: url.searchParams.get('country') ?? undefined })) })
    }
    if (url.pathname === '/api/campaigns/run' && request.method === 'POST') {
      if (!await hasAdminAccess(request)) return json(response, process.env.ADMIN_API_TOKEN ? 401 : 503, { error: process.env.ADMIN_API_TOKEN ? 'Unauthorized' : 'Admin API is not configured' })
      if (!consumeRateLimit(`campaign:${clientIp(request)}`, 5)) return json(response, 429, { error: 'Rate limit exceeded' })
      const input = await body(request)
      const product = productFrom(input.product)
      const jobId = await startJobRun('campaign_pipeline', { product })
      try {
        const result = await runCampaign(product)
        await finishJobRun(jobId, 'succeeded', result)
        return json(response, 200, result)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Campaign pipeline failed'
        await finishJobRun(jobId, 'failed', {}, message)
        throw error
      }
    }
    if (url.pathname === '/api/campaigns/latest' && request.method === 'GET') {
      if (!await hasAdminAccess(request)) return json(response, process.env.ADMIN_API_TOKEN ? 401 : 503, { error: process.env.ADMIN_API_TOKEN ? 'Unauthorized' : 'Admin API is not configured' })
      const campaigns = (await latestCampaigns()).filter((campaign) => campaign.product.name === defaultProduct.name)
      return json(response, 200, { campaigns })
    }
    if (url.pathname === '/api/dashboard' && request.method === 'GET') {
      if (!await hasAdminAccess(request)) return json(response, process.env.ADMIN_API_TOKEN ? 401 : 503, { error: process.env.ADMIN_API_TOKEN ? 'Unauthorized' : 'Admin API is not configured' })
      const fullSnapshot = await dashboardSnapshot()
      const campaigns = fullSnapshot.campaigns.filter((campaign) => campaign.product.name === defaultProduct.name)
      const snapshot = { ...fullSnapshot, campaigns, queue: fullSnapshot.queue.filter((item) => campaigns.some((campaign) => campaign.id === item.campaignId)) }
      return json(response, 200, snapshot)
    }
    if (url.pathname === '/api/settings' && request.method === 'GET') {
      if (!await hasAdminAccess(request)) return json(response, process.env.ADMIN_API_TOKEN ? 401 : 503, { error: process.env.ADMIN_API_TOKEN ? 'Unauthorized' : 'Admin API is not configured' })
      return json(response, 200, {
        product: defaultProduct,
        ai: { provider: currentProvider(), model: process.env.OPENAI_MODEL || 'gpt-5-mini' },
        publishing: { provider: currentPublisher(), configured: Boolean(process.env.PUBLISH_WEBHOOK_URL) },
        storage: storageProvider,
        automation: { dailyWorkflow: true, workflowFile: 'automation/vinted-signal-daily.json' },
      })
    }
    if ((url.pathname === '/api/publishing/publish' || url.pathname === '/api/publishing/process') && request.method === 'POST') {
      if (!await hasAdminAccess(request)) return json(response, process.env.ADMIN_API_TOKEN ? 401 : 503, { error: process.env.ADMIN_API_TOKEN ? 'Unauthorized' : 'Admin API is not configured' })
      const fullSnapshot = await dashboardSnapshot()
      const campaigns = fullSnapshot.campaigns.filter((campaign) => campaign.product.name === defaultProduct.name)
      const snapshot = { ...fullSnapshot, campaigns, queue: fullSnapshot.queue.filter((item) => campaigns.some((campaign) => campaign.id === item.campaignId)) }
      const input = await body(request)
      const requestedIds = url.pathname.endsWith('/publish') && typeof input.queueId === 'string' ? [input.queueId] : snapshot.queue.filter((item) => item.status === 'queued' && new Date(item.scheduledFor).getTime() <= Date.now()).map((item) => item.id)
      const results = []
      for (const queueId of requestedIds) {
        const item = snapshot.queue.find((candidate) => candidate.id === queueId)
        const campaign = item?.campaignId ? snapshot.campaigns.find((candidate) => candidate.id === item.campaignId) : undefined
        if (!item || !campaign) {
          results.push({ queueId, status: 'failed', error: 'Campaign payload is not available for this queue item.' })
          continue
        }
        try {
          const published = await publishQueuedItem(item, campaign)
          await updateQueueItem(item.id, { status: 'published', attempts: item.attempts + 1, externalId: published.externalId, lastError: undefined })
          results.push({ queueId, status: 'published', externalId: published.externalId })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Publishing failed'
          await updateQueueItem(item.id, { status: 'failed', attempts: item.attempts + 1, lastError: message })
          results.push({ queueId, status: 'failed', error: message })
        }
      }
      return json(response, 200, { publisher: currentPublisher(), results })
    }
    if (url.pathname === '/api/waitlist' && request.method === 'POST') {
      if (!consumeRateLimit(`waitlist:${clientIp(request)}`, 10)) return json(response, 429, { error: 'Rate limit exceeded' })
      const input = await body(request)
      if (typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return json(response, 400, { error: 'A valid email is required.' })
      const attribution = attributionFrom(input)
      await saveFunnelEvent({ ...attribution, event: 'waitlist_signup', path: stringValue(input.path, 500) })
      return json(response, 201, await saveLead(input.email.trim().toLowerCase(), attribution))
    }
    if (url.pathname === '/api/events' && request.method === 'POST') {
      if (!consumeRateLimit(`events:${clientIp(request)}`, 60)) return json(response, 429, { error: 'Rate limit exceeded' })
      const input = await body(request)
      if (input.event !== 'page_view') return json(response, 400, { error: 'Unsupported event.' })
      return json(response, 201, await saveFunnelEvent({ ...attributionFrom(input), event: 'page_view', sessionId: stringValue(input.sessionId, 100), path: stringValue(input.path, 500) } satisfies FunnelEvent))
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
