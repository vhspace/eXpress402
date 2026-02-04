/**
 * Sentifi - Providers Module
 *
 * Data provider abstraction layer for sentiment and price data.
 */

// Core types
export type {
  DataProvider,
  SentimentProvider,
  PriceProvider,
  SentimentProviderInput,
  SentimentProviderOutput,
  PriceProviderInput,
  PriceProviderOutput,
} from './types.js';

// Sentiment aggregator
export {
  SentimentAggregator,
  createSentimentAggregator,
} from './sentiment/aggregator.js';
