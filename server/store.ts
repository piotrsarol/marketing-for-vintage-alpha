import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Campaign, DashboardSnapshot, DashboardTrend, FunnelEvent, LeadAttribution, QueueItem, TrendSignal, Evaluation } from './types.js'

const dataDirectory = path.resolve(process.cwd(), '.data')
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '')
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
export const storageProvider = supabaseUrl && supabaseKey ? 'supabase' : 'local'
const storageTimeoutMs = 10_000

async function ensureDataDirectory() {
  await mkdir(dataDirectory, { recursive: true })
}

async function readCollection<T>(name: string): Promise<T[]> {
  await ensureDataDirectory()
  try {
    return JSON.parse(await readFile(path.join(dataDirectory, `${name}.json`), 'utf8')) as T[]
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
}

async function writeCollection<T>(name: string, records: T[]) {
  await ensureDataDirectory()
  await writeFile(path.join(dataDirectory, `${name}.json`), JSON.stringify(records, null, 2))
}

async function supabaseRequest<T>(resource: string, init?: RequestInit): Promise<T> {
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase storage is not configured')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), storageTimeoutMs)
  let response: Response
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/${resource}`, {
      ...init,
      signal: controller.signal,
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) throw new Error(`Supabase request failed with ${response.status}: ${await response.text()}`)
  const text = await response.text()
  return text ? JSON.parse(text) as T : undefined as T
}

export async function saveCampaign(campaign: Campaign) {
  if (storageProvider === 'supabase') {
    try {
      await supabaseRequest('campaigns', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id: campaign.id, status: 'draft', payload: campaign, created_at: campaign.createdAt }) })
      return campaign
    } catch (error) {
      console.warn(error instanceof Error ? error.message : 'Supabase campaign write failed; using local storage.')
      if (process.env.NODE_ENV === 'production') throw error
    }
  }
  const campaigns = await readCollection<Campaign>('campaigns')
  await writeCollection('campaigns', [campaign, ...campaigns].slice(0, 100))
  return campaign
}

export async function saveTrend(signal: TrendSignal, evaluation: Evaluation, status: DashboardTrend['status']) {
  const trend: DashboardTrend = { ...signal, ...evaluation, id: randomUUID(), status, discoveredAt: new Date().toISOString() }
  if (storageProvider === 'supabase') {
    try {
      await supabaseRequest('trends', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
        id: trend.id,
        topic: trend.topic,
        category: trend.category,
        confidence: trend.score,
        source: trend.source,
        url: trend.url,
        country: trend.country,
        season: trend.season,
        keywords: trend.keywords,
        virality: trend.virality,
        commercial_intent: trend.commercialIntent,
        novelty: trend.novelty,
        evergreen_score: trend.evergreenScore,
        vinted_relevance: trend.vintedRelevance,
        predicted_engagement: trend.predictedEngagement,
        reasoning: trend.reasoning,
        content_angles: trend.contentAngles,
        hooks: trend.hooks,
        target_audience: trend.targetAudience,
        status: trend.status,
        discovered_at: trend.discoveredAt,
      }) })
      return trend
    } catch (error) {
      console.warn(error instanceof Error ? error.message : 'Supabase trend write failed; using local storage.')
      if (process.env.NODE_ENV === 'production') throw error
    }
  }
  const trends = await readCollection<DashboardTrend>('trends')
  await writeCollection('trends', [trend, ...trends].slice(0, 200))
  return trend
}

export async function latestCampaigns() {
  if (storageProvider === 'supabase') {
    try {
      const records = await supabaseRequest<Array<{ payload: Campaign }>>('campaigns?select=payload&order=created_at.desc&limit=100')
      return records.map((record) => record.payload)
    } catch (error) {
      console.warn(error instanceof Error ? error.message : 'Supabase campaign read failed; using local storage.')
      if (process.env.NODE_ENV === 'production') throw error
    }
  }
  return readCollection<Campaign>('campaigns')
}

export async function saveQueueItems(campaignId: string, platforms: string[]) {
  const items = platforms.map((platform, index) => ({
    id: randomUUID(),
    campaignId,
    platform,
    scheduledFor: new Date(Date.now() + (index + 1) * 60 * 60 * 1000).toISOString(),
    status: 'queued' as const,
    attempts: 0,
  }))
  if (storageProvider === 'supabase') {
    try {
      await supabaseRequest('publishing_queue', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(items.map((item) => ({
        id: item.id,
        campaign_id: item.campaignId,
        platform: item.platform,
        scheduled_for: item.scheduledFor,
        status: item.status,
        attempts: item.attempts,
      }))) })
      return items
    } catch (error) {
      console.warn(error instanceof Error ? error.message : 'Supabase queue write failed; using local storage.')
      if (process.env.NODE_ENV === 'production') throw error
    }
  }
  const queue = await readCollection<QueueItem>('publishing-queue')
  await writeCollection('publishing-queue', [...items, ...queue].slice(0, 500))
  return items
}

export async function updateQueueItem(id: string, update: Partial<Pick<QueueItem, 'status' | 'attempts' | 'externalId' | 'lastError'>>) {
  if (storageProvider === 'supabase') {
    await supabaseRequest(`publishing_queue?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      ...(update.status ? { status: update.status } : {}),
      ...(update.attempts !== undefined ? { attempts: update.attempts } : {}),
      ...(update.externalId ? { external_id: update.externalId } : {}),
      ...(update.lastError ? { last_error: update.lastError } : {}),
    }) })
    return
  }
  const queue = await readCollection<QueueItem>('publishing-queue')
  await writeCollection('publishing-queue', queue.map((item) => item.id === id ? { ...item, ...update } : item))
}

export async function saveLead(email: string, attribution: LeadAttribution) {
  if (storageProvider === 'supabase') {
    try {
      await supabaseRequest('waitlist_leads?on_conflict=email', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({
        email,
        source: attribution.source,
        landing_variant: attribution.landingVariant,
        utm_source: attribution.utmSource,
        utm_medium: attribution.utmMedium,
        utm_campaign: attribution.utmCampaign,
        utm_content: attribution.utmContent,
        referrer: attribution.referrer,
      }) })
      return { email, ...attribution }
    } catch (error) {
      console.warn(error instanceof Error ? error.message : 'Supabase lead write failed; using local storage.')
      if (process.env.NODE_ENV === 'production') throw error
    }
  }
  const leads = await readCollection<{ email: string; createdAt: string } & LeadAttribution>('leads')
  if (!leads.some((lead) => lead.email.toLowerCase() === email.toLowerCase())) {
    leads.unshift({ email, ...attribution, createdAt: new Date().toISOString() })
    await writeCollection('leads', leads)
  }
  return { email, ...attribution }
}

export async function saveFunnelEvent(event: FunnelEvent) {
  if (storageProvider === 'supabase') {
    try {
      await supabaseRequest('funnel_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
        event: event.event,
        session_id: event.sessionId,
        path: event.path,
        source: event.source,
        landing_variant: event.landingVariant,
        utm_source: event.utmSource,
        utm_medium: event.utmMedium,
        utm_campaign: event.utmCampaign,
        utm_content: event.utmContent,
        referrer: event.referrer,
      }) })
      return event
    } catch (error) {
      console.warn(error instanceof Error ? error.message : 'Supabase funnel event write failed; using local storage.')
      if (process.env.NODE_ENV === 'production') throw error
    }
  }
  const events = await readCollection<FunnelEvent & { createdAt: string }>('funnel-events')
  events.unshift({ ...event, createdAt: new Date().toISOString() })
  await writeCollection('funnel-events', events.slice(0, 10000))
  return event
}

export async function dashboardSnapshot(): Promise<DashboardSnapshot> {
  if (storageProvider === 'supabase') {
    try {
      const [trendRows, campaigns, queueRows, leads, events, jobs] = await Promise.all([
        supabaseRequest<Array<Record<string, unknown>>>('trends?select=*&order=discovered_at.desc&limit=100'),
        latestCampaigns(),
        supabaseRequest<Array<Record<string, unknown>>>('publishing_queue?select=*&order=scheduled_for.asc&limit=100'),
        supabaseRequest<Array<{ email: string; source?: string; created_at: string }>>('waitlist_leads?select=email,source,created_at&order=created_at.desc&limit=50'),
        supabaseRequest<Array<{ event: string }>>('funnel_events?select=event&limit=10000'),
        supabaseRequest<Array<{ workflow: string; status: string; started_at: string; finished_at?: string; error?: string }>>('job_runs?select=workflow,status,started_at,finished_at,error&order=started_at.desc&limit=30'),
      ])
      const trends = trendRows.map((row) => ({
        id: String(row.id),
        topic: String(row.topic),
        category: String(row.category),
        source: String(row.source),
        url: typeof row.url === 'string' ? row.url : '',
        country: String(row.country),
        season: typeof row.season === 'string' ? row.season : '',
        keywords: Array.isArray(row.keywords) ? row.keywords.filter((item): item is string => typeof item === 'string') : [],
        score: Number(row.confidence || 0),
        virality: Number(row.virality || 0),
        commercialIntent: Number(row.commercial_intent || 0),
        novelty: Number(row.novelty || 0),
        evergreenScore: Number(row.evergreen_score || 0),
        vintedRelevance: Number(row.vinted_relevance || 0),
        predictedEngagement: Number(row.predicted_engagement || 0),
        reasoning: String(row.reasoning || ''),
        contentAngles: Array.isArray(row.content_angles) ? row.content_angles.filter((item): item is string => typeof item === 'string') : [],
        hooks: Array.isArray(row.hooks) ? row.hooks.filter((item): item is string => typeof item === 'string') : [],
        targetAudience: Array.isArray(row.target_audience) ? row.target_audience.filter((item): item is string => typeof item === 'string') : [],
        evidence: String(row.evidence || row.topic || ''),
        status: row.status === 'approved' || row.status === 'rejected' || row.status === 'review' ? row.status : 'discovered',
        discoveredAt: String(row.discovered_at),
      } satisfies DashboardTrend))
      const queue = queueRows.map((row) => ({
        id: String(row.id),
        campaignId: typeof row.campaign_id === 'string' ? row.campaign_id : undefined,
        platform: String(row.platform),
        scheduledFor: String(row.scheduled_for),
        status: row.status === 'published' || row.status === 'failed' ? row.status : 'queued',
        attempts: Number(row.attempts || 0),
        externalId: typeof row.external_id === 'string' ? row.external_id : undefined,
        lastError: typeof row.last_error === 'string' ? row.last_error : undefined,
      } satisfies QueueItem))
      return {
        trends,
        campaigns,
        queue,
        leads: leads.map((lead) => ({ email: lead.email, source: lead.source, createdAt: lead.created_at })),
        funnel: { pageViews: events.filter((event) => event.event === 'page_view').length, signups: events.filter((event) => event.event === 'waitlist_signup').length },
        jobs: jobs.map((job) => ({ workflow: job.workflow, status: job.status, startedAt: job.started_at, finishedAt: job.finished_at, error: job.error })),
      }
    } catch (error) {
      console.warn(error instanceof Error ? error.message : 'Supabase dashboard read failed; using local storage.')
      if (process.env.NODE_ENV === 'production') throw error
    }
  }
  const [trends, campaigns, queue, leads, events, jobs] = await Promise.all([
    readCollection<DashboardTrend>('trends'),
    readCollection<Campaign>('campaigns'),
    readCollection<QueueItem>('publishing-queue'),
    readCollection<{ email: string; source?: string; createdAt: string }>('leads'),
    readCollection<FunnelEvent & { createdAt: string }>('funnel-events'),
    readCollection<{ workflow: string; status: string; startedAt: string; finishedAt?: string; error?: string }>('job-runs'),
  ])
  return {
    trends,
    campaigns,
    queue,
    leads,
    funnel: { pageViews: events.filter((event) => event.event === 'page_view').length, signups: events.filter((event) => event.event === 'waitlist_signup').length },
    jobs,
  }
}
