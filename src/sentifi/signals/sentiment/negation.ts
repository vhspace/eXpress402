/**
 * Sentifi - Negation Detection
 *
 * Handles negation patterns like "not bullish", "don't buy", "no longer bearish"
 * to correctly flip sentiment signals.
 */

/** Common negation patterns */
export const NEGATION_PATTERNS = [
  // Simple negations
  'not',
  "n't",
  'never',
  'no',
  'none',
  'nothing',
  'neither',
  'nobody',
  'nowhere',
  // Temporal negations
  'no longer',
  'not anymore',
  'stopped being',
  'ceased to be',
  // Conditional negations
  "wouldn't",
  "couldn't",
  "shouldn't",
  "won't",
  'cannot',
  "can't",
  // Doubt expressions
  "don't think",
  "don't believe",
  'doubt',
  'unlikely',
  'questionable',
  // Reversal words
  'opposite of',
  'contrary to',
  'far from',
  'anything but',
];

/** Window size for negation detection (words before keyword) */
const NEGATION_WINDOW = 4;

/**
 * Check if a keyword is negated in the given text
 *
 * @param text - The full text to analyze
 * @param keywordIndex - Index where the keyword starts in text
 * @param keyword - The keyword that was matched
 * @returns Whether the keyword is negated
 */
export function isNegated(text: string, keywordIndex: number, keyword: string): boolean {
  // Get text before the keyword (up to NEGATION_WINDOW words)
  const beforeText = text.substring(0, keywordIndex).toLowerCase();
  const words = beforeText.split(/\s+/).filter(Boolean);
  const windowWords = words.slice(-NEGATION_WINDOW).join(' ');

  // Check for negation patterns
  for (const pattern of NEGATION_PATTERNS) {
    if (windowWords.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Find all negation-adjusted matches in text
 *
 * @param text - Text to analyze
 * @param keywords - Keywords to look for with their sentiment
 * @returns Array of matches with negation status
 */
export function findNegatedMatches(
  text: string,
  keywords: Array<{ word: string; sentiment: 'bullish' | 'bearish'; weight: number }>,
): Array<{
  keyword: string;
  sentiment: 'bullish' | 'bearish';
  weight: number;
  negated: boolean;
  position: number;
}> {
  const lowerText = text.toLowerCase();
  const matches: Array<{
    keyword: string;
    sentiment: 'bullish' | 'bearish';
    weight: number;
    negated: boolean;
    position: number;
  }> = [];

  for (const { word, sentiment, weight } of keywords) {
    const lowerWord = word.toLowerCase();
    let position = 0;

    // Find all occurrences
    while ((position = lowerText.indexOf(lowerWord, position)) !== -1) {
      // Check word boundaries
      const before = position > 0 ? lowerText[position - 1] : ' ';
      const after = lowerText[position + lowerWord.length] || ' ';

      if (/\W/.test(before) && /\W/.test(after)) {
        const negated = isNegated(text, position, word);

        matches.push({
          keyword: word,
          sentiment: negated ? flipSentiment(sentiment) : sentiment,
          weight: negated ? weight * 0.8 : weight, // Slightly reduce confidence for negated matches
          negated,
          position,
        });
      }

      position += lowerWord.length;
    }
  }

  return matches;
}

/**
 * Flip sentiment direction
 */
export function flipSentiment(sentiment: 'bullish' | 'bearish'): 'bullish' | 'bearish' {
  return sentiment === 'bullish' ? 'bearish' : 'bullish';
}

/**
 * Calculate negation adjustment factor
 * Returns how much the negations affected the overall score
 *
 * @param matches - Array of keyword matches
 * @returns Adjustment factor (positive = more bullish from negations, negative = more bearish)
 */
export function calculateNegationAdjustment(
  matches: Array<{ negated: boolean; sentiment: 'bullish' | 'bearish'; weight: number }>,
): number {
  let adjustment = 0;

  for (const match of matches) {
    if (match.negated) {
      // Negated bullish becomes bearish contribution
      // Negated bearish becomes bullish contribution
      const direction = match.sentiment === 'bullish' ? 1 : -1;
      adjustment += direction * match.weight * 2; // *2 because we're flipping the direction
    }
  }

  return adjustment;
}

/**
 * Get context around a match for debugging
 */
export function getMatchContext(text: string, position: number, windowSize = 30): string {
  const start = Math.max(0, position - windowSize);
  const end = Math.min(text.length, position + windowSize);
  const context = text.substring(start, end);

  return `...${context}...`;
}
