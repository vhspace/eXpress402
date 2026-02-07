/**
 * Sentifi - Sentiment Weighting
 *
 * Handles recency decay, source credibility, and engagement weighting
 * for sentiment scoring.
 */

/** Default source weights */
export const DEFAULT_SOURCE_WEIGHTS: Record<string, number> = {
  reddit: 1.0,
  tavily: 0.85,
  twitter: 0.9,
  news: 0.95,
};

/** Engagement thresholds for bonus multipliers */
const ENGAGEMENT_THRESHOLDS = {
  low: 10,
  medium: 50,
  high: 200,
  viral: 1000,
};

/**
 * Calculate recency multiplier using exponential decay
 *
 * @param timestamp - When the item was posted
 * @param decayHours - Half-life in hours (score halves after this time)
 * @param now - Current time (defaults to now)
 * @returns Multiplier between 0 and 1
 */
export function calculateRecencyMultiplier(
  timestamp: Date,
  decayHours: number,
  now: Date = new Date(),
): number {
  const ageMs = now.getTime() - timestamp.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours <= 0) return 1.0;
  if (ageHours > decayHours * 4) return 0.1; // Minimum weight for old posts

  // Exponential decay: e^(-ageHours / decayHours)
  // This gives 0.5 at decayHours, ~0.13 at 2*decayHours, etc.
  const multiplier = Math.exp(-ageHours / decayHours);

  return Math.max(0.1, multiplier);
}

/**
 * Calculate engagement multiplier based on upvotes/retweets/etc.
 *
 * @param engagement - Raw engagement score
 * @param source - Source type for context-aware scaling
 * @returns Multiplier between 0.5 and 2.0
 */
export function calculateEngagementMultiplier(engagement: number, source: string): number {
  // Different sources have different engagement scales
  const scale = source === 'reddit' ? 1.0 : source === 'twitter' ? 2.0 : 0.5;
  const scaledEngagement = engagement * scale;

  if (scaledEngagement >= ENGAGEMENT_THRESHOLDS.viral) {
    return 1.5; // Viral content gets 50% boost
  }
  if (scaledEngagement >= ENGAGEMENT_THRESHOLDS.high) {
    return 1.3; // High engagement: 30% boost
  }
  if (scaledEngagement >= ENGAGEMENT_THRESHOLDS.medium) {
    return 1.1; // Medium engagement: 10% boost
  }
  if (scaledEngagement >= ENGAGEMENT_THRESHOLDS.low) {
    return 1.0; // Normal weight
  }

  // Low engagement items get reduced weight
  return 0.8;
}

/**
 * Get source weight
 *
 * @param source - Source name
 * @param customWeights - Optional custom weights
 * @returns Weight for the source (default 0.75 for unknown)
 */
export function getSourceWeight(
  source: string,
  customWeights?: Record<string, number>,
): number {
  const weights = { ...DEFAULT_SOURCE_WEIGHTS, ...customWeights };
  return weights[source.toLowerCase()] ?? 0.75;
}

/**
 * Calculate combined weight for a sentiment item
 *
 * @param item - Item with source, timestamp, engagement
 * @param config - Weighting configuration
 * @returns Combined weight multiplier
 */
export function calculateCombinedWeight(
  item: {
    source: string;
    timestamp: Date;
    engagement: number;
  },
  config: {
    recencyDecayHours: number;
    sourceWeights?: Record<string, number>;
    now?: Date;
  },
): number {
  const recencyMultiplier = calculateRecencyMultiplier(
    item.timestamp,
    config.recencyDecayHours,
    config.now,
  );

  const engagementMultiplier = calculateEngagementMultiplier(
    item.engagement,
    item.source,
  );

  const sourceWeight = getSourceWeight(item.source, config.sourceWeights);

  // Combine multiplicatively
  return recencyMultiplier * engagementMultiplier * sourceWeight;
}

/**
 * Calculate confidence based on sample size and data quality
 *
 * @param itemCount - Number of items analyzed
 * @param minItems - Minimum items for full confidence
 * @param averageRecency - Average recency multiplier (0-1)
 * @returns Confidence score between 0 and 1
 */
export function calculateConfidence(
  itemCount: number,
  minItems: number,
  averageRecency: number,
): number {
  // Base confidence from sample size
  // Reaches 0.8 at minItems, 1.0 at 2*minItems
  const sampleConfidence = Math.min(1.0, 0.4 + (itemCount / minItems) * 0.4);

  // Recency adjustment - fresh data is more reliable
  const recencyConfidence = 0.3 + averageRecency * 0.7;

  // Combined (geometric mean gives balanced result)
  return Math.sqrt(sampleConfidence * recencyConfidence);
}

/**
 * Normalize score to -100 to +100 range
 *
 * @param rawScore - Raw accumulated score
 * @param itemCount - Number of items (for averaging)
 * @returns Normalized score between -100 and +100
 */
export function normalizeScore(rawScore: number, itemCount: number): number {
  if (itemCount === 0) return 0;

  // Average per item, then scale
  const avgScore = rawScore / itemCount;

  // Tanh-based normalization for smooth clamping
  // Multiply by 10 to make typical scores (1-10) map to reasonable output
  const normalized = Math.tanh(avgScore / 5) * 100;

  return Math.round(normalized * 10) / 10; // Round to 1 decimal
}
