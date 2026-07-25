import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Campaign } from './types.js'

const dataDirectory = path.resolve(process.cwd(), '.data')
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '')
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
export const storageProvider = supabaseUrl && supabaseKey ? 'supabase' : 'local'

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
  const response = await fetch(`${supabaseUrl}/rest/v1/${resource}`, {
    ...init,
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!response.ok) throw new Error(`Supabase request failed with ${response.status}: ${await response.text()}`)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function saveCampaign(campaign: Campaign) {
  if (storageProvider === 'supabase') {
    try {
      await supabaseRequest('campaigns', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'draft', payload: campaign, created_at: campaign.createdAt }) })
      return campaign
    } catch (error) {
      console.warn(error instanceof Error ? error.message : 'Supabase campaign write failed; using local storage.')
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
    }
  }
  return readCollection<Campaign>('campaigns')
}

export async function saveLead(email: string, source: string) {
  if (storageProvider === 'supabase') {
    try {
      await supabaseRequest('waitlist_leads', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ email, source }) })
      return { email, source }
    } catch (error) {
      console.warn(error instanceof Error ? error.message : 'Supabase lead write failed; using local storage.')
    }
  }
  const leads = await readCollection<{ email: string; source: string; createdAt: string }>('leads')
  if (!leads.some((lead) => lead.email.toLowerCase() === email.toLowerCase())) {
    leads.unshift({ email, source, createdAt: new Date().toISOString() })
    await writeCollection('leads', leads)
  }
  return { email, source }
}
