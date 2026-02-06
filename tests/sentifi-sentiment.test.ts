/**
 * Sentifi Sentiment Analyzer Tests
 *
 * Tests for sentiment analysis with negation detection,
 * recency weighting, and keyword matching.
 */

import { describe, it, expect } from 'vitest';
import { createSentimentAnalyzer } from '../src/sentifi/signals/sentiment/analyzer.js';
import type { RawSentimentItem } from '../src/sentifi/types.js';

describe('SentimentAnalyzer', () => {
  describe('analyze()', () => {
    it('returns neutral signal for empty input', () => {
      const analyzer = createSentimentAnalyzer();
      const result = analyzer.analyze([]);

      expect(result.score).toBe(0);
      expect(result.confidence).toBe(0);
      expect(result.label).toBe('neutral');
    });

    it('detects bullish sentiment from positive keywords', () => {
      const analyzer = createSentimentAnalyzer();
      const items: RawSentimentItem[] = [
        {
          id: '1',
          source: 'reddit',
          title: 'ETH is bullish! Moon incoming! Buy now!',
          timestamp: new Date(),
          engagement: { upvotes: 100, comments: 50 },
        },
        {
          id: '2',
          source: 'reddit',
          title: 'Massive gains expected, very bullish signal',
          timestamp: new Date(),
          engagement: { upvotes: 200, comments: 100 },
        },
      ];

      const result = analyzer.analyze(items);

      expect(result.score).toBeGreaterThan(0);
      expect(result.label).toMatch(/bullish/);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('detects bearish sentiment from negative keywords', () => {
      const analyzer = createSentimentAnalyzer();
      const items: RawSentimentItem[] = [
        {
          id: '1',
          source: 'reddit',
          title: 'ETH is crashing! Sell everything! Bear market!',
          timestamp: new Date(),
          engagement: { upvotes: 100, comments: 50 },
        },
        {
          id: '2',
          source: 'news',
          title: 'Market dump, bearish outlook, expect losses',
          timestamp: new Date(),
          engagement: { shares: 50 },
        },
      ];

      const result = analyzer.analyze(items);

      expect(result.score).toBeLessThan(0);
      expect(result.label).toMatch(/bearish/);
    });

    it('handles negation correctly ("not bullish" = bearish)', () => {
      const analyzer = createSentimentAnalyzer({ negationEnabled: true });
      const items: RawSentimentItem[] = [
        {
          id: '1',
          source: 'reddit',
          title: 'ETH is not bullish right now, avoid buying',
          timestamp: new Date(),
          engagement: { upvotes: 50 },
        },
      ];

      const result = analyzer.analyze(items);

      // Negation should flip or reduce bullish signal
      expect(result.negationAdjustment).toBeLessThan(0);
    });

    it('applies recency weighting (older posts matter less)', () => {
      const analyzer = createSentimentAnalyzer({ recencyDecayHours: 24 });
      const now = new Date();
      const oldDate = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48 hours ago

      const recentItems: RawSentimentItem[] = [
        {
          id: '1',
          source: 'reddit',
          title: 'Bullish moon rocket gains!',
          timestamp: now,
          engagement: { upvotes: 100 },
        },
      ];

      const oldItems: RawSentimentItem[] = [
        {
          id: '1',
          source: 'reddit',
          title: 'Bullish moon rocket gains!',
          timestamp: oldDate,
          engagement: { upvotes: 100 },
        },
      ];

      const recentResult = analyzer.analyze(recentItems);
      const oldResult = analyzer.analyze(oldItems);

      expect(recentResult.recencyFactor).toBeGreaterThan(oldResult.recencyFactor);
    });

    it('aggregates multiple sources correctly', () => {
      const analyzer = createSentimentAnalyzer();
      const items: RawSentimentItem[] = [
        {
          id: '1',
          source: 'reddit',
          title: 'Bullish on ETH!',
          timestamp: new Date(),
          engagement: { upvotes: 100 },
        },
        {
          id: '2',
          source: 'tavily',
          title: 'Positive news for Ethereum',
          timestamp: new Date(),
          engagement: { shares: 50 },
        },
      ];

      const result = analyzer.analyze(items);

      expect(result.components.reddit.sampleSize).toBe(1);
      expect(result.components.news.sampleSize).toBe(1);
    });

    it('calculates confidence based on data points', () => {
      const analyzer = createSentimentAnalyzer({ minDataPoints: 5 });

      const fewItems: RawSentimentItem[] = [
        {
          id: '1',
          source: 'reddit',
          title: 'Bullish!',
          timestamp: new Date(),
          engagement: { upvotes: 10 },
        },
      ];

      const manyItems: RawSentimentItem[] = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        source: 'reddit' as const,
        title: 'Bullish signal!',
        timestamp: new Date(),
        engagement: { upvotes: 100 },
      }));

      const fewResult = analyzer.analyze(fewItems);
      const manyResult = analyzer.analyze(manyItems);

      expect(manyResult.confidence).toBeGreaterThan(fewResult.confidence);
    });
  });

  describe('scoreToLabel()', () => {
    it('maps scores to correct labels', () => {
      const analyzer = createSentimentAnalyzer();

      // Very bullish items
      const veryBullish: RawSentimentItem[] = Array.from({ length: 5 }, (_, i) => ({
        id: String(i),
        source: 'reddit' as const,
        title: 'MOON! BULLISH! GAINS! PUMP! BUY!',
        timestamp: new Date(),
        engagement: { upvotes: 1000 },
      }));

      const result = analyzer.analyze(veryBullish);
      expect(['bullish', 'very_bullish']).toContain(result.label);
    });
  });
});
