/**
 * Sentifi - Risk Manager
 *
 * Central risk management that coordinates:
 * - Position sizing with confidence scaling
 * - Circuit breaker for emergency stops
 * - Trade validation against risk limits
 * - Portfolio monitoring
 */

import type {
  RiskConfig,
  RiskManager,
  RiskAssessment,
  RiskFactor,
  RiskMetrics,
  TradeRecord,
  PortfolioSnapshot,
  CircuitBreakerState,
} from './types.js';
import { DEFAULT_RISK_CONFIG } from './types.js';
import type { TradeIntent, Holding } from '../types.js';
import { CircuitBreaker } from './circuit-breaker.js';
import {
  calculatePositionSize,
  checkConcentrationRisk,
} from './position-sizer.js';

/**
 * Comprehensive risk manager implementation
 */
export class SentifiRiskManager implements RiskManager {
  private config: RiskConfig;
  private circuitBreaker: CircuitBreaker;
  private lastPortfolio?: PortfolioSnapshot;

  constructor(config?: Partial<RiskConfig>) {
    this.config = { ...DEFAULT_RISK_CONFIG, ...config };
    this.circuitBreaker = new CircuitBreaker(this.config);
  }

  /**
   * Evaluate a trade intent against all risk rules
   */
  evaluate(
    intent: TradeIntent,
    portfolio: Holding[],
    totalValueUsd: number,
  ): RiskAssessment {
    const riskFactors: RiskFactor[] = [];
    const reasons: string[] = [];
    let riskScore = 0;

    // Check circuit breaker first
    const cbState = this.circuitBreaker.check();
    if (cbState.isTriggered) {
      return {
        approved: false,
        originalIntent: intent,
        reasons: [`Circuit breaker active: ${cbState.triggerReason}`],
        riskScore: 100,
        riskFactors: [
          {
            name: 'Circuit Breaker',
            value: 1,
            contribution: 100,
            description: cbState.triggerReason || 'Trading halted',
          },
        ],
      };
    }

    // Check minimum confidence
    if (intent.confidence < this.config.minConfidenceToTrade) {
      riskFactors.push({
        name: 'Low Confidence',
        value: intent.confidence,
        contribution: 30,
        description: `Confidence ${(intent.confidence * 100).toFixed(0)}% below minimum ${(this.config.minConfidenceToTrade * 100).toFixed(0)}%`,
      });
      reasons.push(
        `Confidence too low: ${(intent.confidence * 100).toFixed(0)}% < ${(this.config.minConfidenceToTrade * 100).toFixed(0)}%`,
      );
      riskScore += 30;
    }

    // Calculate position size with all adjustments
    const positionResult = calculatePositionSize({
      requestedPercent: intent.suggestedSizePercent,
      confidence: intent.confidence,
      portfolio,
      totalValueUsd,
      fromToken: intent.fromToken,
      config: this.config,
    });

    if (positionResult.wasAdjusted) {
      reasons.push(...positionResult.adjustmentReasons);
    }

    if (positionResult.sizePercent <= 0) {
      return {
        approved: false,
        originalIntent: intent,
        reasons: ['Position size reduced to zero', ...reasons],
        riskScore: 100,
        riskFactors,
      };
    }

    // Check concentration risk for buy orders
    if (intent.action === 'buy') {
      const concentration = checkConcentrationRisk({
        toToken: intent.toToken,
        tradeSizeUsd: positionResult.sizeUsd,
        portfolio,
        totalValueUsd,
        maxConcentration: this.config.maxPositionPercent * 2, // Allow up to 2x for total position
      });

      if (concentration.isRisky) {
        riskFactors.push({
          name: 'Concentration Risk',
          value: concentration.postTradePercent,
          contribution: 25,
          description: `Post-trade ${intent.toToken} position would be ${concentration.postTradePercent.toFixed(1)}%`,
        });
        reasons.push(
          `High concentration: ${intent.toToken} would be ${concentration.postTradePercent.toFixed(1)}% of portfolio`,
        );
        riskScore += 25;
      }
    }

    // Check trade frequency
    if (cbState.tradesLastHour >= this.config.maxTradesPerHour - 1) {
      riskFactors.push({
        name: 'Trade Frequency',
        value: cbState.tradesLastHour,
        contribution: 20,
        description: `${cbState.tradesLastHour} trades in last hour (limit: ${this.config.maxTradesPerHour})`,
      });
      reasons.push(
        `Near trade limit: ${cbState.tradesLastHour}/${this.config.maxTradesPerHour} trades this hour`,
      );
      riskScore += 20;
    }

    // Check drawdown state
    if (cbState.currentDrawdown > this.config.maxDrawdownPercent * 0.7) {
      riskFactors.push({
        name: 'Drawdown Warning',
        value: cbState.currentDrawdown,
        contribution: 15,
        description: `Current drawdown ${cbState.currentDrawdown.toFixed(1)}% approaching limit`,
      });
      reasons.push(
        `Elevated drawdown: ${cbState.currentDrawdown.toFixed(1)}% (limit: ${this.config.maxDrawdownPercent}%)`,
      );
      riskScore += 15;
    }

    // Check slippage tolerance
    if (intent.maxSlippage > 0.05) {
      riskFactors.push({
        name: 'High Slippage',
        value: intent.maxSlippage * 100,
        contribution: 10,
        description: `Max slippage ${(intent.maxSlippage * 100).toFixed(1)}% is high`,
      });
      reasons.push(`High slippage tolerance: ${(intent.maxSlippage * 100).toFixed(1)}%`);
      riskScore += 10;
    }

    // Determine approval
    const approved = riskScore < 50 && positionResult.sizePercent > 0;

    // Create adjusted intent if approved
    let adjustedIntent: TradeIntent | undefined;
    if (approved && positionResult.wasAdjusted) {
      adjustedIntent = {
        ...intent,
        suggestedSizePercent: positionResult.sizePercent,
      };
    }

    return {
      approved,
      originalIntent: intent,
      adjustedIntent: adjustedIntent || (approved ? intent : undefined),
      reasons,
      riskScore: Math.min(100, riskScore),
      riskFactors,
    };
  }

  /**
   * Check circuit breaker state
   */
  checkCircuitBreaker(): CircuitBreakerState {
    return this.circuitBreaker.check();
  }

  /**
   * Record a completed trade
   */
  recordTrade(record: TradeRecord): void {
    this.circuitBreaker.recordTrade(record);
    this.circuitBreaker.clearErrors(); // Successful trade clears error count
  }

  /**
   * Record a trade error
   */
  recordError(): void {
    this.circuitBreaker.recordError();
  }

  /**
   * Update portfolio snapshot
   */
  updatePortfolio(snapshot: PortfolioSnapshot): void {
    this.lastPortfolio = snapshot;
    this.circuitBreaker.updatePortfolio(snapshot);
  }

  /**
   * Reset circuit breaker (manual override)
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }

  /**
   * Manually trigger circuit breaker
   */
  triggerCircuitBreaker(reason: string): void {
    this.circuitBreaker.trigger('manual', reason);
  }

  /**
   * Get current risk metrics
   */
  getMetrics(): RiskMetrics {
    const cbState = this.circuitBreaker.check();
    const trades = this.circuitBreaker.getTradeHistory();
    const recentTrades = this.circuitBreaker.getRecentTrades(20);

    // Calculate win rate
    const closedTrades = recentTrades.filter((t) => t.status === 'closed');
    const winningTrades = closedTrades.filter((t) => (t.realizedPnl ?? 0) > 0);
    const winRate = closedTrades.length > 0
      ? winningTrades.length / closedTrades.length
      : 0;

    // Calculate average trade size
    const totalSize = trades.reduce((sum, t) => sum + t.sizeUsd, 0);
    const avgSize = trades.length > 0 ? totalSize / trades.length : 0;

    // Calculate largest position
    let largestPositionPercent = 0;
    if (this.lastPortfolio && this.lastPortfolio.totalValueUsd > 0) {
      for (const holding of this.lastPortfolio.holdings) {
        const percent = (holding.valueUsd / this.lastPortfolio.totalValueUsd) * 100;
        if (percent > largestPositionPercent) {
          largestPositionPercent = percent;
        }
      }
    }

    // Calculate trades today
    const today = new Date().toDateString();
    const tradesToday = trades.filter(
      (t) => t.timestamp.toDateString() === today,
    ).length;

    // Risk utilization (how close to limits)
    const drawdownUtil = (cbState.currentDrawdown / this.config.maxDrawdownPercent) * 100;
    const tradeFreqUtil = (cbState.tradesLastHour / this.config.maxTradesPerHour) * 100;
    const riskUtilization = Math.max(drawdownUtil, tradeFreqUtil);

    return {
      tradesToday,
      tradesThisHour: cbState.tradesLastHour,
      currentDrawdownPercent: cbState.currentDrawdown,
      dailyPnlPercent: cbState.dailyPnlPercent,
      recentWinRate: Math.round(winRate * 100) / 100,
      averageTradeSizeUsd: Math.round(avgSize * 100) / 100,
      largestPositionPercent: Math.round(largestPositionPercent * 100) / 100,
      riskUtilization: Math.round(riskUtilization * 100) / 100,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RiskConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): RiskConfig {
    return { ...this.config };
  }
}

/**
 * Create a risk manager instance
 */
export function createRiskManager(config?: Partial<RiskConfig>): SentifiRiskManager {
  return new SentifiRiskManager(config);
}
