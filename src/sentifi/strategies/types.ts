/**
 * Sentifi - Strategy Types
 *
 * Interfaces for pluggable trading strategies.
 */

import type { AggregatedSignal, TradeIntent, Holding, TradeAction, Urgency } from '../types.js';

/** Strategy configuration */
export interface StrategyConfig {
  /** Score threshold for bullish action */
  bullishThreshold: number;
  /** Score threshold for bearish action */
  bearishThreshold: number;
  /** Minimum confidence to act */
  minConfidence: number;
  /** Weight for momentum in decision (0-1) */
  momentumWeight: number;
  /** Weight for sentiment in decision (0-1) */
  sentimentWeight: number;
  /** Target token allocations */
  targetAllocations: Record<string, number>;
  /** Maximum position size as % of portfolio */
  maxPositionPercent: number;
  /** Strategy-specific options */
  options?: Record<string, unknown>;
}

/** Context provided to strategy for evaluation */
export interface StrategyContext {
  /** Current aggregated signal */
  signal: AggregatedSignal;
  /** Current portfolio holdings */
  portfolio: Holding[];
  /** Total portfolio value in USD */
  totalValueUsd: number;
  /** Strategy configuration */
  config: StrategyConfig;
  /** Available chains for trading */
  availableChains: number[];
  /** Default chain to use */
  defaultChainId: number;
}

/** Base trading strategy interface */
export interface TradingStrategy {
  /** Strategy name */
  readonly name: string;
  /** Strategy description */
  readonly description: string;
  /** Strategy version */
  readonly version: string;

  /**
   * Evaluate the current context and return a trade intent
   * Returns null if no action should be taken
   */
  evaluate(context: StrategyContext): TradeIntent | null;

  /**
   * Validate configuration
   */
  validateConfig(config: StrategyConfig): boolean;

  /**
   * Get default configuration
   */
  getDefaultConfig(): Partial<StrategyConfig>;
}

/** Strategy factory function type */
export type StrategyFactory = () => TradingStrategy;

/** Default strategy configuration */
export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  bullishThreshold: 40,
  bearishThreshold: -40,
  minConfidence: 0.5,
  momentumWeight: 0.4,
  sentimentWeight: 0.6,
  targetAllocations: { ETH: 0.5, USDC: 0.5 },
  maxPositionPercent: 25,
};

/**
 * Helper to create a trade intent
 */
export function createTradeIntent(params: {
  action: TradeAction;
  symbol: string;
  fromToken: string;
  toToken: string;
  chainId: number;
  sizePercent: number;
  confidence: number;
  reason: string;
  signals: string[];
  urgency?: Urgency;
  maxSlippage?: number;
}): TradeIntent {
  return {
    action: params.action,
    symbol: params.symbol,
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromChainId: params.chainId,
    toChainId: params.chainId,
    suggestedSizePercent: params.sizePercent,
    maxSlippage: params.maxSlippage ?? 0.03,
    urgency: params.urgency ?? 'medium',
    reason: params.reason,
    confidence: params.confidence,
    signals: params.signals,
  };
}
