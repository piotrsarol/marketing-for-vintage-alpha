export type ProductConfig = {
  name: string
  url: string
  description: string
  audience: string[]
  callToAction: string
  country: string
  searchQuery?: string
}

export type TrendSignal = {
  topic: string
  category: string
  source: string
  url: string
  country: string
  season: string
  keywords: string[]
  evidence: string
}

export type Evaluation = {
  score: number
  virality: number
  commercialIntent: number
  novelty: number
  evergreenScore: number
  vintedRelevance: number
  predictedEngagement: number
  reasoning: string
  contentAngles: string[]
  hooks: string[]
  targetAudience: string[]
}

export type Campaign = {
  id: string
  product: ProductConfig
  trend: TrendSignal
  evaluation: Evaluation
  content: Record<string, unknown>
  provider: 'openai' | 'mock'
  createdAt: string
}

export type LeadAttribution = {
  source: string
  landingVariant?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  referrer?: string
}

export type FunnelEvent = LeadAttribution & {
  event: 'page_view' | 'waitlist_signup'
  sessionId?: string
  path?: string
}
