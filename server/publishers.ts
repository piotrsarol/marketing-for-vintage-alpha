import type { Campaign, QueueItem } from './types.js'

export type PublisherName = 'webhook' | 'mock'

export function currentPublisher(): PublisherName {
  return process.env.PUBLISH_WEBHOOK_URL ? 'webhook' : 'mock'
}

export async function publishQueuedItem(item: QueueItem, campaign: Campaign) {
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
