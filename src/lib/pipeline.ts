export type TrendSignal = {
  topic: string
  category: string
  source: string
  url?: string
  country: string
  season?: string
  keywords: string[]
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

export type Campaign = { trend: TrendSignal; evaluation: Evaluation; assets: Record<string, unknown> }

export interface TrendSource { discover(country: string): Promise<TrendSignal[]> }
export interface TrendEvaluator { evaluate(signal: TrendSignal): Promise<Evaluation> }
export interface ContentGenerator { generate(signal: TrendSignal, evaluation: Evaluation): Promise<Campaign> }

export class MockTrendSource implements TrendSource {
  async discover(country: string): Promise<TrendSignal[]> {
    return [{ topic: 'Adidas Samba OG', category: 'sneakers', source: 'mock', country, season: 'summer', keywords: ['samba', 'sneakers', 'resale'] }]
  }
}

export class MockTrendEvaluator implements TrendEvaluator {
  async evaluate(signal: TrendSignal): Promise<Evaluation> {
    return { score: 94, virality: 91, commercialIntent: 96, novelty: 84, evergreenScore: 72, vintedRelevance: 95, predictedEngagement: 88, reasoning: `${signal.topic} has rising momentum and strong resale relevance.`, contentAngles: ['early signal', 'saturation check'], hooks: ['The market is moving before the feed catches up.'], targetAudience: ['Vinted sellers', 'sneaker resellers'] }
  }
}

export class MockContentGenerator implements ContentGenerator {
  async generate(signal: TrendSignal, evaluation: Evaluation): Promise<Campaign> {
    return { trend: signal, evaluation, assets: { linkedin: true, instagram: true, tiktok: true, youtubeShort: true, carouselSlides: 8, imageProvider: 'mock' } }
  }
}
