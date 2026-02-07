/**
 * Sentifi - Keyword Dictionaries
 *
 * Bullish/bearish keywords and emoji sentiments for sentiment analysis.
 * These can be customized via configuration.
 */

/** Bullish keywords - indicate positive sentiment */
export const BULLISH_KEYWORDS = [
  // Strong bullish
  'moon',
  'mooning',
  'rocket',
  'bullish',
  'bull run',
  'pump',
  'pumping',
  'skyrocket',
  'explode',
  'explosion',
  'parabolic',
  'moonshot',

  // Positive action
  'buy',
  'buying',
  'bought',
  'accumulate',
  'accumulating',
  'hodl',
  'holding',
  'long',
  'going long',

  // Price movement
  'breakout',
  'breaking out',
  'surge',
  'surging',
  'rally',
  'rallying',
  'soar',
  'soaring',
  'climb',
  'climbing',
  'rise',
  'rising',
  'green',
  'gains',

  // Fundamentals
  'upgrade',
  'upgraded',
  'bullish signal',
  'strong',
  'strength',
  'growth',
  'growing',
  'adoption',
  'institutional',
  'mainstream',
  'undervalued',
  'cheap',
  'discount',

  // Sentiment
  'optimistic',
  'confident',
  'excited',
  'bullish sentiment',
  'positive',
  'promising',
  'potential',
  'opportunity',
  'gem',
  'hidden gem',

  // Records
  'ath',
  'all time high',
  'new high',
  'record',
  'breaking records',
  'historic',
];

/** Bearish keywords - indicate negative sentiment */
export const BEARISH_KEYWORDS = [
  // Strong bearish
  'crash',
  'crashing',
  'dump',
  'dumping',
  'tank',
  'tanking',
  'plunge',
  'plunging',
  'collapse',
  'collapsing',
  'bearish',
  'bear market',

  // Negative action
  'sell',
  'selling',
  'sold',
  'exit',
  'exiting',
  'short',
  'shorting',
  'liquidate',
  'liquidating',
  'panic',
  'panic sell',

  // Price movement
  'drop',
  'dropping',
  'fall',
  'falling',
  'decline',
  'declining',
  'dip',
  'dipping',
  'red',
  'losses',
  'bleeding',
  'bleed',

  // Fundamentals
  'downgrade',
  'downgraded',
  'weak',
  'weakness',
  'overvalued',
  'expensive',
  'bubble',
  'scam',
  'rug pull',
  'rugpull',
  'fraud',

  // Sentiment
  'fear',
  'fearful',
  'worried',
  'concern',
  'concerning',
  'bearish sentiment',
  'negative',
  'pessimistic',
  'doubt',
  'skeptical',
  'avoid',
  'stay away',

  // Crisis
  'crisis',
  'dead',
  'dying',
  'rip',
  'failed',
  'failure',
  'bankrupt',
  'insolvency',
  'hack',
  'hacked',
  'exploit',
];

/** Emoji sentiment mappings */
export const EMOJI_SENTIMENTS: Record<
  string,
  { sentiment: 'bullish' | 'bearish'; weight: number }
> = {
  // Strong bullish
  '🚀': { sentiment: 'bullish', weight: 1.5 },
  '🌙': { sentiment: 'bullish', weight: 1.3 },
  '💎': { sentiment: 'bullish', weight: 1.2 },
  '🙌': { sentiment: 'bullish', weight: 1.0 },
  '💪': { sentiment: 'bullish', weight: 1.0 },
  '🔥': { sentiment: 'bullish', weight: 1.2 },
  '📈': { sentiment: 'bullish', weight: 1.3 },
  '💰': { sentiment: 'bullish', weight: 1.0 },
  '🤑': { sentiment: 'bullish', weight: 1.1 },
  '🎯': { sentiment: 'bullish', weight: 0.8 },
  '✅': { sentiment: 'bullish', weight: 0.7 },
  '🟢': { sentiment: 'bullish', weight: 1.0 },
  '⬆️': { sentiment: 'bullish', weight: 0.8 },
  '🐂': { sentiment: 'bullish', weight: 1.5 },

  // Strong bearish
  '📉': { sentiment: 'bearish', weight: 1.3 },
  '💀': { sentiment: 'bearish', weight: 1.2 },
  '☠️': { sentiment: 'bearish', weight: 1.2 },
  '😱': { sentiment: 'bearish', weight: 1.0 },
  '😰': { sentiment: 'bearish', weight: 0.8 },
  '🔻': { sentiment: 'bearish', weight: 1.0 },
  '🟥': { sentiment: 'bearish', weight: 1.0 },
  '⬇️': { sentiment: 'bearish', weight: 0.8 },
  '🐻': { sentiment: 'bearish', weight: 1.5 },
  '⚠️': { sentiment: 'bearish', weight: 0.7 },
  '❌': { sentiment: 'bearish', weight: 0.8 },
  '🚨': { sentiment: 'bearish', weight: 0.9 },
  '💩': { sentiment: 'bearish', weight: 1.0 },
  '🤡': { sentiment: 'bearish', weight: 0.9 },
};

/**
 * Get all keywords with their weights
 */
export function getAllKeywords(): Array<{
  word: string;
  sentiment: 'bullish' | 'bearish';
  weight: number;
}> {
  return [
    ...BULLISH_KEYWORDS.map((word) => ({ word, sentiment: 'bullish' as const, weight: 1.0 })),
    ...BEARISH_KEYWORDS.map((word) => ({ word, sentiment: 'bearish' as const, weight: 1.0 })),
  ];
}

/**
 * Merge custom keywords with defaults
 */
export function mergeKeywords(custom?: {
  bullish?: string[];
  bearish?: string[];
}): {
  bullish: string[];
  bearish: string[];
} {
  return {
    bullish: [...new Set([...BULLISH_KEYWORDS, ...(custom?.bullish ?? [])])],
    bearish: [...new Set([...BEARISH_KEYWORDS, ...(custom?.bearish ?? [])])],
  };
}
