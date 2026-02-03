/**
 * Sentifi Agent - Sentiment Analysis Engine
 * Transforms market_rumors data into actionable sentiment scores
 */

import type {
  MarketRumors,
  RedditPost,
  TavilyResult,
  SentimentSource,
  SentimentResult,
} from './types.js';

// Keyword dictionaries for sentiment detection
const BULLISH_KEYWORDS = [
  'moon',
  'mooning',
  'bullish',
  'buy',
  'buying',
  'long',
  'undervalued',
  'gem',
  'breakout',
  'pump',
  'pumping',
  'rally',
  'surge',
  'soar',
  'rocket',
  'growth',
  'strong',
  'upgrade',
  'outperform',
  'beat',
  'exceeded',
  'all-time high',
  'ath',
  'accumulate',
  'hodl',
  'diamond hands',
  'to the moon',
  'bullrun',
  'bull run',
  'green',
  'profit',
  'gains',
];

const BEARISH_KEYWORDS = [
  'crash',
  'crashing',
  'bearish',
  'sell',
  'selling',
  'short',
  'overvalued',
  'dump',
  'dumping',
  'scam',
  'avoid',
  'plunge',
  'drop',
  'tank',
  'collapse',
  'weak',
  'downgrade',
  'underperform',
  'miss',
  'missed',
  'all-time low',
  'capitulate',
  'paper hands',
  'rugpull',
  'rug pull',
  'red',
  'loss',
  'losses',
  'fear',
  'panic',
  'bubble',
  'overheated',
];

// Reserved for future neutral sentiment detection
const _NEUTRAL_KEYWORDS = [
  'hold',
  'holding',
  'sideways',
  'consolidate',
  'consolidating',
  'wait',
  'neutral',
  'mixed',
  'uncertain',
];

/**
 * Calculate sentiment score for a Reddit post
 * Returns score from -10 to +10
 */
export function calculateRedditSentiment(post: RedditPost): number {
  const text = post.title.toLowerCase();

  let score = 0;

  // Count keyword matches
  for (const keyword of BULLISH_KEYWORDS) {
    if (text.includes(keyword)) {
      score += 1.5;
    }
  }

  for (const keyword of BEARISH_KEYWORDS) {
    if (text.includes(keyword)) {
      score -= 1.5;
    }
  }

  // Reddit upvotes as confidence multiplier (log scale)
  const upvoteMultiplier = Math.log10(Math.max(post.score, 1) + 1) / 2;
  score *= 1 + upvoteMultiplier;

  // Check for strong sentiment indicators
  if (text.includes('🚀') || text.includes('rocket')) score += 2;
  if (text.includes('💎') || text.includes('diamond')) score += 1;
  if (text.includes('📉') || text.includes('crash')) score -= 2;
  if (text.includes('⚠️') || text.includes('warning')) score -= 1;

  // Clamp to range
  return Math.max(-10, Math.min(10, score));
}

/**
 * Calculate sentiment score for a Tavily news result
 * Returns score from -10 to +10
 */
export function calculateNewsSentiment(article: TavilyResult): number {
  const text = `${article.title} ${article.content}`.toLowerCase();

  let score = 0;

  // Count keyword matches (news is weighted differently)
  for (const keyword of BULLISH_KEYWORDS) {
    if (text.includes(keyword)) {
      score += 1;
    }
  }

  for (const keyword of BEARISH_KEYWORDS) {
    if (text.includes(keyword)) {
      score -= 1;
    }
  }

  // News-specific patterns
  if (text.includes('beat expectations') || text.includes('exceeded expectations')) score += 3;
  if (text.includes('missed expectations') || text.includes('below expectations')) score -= 3;
  if (text.includes('upgrade') || text.includes('price target raised')) score += 2;
  if (text.includes('downgrade') || text.includes('price target lowered')) score -= 2;
  if (text.includes('analyst') && text.includes('buy')) score += 1.5;
  if (text.includes('analyst') && text.includes('sell')) score -= 1.5;

  // Tavily relevance score as confidence factor
  score *= 0.5 + article.score * 0.5;

  return Math.max(-10, Math.min(10, score));
}

/**
 * Calculate confidence from Reddit post
 */
function getRedditConfidence(post: RedditPost): number {
  // Based on upvotes and recency
  const upvoteScore = Math.min(post.score / 100, 1);
  const now = Date.now() / 1000;
  const ageHours = (now - post.createdUtc) / 3600;
  const recencyScore = Math.max(0, 1 - ageHours / 48); // Decay over 48 hours

  return (upvoteScore + recencyScore) / 2;
}

/**
 * Weighted average calculation
 */
function weightedAverage(values: number[], weights: number[]): number {
  if (values.length === 0) return 0;

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight === 0) return 0;

  const weightedSum = values.reduce((sum, val, i) => sum + val * weights[i], 0);
  return weightedSum / totalWeight;
}

/**
 * Main sentiment analysis function
 * Combines Reddit and Tavily sources into unified sentiment score
 */
export function analyzeSentiment(rumors: MarketRumors): SentimentResult {
  const scores: number[] = [];
  const weights: number[] = [];
  const sources: SentimentSource[] = [];

  // Process Reddit posts
  for (const post of rumors.reddit) {
    const score = calculateRedditSentiment(post);
    const confidence = getRedditConfidence(post);

    scores.push(score);
    weights.push(confidence);
    sources.push({
      type: 'reddit',
      title: post.title,
      score,
      confidence,
      url: post.url,
    });
  }

  // Process Tavily news articles
  for (const article of rumors.tavily) {
    const score = calculateNewsSentiment(article);
    const confidence = article.score; // Tavily provides relevance score

    scores.push(score);
    weights.push(confidence);
    sources.push({
      type: 'tavily',
      title: article.title,
      score,
      confidence,
      url: article.url,
    });
  }

  // Calculate weighted average sentiment
  const avgScore = weightedAverage(scores, weights);

  // Normalize to -100 to +100 range
  const normalizedScore = Math.max(-100, Math.min(100, avgScore * 10));

  // Overall confidence is average of source confidences
  const overallConfidence =
    sources.length > 0 ? sources.reduce((sum, s) => sum + s.confidence, 0) / sources.length : 0;

  // Sort sources by absolute score (most impactful first)
  sources.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  return {
    score: normalizedScore,
    sources,
    confidence: overallConfidence,
    timestamp: new Date(),
  };
}

/**
 * Get sentiment label from score
 */
export function getSentimentLabel(score: number): string {
  if (score >= 60) return 'Very Bullish';
  if (score >= 30) return 'Bullish';
  if (score >= 10) return 'Slightly Bullish';
  if (score >= -10) return 'Neutral';
  if (score >= -30) return 'Slightly Bearish';
  if (score >= -60) return 'Bearish';
  return 'Very Bearish';
}

/**
 * Get emoji for sentiment score
 */
export function getSentimentEmoji(score: number): string {
  if (score >= 50) return '🚀';
  if (score >= 20) return '📈';
  if (score >= -20) return '➡️';
  if (score >= -50) return '📉';
  return '💥';
}
