import type { Campaign, QueueItem } from './types.js'

export type PublisherName = 'buffer' | 'webhook' | 'mock'

export function currentPublisher(): PublisherName {
  return process.env.BUFFER_ACCESS_TOKEN ? 'buffer' : process.env.PUBLISH_WEBHOOK_URL ? 'webhook' : 'mock'
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

async function publishToBuffer(item: QueueItem, campaign: Campaign) {
  const channelId = bufferChannelId(item.platform)
  if (!channelId) throw new Error(`No Buffer channel configured for ${item.platform}. Set BUFFER_CHANNEL_${item.platform.toUpperCase()} or BUFFER_CHANNEL_IDS.`)
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
        input: {
          text: campaignText(item.platform, campaign),
          channelId,
          schedulingType: 'automatic',
          mode: 'customScheduled',
          dueAt: item.scheduledFor,
        },
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
