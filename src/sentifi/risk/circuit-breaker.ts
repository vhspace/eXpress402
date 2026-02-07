/**
 * Sentifi - Circuit Breaker
 *
 * Emergency stop mechanism that halts trading when:
 * - Portfolio drawdown exceeds threshold
 * - Trade frequency exceeds limit
 * - Daily loss limit is breached
 * - Errors occur repeatedly
 */

import type {
  RiskConfig,
  CircuitBreakerState,
  CircuitBreakerTrigger,
  TradeRecord,
  PortfolioSnapshot,
} from './types.js';

/** Circuit breaker cooldown duration in minutes */
const DEFAULT_COOLDOWN_MINUTES = 60;

/**
 * Circuit breaker for trading risk management
 */
export class CircuitBreaker {
  private config: RiskConfig;
  private isTriggered = false;
  private triggerReason?: string;
  private triggeredAt?: Date;
  private resetAt?: Date;
  private triggerType?: CircuitBreakerTrigger;

  // Tracking data
  private tradeHistory: TradeRecord[] = [];
  private portfolioHistory: PortfolioSnapshot[] = [];
  private errorCount = 0;
  private dailyStartValue = 0;
  private dailyHighWatermark = 0;
  private lastResetDate?: Date;

  constructor(config: RiskConfig) {
    this.config = config;
  }

  /**
   * Check current circuit breaker state
   */
  check(): CircuitBreakerState {
    // Check if we should auto-reset
    if (this.isTriggered && this.resetAt && new Date() >= this.resetAt) {
      this.reset();
    }

    const currentDrawdown = this.calculateCurrentDrawdown();
    const tradesLastHour = this.countTradesInLastHour();
    const dailyPnlPercent = this.calculateDailyPnl();

    // Check triggers if not already triggered
    if (!this.isTriggered) {
      this.checkTriggers(currentDrawdown, tradesLastHour, dailyPnlPercent);
    }

    return {
      isTriggered: this.isTriggered,
      triggerReason: this.triggerReason,
      triggeredAt: this.triggeredAt,
      resetAt: this.resetAt,
      currentDrawdown,
      tradesLastHour,
      dailyPnlPercent,
    };
  }

  /**
   * Check all trigger conditions
   */
  private checkTriggers(
    drawdown: number,
    tradesLastHour: number,
    dailyPnl: number,
  ): void {
    // Check max drawdown
    if (drawdown >= this.config.maxDrawdownPercent) {
      this.trigger(
        'max_drawdown',
        `Portfolio drawdown ${drawdown.toFixed(1)}% exceeds limit of ${this.config.maxDrawdownPercent}%`,
      );
      return;
    }

    // Check trade frequency
    if (tradesLastHour >= this.config.maxTradesPerHour) {
      this.trigger(
        'trade_frequency',
        `${tradesLastHour} trades in last hour exceeds limit of ${this.config.maxTradesPerHour}`,
      );
      return;
    }

    // Check daily loss limit
    if (dailyPnl <= -this.config.dailyLossLimitPercent) {
      this.trigger(
        'daily_loss',
        `Daily loss ${dailyPnl.toFixed(1)}% exceeds limit of ${this.config.dailyLossLimitPercent}%`,
      );
      return;
    }
  }

  /**
   * Trigger the circuit breaker
   */
  trigger(type: CircuitBreakerTrigger, reason: string): void {
    this.isTriggered = true;
    this.triggerReason = reason;
    this.triggeredAt = new Date();
    this.triggerType = type;

    // Set auto-reset time based on trigger type
    const cooldownMinutes = this.getCooldownMinutes(type);
    this.resetAt = new Date(Date.now() + cooldownMinutes * 60 * 1000);
  }

  /**
   * Get cooldown duration based on trigger type
   */
  private getCooldownMinutes(type: CircuitBreakerTrigger): number {
    switch (type) {
      case 'max_drawdown':
        return 120; // 2 hours for severe drawdown
      case 'daily_loss':
        return 240; // 4 hours for daily loss (or until next day)
      case 'trade_frequency':
        return 60; // 1 hour for frequency limit
      case 'error':
        return 30; // 30 minutes for errors
      case 'manual':
        return DEFAULT_COOLDOWN_MINUTES;
      default:
        return DEFAULT_COOLDOWN_MINUTES;
    }
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.isTriggered = false;
    this.triggerReason = undefined;
    this.triggeredAt = undefined;
    this.resetAt = undefined;
    this.triggerType = undefined;
    this.errorCount = 0;
  }

  /**
   * Record a trade for tracking
   */
  recordTrade(trade: TradeRecord): void {
    this.tradeHistory.push(trade);

    // Keep only last 100 trades
    if (this.tradeHistory.length > 100) {
      this.tradeHistory = this.tradeHistory.slice(-100);
    }
  }

  /**
   * Update portfolio snapshot
   */
  updatePortfolio(snapshot: PortfolioSnapshot): void {
    this.portfolioHistory.push(snapshot);

    // Keep only last 48 hours of snapshots
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    this.portfolioHistory = this.portfolioHistory.filter(
      (s) => s.timestamp.getTime() > cutoff,
    );

    // Update daily tracking
    const today = new Date().toDateString();
    const lastReset = this.lastResetDate?.toDateString();

    if (lastReset !== today) {
      // New day - reset daily tracking
      this.dailyStartValue = snapshot.totalValueUsd;
      this.dailyHighWatermark = snapshot.totalValueUsd;
      this.lastResetDate = new Date();
    } else {
      // Update high watermark
      if (snapshot.totalValueUsd > this.dailyHighWatermark) {
        this.dailyHighWatermark = snapshot.totalValueUsd;
      }
    }
  }

  /**
   * Record an error (for error-based circuit breaker)
   */
  recordError(): void {
    this.errorCount++;

    // Trigger if too many consecutive errors
    if (this.errorCount >= 3 && !this.isTriggered) {
      this.trigger(
        'error',
        `${this.errorCount} consecutive errors - pausing trading`,
      );
    }
  }

  /**
   * Clear error count (call after successful operation)
   */
  clearErrors(): void {
    this.errorCount = 0;
  }

  /**
   * Calculate current drawdown from high watermark
   */
  private calculateCurrentDrawdown(): number {
    if (this.portfolioHistory.length === 0 || this.dailyHighWatermark === 0) {
      return 0;
    }

    const currentValue = this.portfolioHistory[this.portfolioHistory.length - 1].totalValueUsd;
    const drawdown = ((this.dailyHighWatermark - currentValue) / this.dailyHighWatermark) * 100;

    return Math.max(0, drawdown);
  }

  /**
   * Count trades in the last hour
   */
  private countTradesInLastHour(): number {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    return this.tradeHistory.filter(
      (t) => t.timestamp.getTime() > oneHourAgo,
    ).length;
  }

  /**
   * Calculate daily P&L percentage
   */
  private calculateDailyPnl(): number {
    if (this.portfolioHistory.length === 0 || this.dailyStartValue === 0) {
      return 0;
    }

    const currentValue = this.portfolioHistory[this.portfolioHistory.length - 1].totalValueUsd;
    const pnl = ((currentValue - this.dailyStartValue) / this.dailyStartValue) * 100;

    return Math.round(pnl * 100) / 100;
  }

  /**
   * Get trade history
   */
  getTradeHistory(): TradeRecord[] {
    return [...this.tradeHistory];
  }

  /**
   * Get recent trades (last N)
   */
  getRecentTrades(count: number): TradeRecord[] {
    return this.tradeHistory.slice(-count);
  }
}

/**
 * Create a circuit breaker instance
 */
export function createCircuitBreaker(config: RiskConfig): CircuitBreaker {
  return new CircuitBreaker(config);
}
