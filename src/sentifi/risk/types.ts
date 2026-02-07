/**
 * Sentifi - Risk Management Types
 *
 * Interfaces for risk assessment, position sizing, and circuit breakers.
 */

import type { TradeIntent, Holding, TradeAction } from '../types.js';

/** Risk configuration */
export interface RiskConfig {
  /** Maximum position size in USD */
  maxPositionSizeUsd: number;
  /** Maximum position as percentage of portfolio */
  maxPositionPercent: number;
  /** Maximum portfolio drawdown before circuit breaker */
  maxDrawdownPercent: number;
  /** Maximum trades per hour */
  maxTradesPerHour: number;
  /** Enable confidence-based position scaling */
  confidenceScaling: boolean;
  /** Minimum confidence to trade */
  minConfidenceToTrade: number;
  /** Daily loss limit percentage */
  dailyLossLimitPercent: number;
  /** Maximum concurrent open positions */
  maxOpenPositions: number;
}

/** Default risk configuration */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxPositionSizeUsd: 1000,
  maxPositionPercent: 25,
  maxDrawdownPercent: 10,
  maxTradesPerHour: 5,
  confidenceScaling: true,
  minConfidenceToTrade: 0.5,
  dailyLossLimitPercent: 5,
  maxOpenPositions: 3,
};

/** Risk assessment result */
export interface RiskAssessment {
  /** Whether the trade is approved */
  approved: boolean;
  /** Original trade intent */
  originalIntent: TradeIntent;
  /** Adjusted trade (if approved) */
  adjustedIntent?: TradeIntent;
  /** Reasons for adjustment or rejection */
  reasons: string[];
  /** Risk score (0-100, higher = riskier) */
  riskScore: number;
  /** Specific risk factors identified */
  riskFactors: RiskFactor[];
}

/** Individual risk factor */
export interface RiskFactor {
  /** Factor name */
  name: string;
  /** Factor value */
  value: number;
  /** Risk contribution (0-100) */
  contribution: number;
  /** Description */
  description: string;
}

/** Position sizing result */
export interface PositionSizeResult {
  /** Recommended size in USD */
  sizeUsd: number;
  /** Recommended size as percentage of portfolio */
  sizePercent: number;
  /** Size was adjusted */
  wasAdjusted: boolean;
  /** Original requested size percent */
  requestedPercent: number;
  /** Reasons for adjustment */
  adjustmentReasons: string[];
}

/** Circuit breaker state */
export interface CircuitBreakerState {
  /** Whether trading is halted */
  isTriggered: boolean;
  /** Reason for trigger (if triggered) */
  triggerReason?: string;
  /** When the breaker was triggered */
  triggeredAt?: Date;
  /** When the breaker can be reset */
  resetAt?: Date;
  /** Current drawdown percentage */
  currentDrawdown: number;
  /** Trades in the last hour */
  tradesLastHour: number;
  /** Daily P&L percentage */
  dailyPnlPercent: number;
}

/** Circuit breaker trigger types */
export type CircuitBreakerTrigger =
  | 'max_drawdown'
  | 'trade_frequency'
  | 'daily_loss'
  | 'manual'
  | 'error';

/** Trade record for tracking */
export interface TradeRecord {
  /** Unique trade ID */
  id: string;
  /** Trade timestamp */
  timestamp: Date;
  /** Trade action */
  action: TradeAction;
  /** Token traded */
  symbol: string;
  /** Trade size in USD */
  sizeUsd: number;
  /** Entry price */
  entryPrice: number;
  /** Exit price (if closed) */
  exitPrice?: number;
  /** Realized P&L (if closed) */
  realizedPnl?: number;
  /** Trade status */
  status: 'open' | 'closed' | 'cancelled';
}

/** Portfolio snapshot for risk calculations */
export interface PortfolioSnapshot {
  /** Timestamp */
  timestamp: Date;
  /** Total value in USD */
  totalValueUsd: number;
  /** Holdings */
  holdings: Holding[];
  /** Unrealized P&L */
  unrealizedPnl: number;
  /** Daily high watermark */
  dailyHighWatermark: number;
}

/** Risk manager interface */
export interface RiskManager {
  /**
   * Evaluate a trade intent against risk rules
   */
  evaluate(intent: TradeIntent, portfolio: Holding[], totalValueUsd: number): RiskAssessment;

  /**
   * Check circuit breaker state
   */
  checkCircuitBreaker(): CircuitBreakerState;

  /**
   * Record a completed trade
   */
  recordTrade(record: TradeRecord): void;

  /**
   * Update portfolio snapshot
   */
  updatePortfolio(snapshot: PortfolioSnapshot): void;

  /**
   * Reset circuit breaker (manual override)
   */
  resetCircuitBreaker(): void;

  /**
   * Get current risk metrics
   */
  getMetrics(): RiskMetrics;
}

/** Risk metrics summary */
export interface RiskMetrics {
  /** Trades today */
  tradesToday: number;
  /** Trades this hour */
  tradesThisHour: number;
  /** Current drawdown from peak */
  currentDrawdownPercent: number;
  /** Daily P&L */
  dailyPnlPercent: number;
  /** Win rate (last 20 trades) */
  recentWinRate: number;
  /** Average trade size */
  averageTradeSizeUsd: number;
  /** Largest position percent */
  largestPositionPercent: number;
  /** Risk utilization (0-100) */
  riskUtilization: number;
}
