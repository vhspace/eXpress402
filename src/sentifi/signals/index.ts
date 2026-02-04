/**
 * Sentifi - Signals Module
 *
 * Signal processing layer for sentiment analysis and momentum calculation.
 */

// Types
export type { SignalAggregationConfig } from './types.js';
export { scoreToRecommendation } from './types.js';

// Sentiment analysis
export {
  SentimentAnalyzer,
  createSentimentAnalyzer,
} from './sentiment/analyzer.js';

export {
  NEGATION_PATTERNS,
  isNegated,
  findNegatedMatches,
} from './sentiment/negation.js';

export {
  calculateRecencyMultiplier,
  calculateEngagementMultiplier,
  calculateConfidence,
} from './sentiment/weighting.js';

export {
  BULLISH_KEYWORDS,
  BEARISH_KEYWORDS,
  EMOJI_SENTIMENTS,
  getAllKeywords,
  mergeKeywords,
} from './sentiment/keywords.js';

// Momentum
export {
  calculateRSI,
  calculateEMA,
  calculateMACD,
  calculatePriceChange,
  calculateVolumeChange,
  determineTrend,
  calculateMomentumConfidence,
  MomentumCalculator,
  createMomentumCalculator,
} from './momentum/calculator.js';

// Aggregator
export {
  SignalAggregator,
  createSignalAggregator,
} from './aggregator.js';
