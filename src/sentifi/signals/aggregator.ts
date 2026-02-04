/**
 * Sentifi - Multi-Signal Aggregator
 *
 * Combines sentiment and momentum signals into a single
 * aggregated signal with overall score and recommendation.
 */

import type {
  SentimentSignal,
  MomentumSignal,
  AggregatedSignal,
  Recommendation,
} from '../types.js';
import type { SignalAggregationConfig } from './types.js';
import { scoreToRecommendation } from './types.js';

const DEFAULT_CONFIG: SignalAggregationConfig = {
  sentimentWeight: 0.6,
  momentumWeight: 0.4,
  minConfidenceThreshold: 0.3,
};

/**
 * Multi-signal aggregator
 */
export class SignalAggregator {
  private config: SignalAggregationConfig;

  constructor(config?: Partial<SignalAggregationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Aggregate sentiment and momentum signals
   */
  aggregate(
    symbol: string,
    sentiment: SentimentSignal,
    momentum?: MomentumSignal,
  ): AggregatedSignal {
    const { sentimentWeight, momentumWeight } = this.config;

    // Calculate overall score
    let overallScore: number;
    let overallConfidence: number;

    if (momentum && momentum.confidence > 0) {
      // Combine both signals
      const momentumScore = this.momentumToScore(momentum);

      // Weighted average
      overallScore =
        (sentiment.score * sentimentWeight + momentumScore * momentumWeight) /
        (sentimentWeight + momentumWeight);

      // Combined confidence (geometric mean for balance)
      overallConfidence = Math.sqrt(sentiment.confidence * momentum.confidence);

      // Boost confidence if signals agree
      if (
        (sentiment.score > 0 && momentumScore > 0) ||
        (sentiment.score < 0 && momentumScore < 0)
      ) {
        overallConfidence = Math.min(1.0, overallConfidence * 1.15);
      }
      // Reduce confidence if signals conflict
      else if (
        Math.abs(sentiment.score) > 30 &&
        Math.abs(momentumScore) > 30 &&
        Math.sign(sentiment.score) !== Math.sign(momentumScore)
      ) {
        overallConfidence *= 0.7;
      }
    } else {
      // Sentiment only
      overallScore = sentiment.score;
      overallConfidence = sentiment.confidence * 0.85; // Slightly reduced without momentum
    }

    // Generate recommendation
    const recommendation = this.generateRecommendation(
      overallScore,
      overallConfidence,
      sentiment,
      momentum,
    );

    return {
      symbol,
      sentiment,
      momentum,
      overallScore: Math.round(overallScore * 10) / 10,
      overallConfidence: Math.round(overallConfidence * 100) / 100,
      recommendation,
      timestamp: new Date(),
    };
  }

  /**
   * Convert momentum signal to score (-100 to +100)
   */
  private momentumToScore(momentum: MomentumSignal): number {
    let score = 0;

    // RSI contribution (neutral at 50)
    // Overbought (>70) or oversold (<30) contribute more strongly
    if (momentum.rsi > 70) {
      score += 30; // Strong bullish momentum (but potentially overbought)
    } else if (momentum.rsi > 55) {
      score += (momentum.rsi - 50) * 2; // Bullish
    } else if (momentum.rsi < 30) {
      score -= 30; // Strong bearish momentum (but potentially oversold)
    } else if (momentum.rsi < 45) {
      score -= (50 - momentum.rsi) * 2; // Bearish
    }

    // MACD contribution
    const macdContribution = Math.min(30, Math.abs(momentum.macdSignal * 100)) *
      Math.sign(momentum.macdSignal);
    score += macdContribution;

    // Price change contribution
    const priceContribution = Math.min(40, Math.abs(momentum.priceChange24h * 2)) *
      Math.sign(momentum.priceChange24h);
    score += priceContribution;

    // Clamp to range
    return Math.max(-100, Math.min(100, score));
  }

  /**
   * Generate recommendation from signals
   */
  private generateRecommendation(
    overallScore: number,
    overallConfidence: number,
    sentiment: SentimentSignal,
    momentum?: MomentumSignal,
  ): Recommendation {
    // Low confidence = hold
    if (overallConfidence < this.config.minConfidenceThreshold) {
      return 'hold';
    }

    // Check for conflicting signals
    if (momentum && momentum.confidence > 0.5) {
      const momentumScore = this.momentumToScore(momentum);

      // Strong conflict between sentiment and momentum
      if (
        Math.abs(sentiment.score) > 40 &&
        Math.abs(momentumScore) > 40 &&
        Math.sign(sentiment.score) !== Math.sign(momentumScore)
      ) {
        // When signals conflict strongly, be cautious
        return 'hold';
      }
    }

    // RSI extreme warnings
    if (momentum) {
      // Overbought warning - even if bullish, be cautious
      if (momentum.rsi > 80 && overallScore > 40) {
        return 'hold'; // Could be near top
      }
      // Oversold warning - even if bearish, be cautious
      if (momentum.rsi < 20 && overallScore < -40) {
        return 'hold'; // Could be near bottom
      }
    }

    // Standard thresholds
    return scoreToRecommendation(overallScore, overallConfidence, 40, -40);
  }

  /**
   * Get signal quality assessment
   */
  assessQuality(signal: AggregatedSignal): {
    quality: 'high' | 'medium' | 'low';
    reasons: string[];
  } {
    const reasons: string[] = [];
    let qualityScore = 0;

    // Check sentiment data
    const sentimentSamples =
      signal.sentiment.components.reddit.sampleSize +
      signal.sentiment.components.news.sampleSize;

    if (sentimentSamples >= 10) {
      qualityScore += 2;
      reasons.push(`Good sample size (${sentimentSamples} items)`);
    } else if (sentimentSamples >= 5) {
      qualityScore += 1;
      reasons.push(`Moderate sample size (${sentimentSamples} items)`);
    } else {
      reasons.push(`Low sample size (${sentimentSamples} items)`);
    }

    // Check recency
    if (signal.sentiment.recencyFactor > 0.7) {
      qualityScore += 1;
      reasons.push('Fresh data');
    } else if (signal.sentiment.recencyFactor < 0.3) {
      reasons.push('Stale data');
    }

    // Check momentum data
    if (signal.momentum) {
      if (signal.momentum.confidence > 0.7) {
        qualityScore += 2;
        reasons.push('Strong momentum data');
      } else if (signal.momentum.confidence > 0.4) {
        qualityScore += 1;
        reasons.push('Moderate momentum data');
      }
    } else {
      reasons.push('No momentum data');
    }

    // Check signal agreement
    if (signal.momentum) {
      const momentumScore = this.momentumToScore(signal.momentum);
      if (Math.sign(signal.sentiment.score) === Math.sign(momentumScore)) {
        qualityScore += 1;
        reasons.push('Signals agree');
      } else if (
        Math.abs(signal.sentiment.score) > 30 &&
        Math.abs(momentumScore) > 30
      ) {
        qualityScore -= 1;
        reasons.push('Signals conflict');
      }
    }

    // Determine quality level
    let quality: 'high' | 'medium' | 'low';
    if (qualityScore >= 4) {
      quality = 'high';
    } else if (qualityScore >= 2) {
      quality = 'medium';
    } else {
      quality = 'low';
    }

    return { quality, reasons };
  }
}

/**
 * Create a configured signal aggregator
 */
export function createSignalAggregator(
  config?: Partial<SignalAggregationConfig>,
): SignalAggregator {
  return new SignalAggregator(config);
}
