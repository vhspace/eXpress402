/**
 * Sentifi - Enhanced Sentiment Analyzer
 *
 * Processes raw sentiment items into a scored signal with:
 * - Negation detection
 * - Recency weighting
 * - Source credibility
 * - Engagement weighting
 * - Confidence calculation
 */

import type { SentimentSignal, RawSentimentItem } from '../../types.js';
import type { SentimentAnalysisConfig, ItemAnalysis } from '../types.js';
import { scoreToLabel } from '../types.js';
import { findNegatedMatches, calculateNegationAdjustment } from './negation.js';
import {
  calculateRecencyMultiplier,
  calculateEngagementMultiplier,
  getSourceWeight,
  calculateConfidence,
  normalizeScore,
} from './weighting.js';
import { BULLISH_KEYWORDS, BEARISH_KEYWORDS, EMOJI_SENTIMENTS } from './keywords.js';

/** Default analysis configuration */
const DEFAULT_CONFIG: SentimentAnalysisConfig = {
  recencyDecayHours: 24,
  negationEnabled: true,
  minDataPoints: 3,
};

/**
 * Enhanced sentiment analyzer
 */
export class SentimentAnalyzer {
  private config: SentimentAnalysisConfig;
  private bullishKeywords: Array<{ word: string; sentiment: 'bullish'; weight: number }>;
  private bearishKeywords: Array<{ word: string; sentiment: 'bearish'; weight: number }>;

  constructor(config?: Partial<SentimentAnalysisConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Build keyword lists
    this.bullishKeywords = (config?.keywords?.bullish ?? BULLISH_KEYWORDS).map((word) => ({
      word,
      sentiment: 'bullish' as const,
      weight: 1.0,
    }));

    this.bearishKeywords = (config?.keywords?.bearish ?? BEARISH_KEYWORDS).map((word) => ({
      word,
      sentiment: 'bearish' as const,
      weight: 1.0,
    }));
  }

  /**
   * Analyze sentiment from raw items
   */
  analyze(items: RawSentimentItem[]): SentimentSignal {
    if (items.length === 0) {
      return this.createEmptySignal();
    }

    const analyses: ItemAnalysis[] = [];
    const now = new Date();

    // Analyze each item
    for (const item of items) {
      const analysis = this.analyzeItem(item, now);
      analyses.push(analysis);
    }

    // Aggregate by source
    const bySource = this.aggregateBySource(analyses);

    // Calculate overall score
    const totalWeightedScore = analyses.reduce((sum, a) => sum + a.adjustedScore, 0);
    const totalWeight = analyses.reduce(
      (sum, a) => sum + a.recencyMultiplier * a.engagementMultiplier,
      0,
    );
    const normalizedScore = normalizeScore(totalWeightedScore, totalWeight || 1);

    // Calculate confidence
    const avgRecency =
      analyses.reduce((sum, a) => sum + a.recencyMultiplier, 0) / analyses.length;
    const confidence = calculateConfidence(items.length, this.config.minDataPoints, avgRecency);

    // Calculate negation adjustment
    const allMatches = analyses.flatMap((a) => a.matches);
    const negationAdjustment = this.config.negationEnabled
      ? calculateNegationAdjustment(allMatches)
      : 0;

    return {
      score: normalizedScore,
      confidence,
      label: scoreToLabel(normalizedScore),
      components: {
        reddit: bySource.reddit,
        news: bySource.news,
        social: bySource.social,
      },
      recencyFactor: avgRecency,
      negationAdjustment,
      timestamp: now,
    };
  }

  /**
   * Analyze a single item
   */
  private analyzeItem(item: RawSentimentItem, now: Date): ItemAnalysis {
    const text = `${item.title} ${item.content ?? ''}`;

    // Find keyword matches with negation handling
    const allKeywords = [...this.bullishKeywords, ...this.bearishKeywords];
    const matches = this.config.negationEnabled
      ? findNegatedMatches(text, allKeywords)
      : this.findSimpleMatches(text, allKeywords);

    // Add emoji sentiment
    const emojiMatches = this.findEmojiMatches(text);
    const allMatches = [
      ...matches.map((m) => ({
        keyword: m.keyword,
        sentiment: m.sentiment,
        weight: m.weight,
        negated: m.negated,
      })),
      ...emojiMatches,
    ];

    // Calculate raw score from matches
    let rawScore = 0;
    for (const match of allMatches) {
      const direction = match.sentiment === 'bullish' ? 1 : -1;
      rawScore += direction * match.weight;
    }

    // Calculate multipliers
    const recencyMultiplier = calculateRecencyMultiplier(
      item.timestamp,
      this.config.recencyDecayHours,
      now,
    );
    const engagementMultiplier = calculateEngagementMultiplier(item.engagement, item.source);
    const sourceWeight = getSourceWeight(item.source, this.config.sourceWeights);

    // Adjusted score
    const adjustedScore = rawScore * recencyMultiplier * engagementMultiplier * sourceWeight;

    // Calculate negation adjustment for this item
    const negationAdjustment = this.config.negationEnabled
      ? calculateNegationAdjustment(allMatches)
      : 0;

    return {
      source: item.source,
      title: item.title,
      rawScore,
      adjustedScore,
      recencyMultiplier,
      engagementMultiplier,
      matches: allMatches,
      negationAdjustment,
    };
  }

  /**
   * Simple keyword matching (without negation)
   */
  private findSimpleMatches(
    text: string,
    keywords: Array<{ word: string; sentiment: 'bullish' | 'bearish'; weight: number }>,
  ): Array<{ keyword: string; sentiment: 'bullish' | 'bearish'; weight: number; negated: boolean; position: number }> {
    const lowerText = text.toLowerCase();
    const matches: Array<{
      keyword: string;
      sentiment: 'bullish' | 'bearish';
      weight: number;
      negated: boolean;
      position: number;
    }> = [];

    for (const { word, sentiment, weight } of keywords) {
      if (lowerText.includes(word.toLowerCase())) {
        matches.push({
          keyword: word,
          sentiment,
          weight,
          negated: false,
          position: lowerText.indexOf(word.toLowerCase()),
        });
      }
    }

    return matches;
  }

  /**
   * Find emoji sentiment matches
   */
  private findEmojiMatches(
    text: string,
  ): Array<{ keyword: string; sentiment: 'bullish' | 'bearish'; weight: number; negated: boolean }> {
    const matches: Array<{
      keyword: string;
      sentiment: 'bullish' | 'bearish';
      weight: number;
      negated: boolean;
    }> = [];

    for (const [emoji, data] of Object.entries(EMOJI_SENTIMENTS)) {
      if (text.includes(emoji)) {
        matches.push({
          keyword: emoji,
          sentiment: data.sentiment,
          weight: data.weight,
          negated: false,
        });
      }
    }

    return matches;
  }

  /**
   * Aggregate analyses by source
   */
  private aggregateBySource(analyses: ItemAnalysis[]): {
    reddit: { score: number; weight: number; sampleSize: number };
    news: { score: number; weight: number; sampleSize: number };
    social: { score: number; weight: number; sampleSize: number };
  } {
    const groups: Record<string, ItemAnalysis[]> = {
      reddit: [],
      news: [],
      social: [],
    };

    for (const analysis of analyses) {
      if (analysis.source === 'reddit') {
        groups.reddit.push(analysis);
      } else if (analysis.source === 'tavily' || analysis.source === 'news') {
        groups.news.push(analysis);
      } else {
        groups.social.push(analysis);
      }
    }

    const aggregate = (items: ItemAnalysis[]) => {
      if (items.length === 0) {
        return { score: 0, weight: 0, sampleSize: 0 };
      }

      const totalScore = items.reduce((sum, a) => sum + a.adjustedScore, 0);
      const avgWeight =
        items.reduce((sum, a) => sum + a.recencyMultiplier * a.engagementMultiplier, 0) /
        items.length;

      return {
        score: normalizeScore(totalScore, items.length),
        weight: avgWeight,
        sampleSize: items.length,
      };
    };

    return {
      reddit: aggregate(groups.reddit),
      news: aggregate(groups.news),
      social: aggregate(groups.social),
    };
  }

  /**
   * Create empty signal when no data
   */
  private createEmptySignal(): SentimentSignal {
    return {
      score: 0,
      confidence: 0,
      label: 'neutral',
      components: {
        reddit: { score: 0, weight: 0, sampleSize: 0 },
        news: { score: 0, weight: 0, sampleSize: 0 },
      },
      recencyFactor: 0,
      negationAdjustment: 0,
      timestamp: new Date(),
    };
  }
}

/**
 * Create a configured sentiment analyzer
 */
export function createSentimentAnalyzer(
  config?: Partial<SentimentAnalysisConfig>,
): SentimentAnalyzer {
  return new SentimentAnalyzer(config);
}
