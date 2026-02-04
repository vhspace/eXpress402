/**
 * Sentifi Agent - Core Type Definitions
 *
 * This module defines the core types used throughout the Sentifi trading agent.
 * Following the codebase pattern of colocating types with implementation.
 */

import { z } from 'zod';

// ============================================================================
// SENTIMENT TYPES
// ============================================================================

/** Sentiment label based on score thresholds */
export type SentimentLabel =
  | 'very_bullish'
  | 'bullish'
  | 'neutral'
  | 'bearish'
  | 'very_bearish';

/** Raw sentiment item from data providers */
export interface RawSentimentItem {
  source: 'reddit' | 'tavily' | 'twitter' | 'news';
  title: string;
  content?: string;
  url: string;
  timestamp: Date;
  engagement: number; // upvotes, retweets, etc.
  metadata?: Record<string, unknown>;
}

/** Processed sentiment signal with confidence */
export interface SentimentSignal {
  score: number; // -100 to +100
  confidence: number; // 0 to 1
  label: SentimentLabel;
  components: {
    reddit: { score: number; weight: number; sampleSize: number };
    news: { score: number; weight: number; sampleSize: number };
    social?: { score: number; weight: number; sampleSize: number };
  };
  recencyFactor: number; // 0-1, how recent the data is
  negationAdjustment: number; // Adjustment from negation detection
  timestamp: Date;
}

// ============================================================================
// MOMENTUM TYPES
// ============================================================================

/** Price trend direction */
export type TrendDirection =
  | 'strong_up'
  | 'up'
  | 'sideways'
  | 'down'
  | 'strong_down';

/** Price bar for OHLCV data */
export interface PriceBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Momentum signal from price/volume analysis */
export interface MomentumSignal {
  trend: TrendDirection;
  rsi: number; // 0-100
  macdSignal: number; // Positive = bullish, negative = bearish
  priceChange24h: number; // Percentage
  volumeChange24h: number; // Percentage
  confidence: number; // 0-1
  timestamp: Date;
}

// ============================================================================
// AGGREGATED SIGNAL
// ============================================================================

/** Trading recommendation based on signals */
export type Recommendation =
  | 'strong_buy'
  | 'buy'
  | 'hold'
  | 'sell'
  | 'strong_sell';

/** Combined multi-signal analysis result */
export interface AggregatedSignal {
  symbol: string;
  sentiment: SentimentSignal;
  momentum?: MomentumSignal;
  overallScore: number; // -100 to +100, weighted combination
  overallConfidence: number; // 0-1
  recommendation: Recommendation;
  timestamp: Date;
}

// ============================================================================
// TRADE TYPES
// ============================================================================

/** Trade action type */
export type TradeAction = 'buy' | 'sell' | 'hold';

/** Trade urgency level */
export type Urgency = 'low' | 'medium' | 'high';

/** Trade intent from strategy evaluation */
export interface TradeIntent {
  action: TradeAction;
  symbol: string;
  fromToken: string;
  toToken: string;
  fromChainId: number;
  toChainId: number;
  suggestedSizePercent: number; // % of portfolio to trade (0-100)
  maxSlippage: number;
  urgency: Urgency;
  reason: string;
  confidence: number;
  signals: string[]; // Which signals triggered this
}

/** Risk-adjusted trade after risk manager processing */
export interface RiskAdjustedTrade {
  intent: TradeIntent;
  finalAmountRaw: bigint;
  finalAmountFormatted: string;
  finalValueUsd: number;
  adjustments: {
    confidenceScaling: number;
    positionLimitCap: number;
    exposureLimitCap: number;
    volatilityAdjustment: number;
  };
  metrics: {
    estimatedRisk: number;
    riskRewardRatio: number;
    portfolioImpact: number;
  };
  approved: boolean;
  rejectionReason?: string;
}

// ============================================================================
// PORTFOLIO TYPES
// ============================================================================

/** Single holding in portfolio */
export interface Holding {
  chainId: number;
  chainName: string;
  token: string;
  tokenAddress: string;
  /** Alias for tokenAddress */
  address: string;
  balance: number;
  decimals: number;
  valueUsd: number;
}

/** Portfolio snapshot */
export interface Portfolio {
  holdings: Holding[];
  totalValueUsd: number;
  fetchedAt: Date;
}

// ============================================================================
// EXECUTION TYPES
// ============================================================================

/** Execution request to trade executor */
export interface ExecutionRequest {
  trade: RiskAdjustedTrade;
  fromChain: number;
  toChain: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  walletAddress: string;
}

/** Result from trade execution */
export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  fromAmount: string;
  toAmount?: string;
  route?: string;
  gasCostUsd?: string;
  slippage?: number;
  executedAt?: Date;
  explorerUrl?: string;
  error?: string;
}

// ============================================================================
// LEARNING TYPES
// ============================================================================

/** Prediction record for tracking accuracy */
export interface PredictionRecord {
  id: string;
  timestamp: Date;
  symbol: string;
  signal: AggregatedSignal;
  intent: TradeIntent;
  execution?: ExecutionResult;
  outcome?: {
    priceAtPrediction: number;
    priceAt1h?: number;
    priceAt4h?: number;
    priceAt24h?: number;
    actualDirection: 'up' | 'down' | 'flat';
    predictionCorrect: boolean;
  };
}

/** Performance metrics from learning tracker */
export interface PerformanceMetrics {
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;
  sentimentAccuracy: number;
  momentumAccuracy: number;
  highConfidenceAccuracy: number;
  lowConfidenceAccuracy: number;
  totalTradesExecuted: number;
  profitableTradesPercent: number;
  averageReturnPercent: number;
  last24hAccuracy: number;
  last7dAccuracy: number;
}

// ============================================================================
// RISK TYPES
// ============================================================================

/** Risk limits configuration */
export interface RiskLimits {
  maxPositionSizeUsd: number;
  maxPositionPercent: number;
  maxTotalExposurePercent: number;
  minTradeUsd: number;
  maxTradesPerHour: number;
  maxDrawdownPercent: number;
}

/** Circuit breaker state */
export interface CircuitBreakerState {
  triggered: boolean;
  reason?: string;
  triggeredAt?: Date;
  resumeAt?: Date;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Chain name mapping */
export const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  137: 'Polygon',
  42161: 'Arbitrum',
  8453: 'Base',
  43114: 'Avalanche',
};

/** Common token addresses by chain */
export const TOKENS: Record<number, Record<string, string>> = {
  42161: {
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
  10: {
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    WETH: '0x4200000000000000000000000000000000000006',
  },
  8453: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    WETH: '0x4200000000000000000000000000000000000006',
  },
};

/** Stablecoin symbols */
export const STABLECOINS = ['USDC', 'USDT', 'DAI', 'FRAX'] as const;

// ============================================================================
// ZOD SCHEMAS (for validation at boundaries)
// ============================================================================

export const SentimentSignalSchema = z.object({
  score: z.number().min(-100).max(100),
  confidence: z.number().min(0).max(1),
  label: z.enum(['very_bullish', 'bullish', 'neutral', 'bearish', 'very_bearish']),
  components: z.object({
    reddit: z.object({ score: z.number(), weight: z.number(), sampleSize: z.number() }),
    news: z.object({ score: z.number(), weight: z.number(), sampleSize: z.number() }),
    social: z.object({ score: z.number(), weight: z.number(), sampleSize: z.number() }).optional(),
  }),
  recencyFactor: z.number().min(0).max(1),
  negationAdjustment: z.number(),
  timestamp: z.date(),
});

export const TradeIntentSchema = z.object({
  action: z.enum(['buy', 'sell', 'hold']),
  symbol: z.string(),
  fromToken: z.string(),
  toToken: z.string(),
  fromChainId: z.number(),
  toChainId: z.number(),
  suggestedSizePercent: z.number().min(0).max(100),
  maxSlippage: z.number().min(0).max(1),
  urgency: z.enum(['low', 'medium', 'high']),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  signals: z.array(z.string()),
});

// ============================================================================
// AGENT TYPES
// ============================================================================

/** Agent processing phase */
export type AgentPhase =
  | 'init'
  | 'monitor'
  | 'decide'
  | 'quote'
  | 'execute'
  | 'done'
  | 'error';

/** Agent state snapshot */
export interface AgentState {
  phase: AgentPhase;
  portfolio: Holding[];
  totalValueUsd: number;
  lastSignal: AggregatedSignal | null;
  lastIntent: TradeIntent | null;
  lastQuote: import('./execution/types.js').QuoteResult | null;
  logs: Array<{ timestamp: Date; message: string }>;
}

/** Sentifi configuration */
export interface SentifiConfig {
  yellow?: {
    clearnodeUrl: string;
    agentPrivateKey: string;
    merchantAddress: string;
  };
  signals?: {
    sentimentWeight: number;
    momentumWeight: number;
  };
  strategy?: {
    name: string;
    bullishThreshold: number;
    bearishThreshold: number;
    minConfidence: number;
  };
  risk?: {
    maxPositionSizeUsd: number;
    maxPositionPercent: number;
    maxDrawdownPercent: number;
    maxTradesPerHour: number;
  };
  execution?: {
    mode: 'live' | 'paper' | 'demo';
    integrator: string;
  };
  learning?: {
    enabled: boolean;
    redisUrl?: string;
  };
}
