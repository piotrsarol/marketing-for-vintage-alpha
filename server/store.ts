import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Campaign, FunnelEvent, LeadAttribution } from './types.js'

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
      await supabaseRequest('campaigns', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'draft', payload: campaign, created_at: campaign.createdAt }) })
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
