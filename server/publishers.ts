import type { Campaign, QueueItem } from './types.js'
import { campaignImageUrl, campaignVideoUrl } from './assets.js'

export type PublisherName = 'buffer' | 'webhook' | 'mock'

export function currentPublisher(): PublisherName {
  return process.env.BUFFER_ACCESS_TOKEN ? 'buffer' : process.env.PUBLISH_WEBHOOK_URL ? 'webhook' : 'mock'
}

export function configuredPublisherPlatforms(): string[] {
  if (process.env.BUFFER_ACCESS_TOKEN) {
    try {
      const channels = JSON.parse(process.env.BUFFER_CHANNEL_IDS || '{}') as Record<string, unknown>
      return Object.keys(channels).filter((platform) => typeof channels[platform] === 'string' && channels[platform])
    } catch {
      return []
    }
  }
  return ['linkedin', 'instagram', 'tiktok', 'youtube', 'pinterest', 'email']
}

export function publisherConfigured() {
  return currentPublisher() === 'buffer'
    ? configuredPublisherPlatforms().length > 0
    : currentPublisher() === 'webhook'
}

export async function publishQueuedItem(item: QueueItem, campaign: Campaign) {
  if (process.env.BUFFER_ACCESS_TOKEN) return publishToBuffer(item, campaign)
  const webhook = process.env.PUBLISH_WEBHOOK_URL
  if (!webhook) throw new Error('No publishing provider is configured. Set PUBLISH_WEBHOOK_URL to an n8n/Buffer publishing webhook.')
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: item.platform, scheduledFor: item.scheduledFor, campaign }),
  })
  if (!response.ok) throw new Error(`Publishing provider returned ${response.status}`)
  return { externalId: response.headers.get('x-publish-id') || `webhook-${item.id}` }
}

export async function removeFromPublisher(item: QueueItem) {
  if (!process.env.BUFFER_ACCESS_TOKEN) throw new Error('Buffer is not configured.')
  if (!item.externalId) throw new Error('Queue item has no Buffer post ID.')

  const response = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.BUFFER_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `mutation DeletePost($input: DeletePostInput!) {
        deletePost(input: $input) {
          ... on DeletePostSuccess { id }
          ... on VoidMutationError { message }
        }
      }`,
      variables: { input: { id: item.externalId } },
    }),
  })
  if (!response.ok) throw new Error(`Buffer returned ${response.status}`)
  const payload = await response.json() as { data?: { deletePost?: { id?: string; message?: string } }; errors?: Array<{ message?: string }> }
  const error = payload.errors?.map((entry) => entry.message).filter(Boolean).join('; ') || payload.data?.deletePost?.message
  if (error || !payload.data?.deletePost?.id) throw new Error(error || 'Buffer did not confirm post deletion.')
  return { externalId: payload.data.deletePost.id }
}

function bufferChannelId(platform: string) {
  const key = `BUFFER_CHANNEL_${platform.toUpperCase()}`
  const direct = process.env[key]
  if (direct) return direct
  try {
    const channels = JSON.parse(process.env.BUFFER_CHANNEL_IDS || '{}') as Record<string, unknown>
    return typeof channels[platform] === 'string' ? channels[platform] : undefined
  } catch {
    throw new Error('BUFFER_CHANNEL_IDS must be valid JSON.')
  }
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join('\n\n')
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  return ['body', 'content', 'caption', 'script', 'text', 'title'].map((key) => contentText(record[key])).filter(Boolean).join('\n\n')
}

function campaignText(platform: string, campaign: Campaign) {
  const value = campaign.content[platform] ?? campaign.content.linkedin
  const text = contentText(value)
  return text || `${campaign.trend.topic}\n\n${campaign.product.callToAction}`
}

function contentImageUrl(campaign: Campaign): string | undefined {
  const content = campaign.content as Record<string, unknown>
  const assets = content.assets
  if (Array.isArray(assets)) {
    const asset = assets.find((entry): entry is { image?: { url?: unknown } } => Boolean(entry && typeof entry === 'object'))
    if (typeof asset?.image?.url === 'string') return asset.image.url
  }
  if (typeof content.imageUrl === 'string') return content.imageUrl
  return undefined
}

async function publishToBuffer(item: QueueItem, campaign: Campaign) {
  const channelId = bufferChannelId(item.platform)
  if (!channelId) throw new Error(`No Buffer channel configured for ${item.platform}. Set BUFFER_CHANNEL_${item.platform.toUpperCase()} or BUFFER_CHANNEL_IDS.`)
  const isInstagram = item.platform === 'instagram'
  const isFacebook = item.platform === 'facebook'
  const isYouTube = item.platform === 'youtube'
  const imageUrl = isInstagram || isFacebook ? contentImageUrl(campaign) || await campaignImageUrl(campaign) : undefined
  const videoUrl = isYouTube ? await campaignVideoUrl(campaign) : undefined
  const youtubeTitle = `${campaign.trend.topic} | Vintage Alpha`.slice(0, 100)
  const isDue = new Date(item.scheduledFor).getTime() <= Date.now()
  const input = {
    text: campaignText(item.platform, campaign),
    channelId,
    schedulingType: 'automatic',
    mode: isDue ? 'shareNow' : 'customScheduled',
    ...(isDue ? {} : { dueAt: item.scheduledFor }),
    ...(imageUrl ? { assets: [{ image: { url: imageUrl } }] } : {}),
    ...(videoUrl ? { assets: [{ video: { url: videoUrl } }] } : {}),
    ...(isFacebook ? { metadata: { facebook: { type: 'post' } } } : {}),
    ...(isInstagram ? { metadata: { instagram: { type: 'post', shouldShareToFeed: true } } } : {}),
    ...(isYouTube ? {
      metadata: {
        youtube: {
          title: youtubeTitle,
          categoryId: '22',
          privacy: 'public',
          license: 'youtube',
          madeForKids: false,
          notifySubscribers: true,
        },
      },
    } : {}),
  }
  const response = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.BUFFER_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          ... on PostActionSuccess { post { id dueAt } }
          ... on MutationError { message }
        }
      }`,
      variables: {
        input,
      },
    }),
  })
  if (!response.ok) throw new Error(`Buffer returned ${response.status}`)
  const payload = await response.json() as { data?: { createPost?: { post?: { id?: string }; message?: string } }; errors?: Array<{ message?: string }> }
  const error = payload.errors?.map((entry) => entry.message).filter(Boolean).join('; ') || payload.data?.createPost?.message
  const externalId = payload.data?.createPost?.post?.id
  if (error || !externalId) throw new Error(error || 'Buffer did not return a post id.')
  return { externalId }
}
