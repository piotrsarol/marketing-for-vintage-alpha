import { deflateSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Campaign } from './types.js'

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '')
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const bucket = 'campaign-assets'

function crc32(buffer: Buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer) {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

function brandedPng() {
  const width = 1080
  const height = 1080
  const pixels = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1)
    pixels[row] = 0
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4
      const isDarkPanel = x > 96 && x < 984 && y > 160 && y < 830
      const isLavender = x > 730 && y < 300
      const isCoral = x < 300 && y > 760
      pixels[offset] = isLavender ? 182 : isCoral ? 237 : isDarkPanel ? 38 : 247
      pixels[offset + 1] = isLavender ? 164 : isCoral ? 137 : isDarkPanel ? 34 : 243
      pixels[offset + 2] = isLavender ? 255 : isCoral ? 127 : isDarkPanel ? 45 : 235
      pixels[offset + 3] = 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

async function ensureBucket() {
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase storage is required to generate Instagram assets.')
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
  const existing = await fetch(`${supabaseUrl}/storage/v1/bucket/${bucket}`, { headers })
  if (existing.ok) return
  if (existing.status !== 404) {
    throw new Error(`Supabase asset bucket lookup failed with ${existing.status}`)
  }

  const response = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bucket, name: bucket, public: true }),
  })
  if (!response.ok && response.status !== 409) throw new Error(`Supabase asset bucket setup failed with ${response.status}`)
}

export async function campaignImageUrl(campaign: Campaign) {
  const content = campaign.content as Record<string, unknown>
  if (typeof content.imageUrl === 'string') return content.imageUrl
  if (typeof process.env.BUFFER_DEFAULT_IMAGE_URL === 'string' && process.env.BUFFER_DEFAULT_IMAGE_URL) return process.env.BUFFER_DEFAULT_IMAGE_URL
  await ensureBucket()
  const objectPath = `${campaign.id}.png`
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey as string,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: brandedPng(),
  })
  if (!response.ok) throw new Error(`Supabase campaign asset upload failed with ${response.status}`)
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
}

export async function campaignVideoUrl(campaign: Campaign) {
  const content = campaign.content as Record<string, unknown>
  if (typeof content.videoUrl === 'string') return content.videoUrl
  if (process.env.BUFFER_DEFAULT_VIDEO_URL) return process.env.BUFFER_DEFAULT_VIDEO_URL
  await ensureBucket()
  const objectPath = `${campaign.id}.mp4`
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey as string,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'video/mp4',
      'x-upsert': 'true',
    },
    body: await readFile(join(process.cwd(), 'public', 'vintage-alpha-short.mp4')),
  })
  if (!response.ok) throw new Error(`Supabase campaign video upload failed with ${response.status}`)
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
}
