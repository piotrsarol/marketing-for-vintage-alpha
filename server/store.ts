import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Campaign } from './types.js'

const dataDirectory = path.resolve(process.cwd(), '.data')

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

export async function saveCampaign(campaign: Campaign) {
  const campaigns = await readCollection<Campaign>('campaigns')
  await writeCollection('campaigns', [campaign, ...campaigns].slice(0, 100))
  return campaign
}

export async function latestCampaigns() {
  return readCollection<Campaign>('campaigns')
}

export async function saveLead(email: string, source: string) {
  const leads = await readCollection<{ email: string; source: string; createdAt: string }>('leads')
  if (!leads.some((lead) => lead.email.toLowerCase() === email.toLowerCase())) {
    leads.unshift({ email, source, createdAt: new Date().toISOString() })
    await writeCollection('leads', leads)
  }
  return { email, source }
}
