/**
 * Sentifi - Signal Processing Types
 *
 * Types for the signal processing layer.
 */

import type { SentimentSignal, MomentumSignal, AggregatedSignal, Recommendation } from '../types.js';

/** Input for sentiment analysis */
export interface SentimentAnalysisInput {
  symbol: string;
  items: Array<{
    source: string;
    title: string;
    content?: string;
    timestamp: Date;
    engagement: number;
  }>;
  config: SentimentAnalysisConfig;
}

/** Configuration for sentiment analysis */
export interface SentimentAnalysisConfig {
  /** Hours after which posts get reduced weight */
  recencyDecayHours: number;
  /** Enable negation detection */
  negationEnabled: boolean;
  /** Minimum items for reliable confidence */
  minDataPoints: number;
  /** Custom keyword dictionaries */
  keywords?: {
    bullish?: string[];
    bearish?: string[];
    negations?: string[];
  };
  /** Source weights (default: reddit=1.0, tavily=0.8) */
  sourceWeights?: Record<string, number>;
}

/** Keyword match result */
export interface KeywordMatch {
  keyword: string;
  sentiment: 'bullish' | 'bearish';
  weight: number;
  negated: boolean;
  context?: string;
}

/** Per-item analysis result */
export interface ItemAnalysis {
  source: string;
  title: string;
  rawScore: number;
  adjustedScore: number;
  recencyMultiplier: number;
  engagementMultiplier: number;
  matches: KeywordMatch[];
  negationAdjustment: number;
}

/** Signal aggregation config */
export interface SignalAggregationConfig {
  sentimentWeight: number;
  momentumWeight: number;
  minConfidenceThreshold: number;
}

/** Map score to recommendation */
export function scoreToRecommendation(
  score: number,
  confidence: number,
  bullishThreshold: number,
  bearishThreshold: number,
): Recommendation {
  if (confidence < 0.3) return 'hold'; // Low confidence = hold

  if (score >= bullishThreshold * 1.5) return 'strong_buy';
  if (score >= bullishThreshold) return 'buy';
  if (score <= bearishThreshold * 1.5) return 'strong_sell';
  if (score <= bearishThreshold) return 'sell';

  return 'hold';
}

/** Map score to sentiment label */
export function scoreToLabel(score: number): SentimentSignal['label'] {
  if (score >= 60) return 'very_bullish';
  if (score >= 25) return 'bullish';
  if (score <= -60) return 'very_bearish';
  if (score <= -25) return 'bearish';
  return 'neutral';
}
