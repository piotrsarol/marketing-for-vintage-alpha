import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { deflateSync } from 'node:zlib'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import type { Campaign } from './types.js'

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '')
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const bucket = 'campaign-assets'
const execFileAsync = promisify(execFile)
const ffmpegExecutable = typeof ffmpegPath === 'string' ? ffmpegPath : ffmpegPath.default

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

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[character] || character))
}

function marketOverlay(campaign: Campaign) {
  const marketplace = campaign.trend.marketplace
  const topic = escapeXml(campaign.trend.topic)
  const category = escapeXml(campaign.evaluation.productCategory || campaign.trend.category)
  const listingCount = marketplace?.listingCount || 0
  const price = `${marketplace?.medianPrice || 0} ${marketplace?.currency || 'PLN'}`
  const priceDelta = marketplace?.medianPriceDelta || 0
  const listingDelta = marketplace?.listingCountDelta || 0
  const rising = priceDelta > 0 || listingDelta > 0 || (marketplace?.disappearedListingCount || 0) > 0
  const deltaLabel = rising ? 'RISING SIGNAL' : 'WATCH SIGNAL'
  const deltaColor = rising ? '#56d39a' : '#c8baff'
  const line = rising
    ? 'M 780 315 L 850 290 L 920 305 L 990 250'
    : 'M 780 315 L 850 305 L 920 312 L 990 300'
  return `<svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="1080" height="1080" fill="#17131e" fill-opacity=".7"/>
    <rect x="48" y="48" width="984" height="984" rx="32" fill="none" stroke="#ffffff" stroke-opacity=".28"/>
    <text x="88" y="112" fill="#ffffff" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="4">VINTAGE ALPHA</text>
    <text x="88" y="190" fill="${deltaColor}" font-family="Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="3">${deltaLabel}</text>
    <text x="88" y="720" fill="#ffffff" font-family="Arial, sans-serif" font-size="48" font-weight="700">${topic}</text>
    <text x="88" y="762" fill="#d7ccff" font-family="Arial, sans-serif" font-size="24">${category}</text>
    <rect x="88" y="824" width="420" height="112" rx="18" fill="#17131e" fill-opacity=".86"/>
    <text x="116" y="865" fill="#aaa5af" font-family="Arial, sans-serif" font-size="18">MEDIAN ASKING PRICE</text>
    <text x="116" y="910" fill="#ffffff" font-family="Arial, sans-serif" font-size="34" font-weight="700">${escapeXml(price)}</text>
    <rect x="700" y="210" width="300" height="210" rx="20" fill="#17131e" fill-opacity=".9"/>
    <text x="730" y="255" fill="#aaa5af" font-family="Arial, sans-serif" font-size="16" letter-spacing="2">MARKET MOMENTUM</text>
    <path d="${line}" fill="none" stroke="${deltaColor}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M 975 250 L 990 250 L 990 265" fill="none" stroke="${deltaColor}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="730" y="370" fill="#ffffff" font-family="Arial, sans-serif" font-size="22" font-weight="700">${listingCount} ACTIVE LISTINGS</text>
    <text x="730" y="400" fill="${deltaColor}" font-family="Arial, sans-serif" font-size="18">${rising ? 'Demand proxy is moving up' : 'Collecting baseline data'}</text>
  </svg>`
}

async function productPng(campaign: Campaign) {
  const imageUrl = campaign.trend.marketplace?.imageUrl
  if (!imageUrl) return brandedPng(campaign)
  try {
    const response = await fetch(imageUrl)
    if (!response.ok) throw new Error(`Product image returned ${response.status}`)
    const source = Buffer.from(await response.arrayBuffer())
    return sharp(source)
      .resize(1080, 1080, { fit: 'cover' })
      .composite([{ input: Buffer.from(marketOverlay(campaign)), blend: 'over' }])
      .png()
      .toBuffer()
  } catch (error) {
    console.warn(error instanceof Error ? `Product image preparation failed: ${error.message}` : 'Product image preparation failed')
    return brandedPng(campaign)
  }
}

function verticalOverlay(campaign: Campaign, slide: number, total: number) {
  const marketplace = campaign.trend.marketplace
  const topic = escapeXml(campaign.trend.topic)
  const price = escapeXml(`${marketplace?.medianPrice || 0} ${marketplace?.currency || 'PLN'}`)
  const rising = (marketplace?.medianPriceDelta || 0) > 0
    || (marketplace?.listingCountDelta || 0) > 0
    || (marketplace?.disappearedListingCount || 0) > 0
  const color = rising ? '#56d39a' : '#c8baff'
  return `<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17131e" stop-opacity=".12"/><stop offset="1" stop-color="#17131e" stop-opacity=".94"/></linearGradient></defs>
    <rect width="1080" height="1920" fill="url(#shade)"/>
    <text x="72" y="130" fill="#ffffff" font-family="Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="5">VINTAGE ALPHA</text>
    <rect x="72" y="170" width="310" height="58" rx="29" fill="#17131e" fill-opacity=".82"/>
    <text x="102" y="208" fill="${color}" font-family="Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="2">${rising ? 'RISING SIGNAL' : 'WATCH SIGNAL'}</text>
    <text x="72" y="1540" fill="#ffffff" font-family="Arial, sans-serif" font-size="58" font-weight="700">${topic}</text>
    <text x="72" y="1600" fill="#d7ccff" font-family="Arial, sans-serif" font-size="28">${price} · ${marketplace?.listingCount || 0} active listings</text>
    <rect x="72" y="1660" width="936" height="160" rx="22" fill="#17131e" fill-opacity=".86"/>
    <text x="108" y="1710" fill="#aaa5af" font-family="Arial, sans-serif" font-size="18" letter-spacing="3">MARKET MOMENTUM</text>
    <path d="${rising ? 'M 108 1780 L 330 1760 L 550 1770 L 770 1725 L 960 1690' : 'M 108 1780 L 330 1770 L 550 1778 L 770 1768 L 960 1770'}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="920" y="1710" fill="${color}" font-family="Arial, sans-serif" font-size="20" font-weight="700">${slide + 1}/${total}</text>
  </svg>`
}

async function productSlideshowMp4(campaign: Campaign) {
  if (!ffmpegExecutable) throw new Error('FFmpeg is not available for campaign slideshow generation.')
  const imageUrls = campaign.trend.marketplace?.imageUrls || []
  if (!imageUrls.length) throw new Error('No marketplace images are available for the campaign slideshow.')
  const workDirectory = await mkdtemp(join(tmpdir(), 'vintage-alpha-slideshow-'))
  try {
    const imagePaths: string[] = []
    for (const [index, imageUrl] of imageUrls.entries()) {
      const response = await fetch(imageUrl)
      if (!response.ok) continue
      const slide = await sharp(Buffer.from(await response.arrayBuffer()))
        .resize(1080, 1920, { fit: 'cover' })
        .composite([{ input: Buffer.from(verticalOverlay(campaign, index, imageUrls.length)), blend: 'over' }])
        .png()
        .toBuffer()
      const imagePath = join(workDirectory, `slide-${String(index + 1).padStart(2, '0')}.png`)
      await writeFile(imagePath, slide)
      imagePaths.push(imagePath)
    }
    if (!imagePaths.length) throw new Error('Marketplace image downloads returned no usable slides.')
    const outputPath = join(workDirectory, 'campaign.mp4')
    await execFileAsync(ffmpegExecutable, [
      '-y',
      '-framerate', '1/3',
      '-i', join(workDirectory, 'slide-%02d.png'),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-r', '30',
      '-movflags', '+faststart',
      outputPath,
    ])
    return await readFile(outputPath)
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
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
    body: await productPng(campaign),
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
  let video = await readFile(join(process.cwd(), 'public', 'vintage-alpha-short.mp4'))
  if (campaign.trend.marketplace?.imageUrls?.length) {
    try {
      video = await productSlideshowMp4(campaign)
    } catch (error) {
      console.warn(error instanceof Error ? `Campaign slideshow preparation failed: ${error.message}` : 'Campaign slideshow preparation failed')
    }
  }
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey as string,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'video/mp4',
      'x-upsert': 'true',
    },
    body: video,
  })
  if (!response.ok) throw new Error(`Supabase campaign video upload failed with ${response.status}`)
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
}
