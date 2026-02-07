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
          source: 'reddit',
          title: 'ETH is bullish! Moon incoming! Buy now!',
          url: '#',
          timestamp: new Date(),
          engagement: 150,
        },
        {
          source: 'reddit',
          title: 'Massive gains expected, very bullish signal',
          url: '#',
          timestamp: new Date(),
          engagement: 300,
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
          source: 'reddit',
          title: 'ETH is crashing! Sell everything! Bear market!',
          url: '#',
          timestamp: new Date(),
          engagement: 150,
        },
        {
          source: 'news',
          title: 'Market dump, bearish outlook, expect losses',
          url: '#',
          timestamp: new Date(),
          engagement: 50,
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
          source: 'reddit',
          title: 'ETH is not bullish right now, avoid buying',
          url: '#',
          timestamp: new Date(),
          engagement: 50,
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
          source: 'reddit',
          title: 'Bullish moon rocket gains!',
          url: '#',
          timestamp: now,
          engagement: 100,
        },
      ];

      const oldItems: RawSentimentItem[] = [
        {
          source: 'reddit',
          title: 'Bullish moon rocket gains!',
          url: '#',
          timestamp: oldDate,
          engagement: 100,
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
          source: 'reddit',
          title: 'Bullish on ETH!',
          url: '#',
          timestamp: new Date(),
          engagement: 100,
        },
        {
          source: 'tavily',
          title: 'Positive news for Ethereum',
          url: '#',
          timestamp: new Date(),
          engagement: 50,
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
          source: 'reddit',
          title: 'Bullish!',
          url: '#',
          timestamp: new Date(),
          engagement: 10,
        },
      ];

      const manyItems: RawSentimentItem[] = Array.from({ length: 10 }, (_, i) => ({
        source: 'reddit' as const,
        title: `Bullish signal ${i}!`,
        url: '#',
        timestamp: new Date(),
        engagement: 100,
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
        source: 'reddit' as const,
        title: `MOON! BULLISH! GAINS! PUMP! BUY! ${i}`,
        url: '#',
        timestamp: new Date(),
        engagement: 1000,
      }));

      const result = analyzer.analyze(veryBullish);
      expect(['bullish', 'very_bullish']).toContain(result.label);
    });
  });
});
