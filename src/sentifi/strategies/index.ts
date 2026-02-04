/**
 * Sentifi - Strategies Module
 *
 * Pluggable trading strategy architecture with registry pattern.
 */

// Types
export type {
  TradingStrategy,
  StrategyFactory,
  StrategyConfig,
  StrategyContext,
} from './types.js';

export { DEFAULT_STRATEGY_CONFIG, createTradeIntent } from './types.js';

// Registry
export {
  StrategyRegistry,
  getStrategyRegistry,
  registerStrategy,
  getStrategy,
  createStrategyRegistry,
} from './registry.js';

// Built-in strategies
export {
  SentimentMomentumStrategy,
  createSentimentMomentumStrategy,
  registerSentimentMomentumStrategy,
} from './sentiment-momentum.js';

/**
 * Initialize all built-in strategies
 */
export function initializeBuiltinStrategies(): void {
  const { registerStrategy } = require('./registry.js');
  const { createSentimentMomentumStrategy } = require('./sentiment-momentum.js');

  // Register default strategy
  registerStrategy('sentiment-momentum', createSentimentMomentumStrategy);
}
