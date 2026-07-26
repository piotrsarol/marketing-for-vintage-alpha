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

const glyphs: Record<string, string[]> = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '11100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
}

function normalizedText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
}

function drawText(
  pixels: Buffer,
  width: number,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: [number, number, number],
  maxCharacters: number,
) {
  const characters = normalizedText(text).slice(0, maxCharacters)
  for (const [characterIndex, character] of [...characters].entries()) {
    const glyph = glyphs[character] || glyphs['-']
    const originX = x + characterIndex * (6 * scale)
    for (const [rowIndex, row] of glyph.entries()) {
      for (const [columnIndex, pixel] of [...row].entries()) {
        if (pixel !== '1') continue
        for (let pixelY = 0; pixelY < scale; pixelY += 1) {
          for (let pixelX = 0; pixelX < scale; pixelX += 1) {
            const targetX = originX + columnIndex * scale + pixelX
            const targetY = y + rowIndex * scale + pixelY
            if (targetX < 0 || targetX >= width || targetY < 0) continue
            const offset = targetY * (width * 4 + 1) + 1 + targetX * 4
            pixels[offset] = color[0]
            pixels[offset + 1] = color[1]
            pixels[offset + 2] = color[2]
            pixels[offset + 3] = 255
          }
        }
      }
    }
  }
}

function brandedPng(campaign: Campaign) {
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
  const topic = campaign.trend.topic
  const category = campaign.evaluation.productCategory || campaign.trend.category
  const marketplace = campaign.trend.marketplace
  drawText(pixels, width, 'VINTED SIGNAL', 118, 215, 8, [247, 243, 235], 18)
  drawText(pixels, width, topic, 118, 350, 9, [255, 255, 255], 15)
  drawText(pixels, width, category, 118, 475, 5, [182, 164, 255], 25)
  if (marketplace) {
    drawText(
      pixels,
      width,
      `${marketplace.listingCount} LISTINGS`,
      118,
      650,
      5,
      [237, 137, 127],
      18,
    )
    drawText(
      pixels,
      width,
      `${marketplace.medianPrice} ${marketplace.currency}`,
      118,
      705,
      5,
      [237, 137, 127],
      18,
    )
  }
  drawText(pixels, width, 'VINTAGE ALPHA', 118, 880, 5, [38, 34, 45], 20)
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
    body: brandedPng(campaign),
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
