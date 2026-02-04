/**
 * Sentifi - Sentiment-Momentum Strategy
 *
 * Default trading strategy that combines sentiment and momentum signals
 * to generate trading decisions with configurable thresholds.
 */

import type { TradingStrategy, StrategyContext, StrategyConfig } from './types.js';
import { createTradeIntent, DEFAULT_STRATEGY_CONFIG } from './types.js';
import type { TradeIntent, TradeAction, Urgency, Holding } from '../types.js';

/**
 * Sentiment-Momentum Strategy
 *
 * Makes decisions by:
 * 1. Evaluating the overall aggregated signal score
 * 2. Checking confidence thresholds
 * 3. Considering current portfolio allocation
 * 4. Generating appropriately sized trade intents
 */
export class SentimentMomentumStrategy implements TradingStrategy {
  readonly name = 'sentiment-momentum';
  readonly description = 'Combines sentiment analysis with technical momentum indicators';
  readonly version = '1.0.0';

  /**
   * Evaluate the current context and return a trade intent
   */
  evaluate(context: StrategyContext): TradeIntent | null {
    const { signal, portfolio, totalValueUsd, config, defaultChainId } = context;

    // Check minimum confidence
    if (signal.overallConfidence < config.minConfidence) {
      return null;
    }

    // Determine action based on score thresholds
    const action = this.determineAction(signal.overallScore, config);
    if (action === 'hold') {
      return null;
    }

    // Get trading pair based on action
    const { fromToken, toToken, symbol } = this.getTradingPair(action, portfolio);

    // Calculate position size
    const sizePercent = this.calculatePositionSize(
      signal.overallConfidence,
      config,
      action,
      portfolio,
      totalValueUsd,
    );

    if (sizePercent < 1) {
      return null; // Position too small
    }

    // Determine urgency
    const urgency = this.determineUrgency(signal.overallScore, signal.overallConfidence);

    // Build reason string
    const reason = this.buildReason(signal.overallScore, signal.recommendation, action);

    // Collect signal sources
    const signals = this.collectSignals(context);

    return createTradeIntent({
      action,
      symbol,
      fromToken,
      toToken,
      chainId: defaultChainId,
      sizePercent,
      confidence: signal.overallConfidence,
      reason,
      signals,
      urgency,
      maxSlippage: this.calculateSlippage(urgency),
    });
  }

  /**
   * Determine trade action based on score and thresholds
   */
  private determineAction(
    score: number,
    config: StrategyConfig,
  ): TradeAction {
    if (score >= config.bullishThreshold) {
      return 'buy';
    }
    if (score <= config.bearishThreshold) {
      return 'sell';
    }
    return 'hold';
  }

  /**
   * Get trading pair based on action and portfolio
   */
  private getTradingPair(
    action: TradeAction,
    portfolio: Holding[],
  ): { fromToken: string; toToken: string; symbol: string } {
    // Find main holdings
    const ethHolding = portfolio.find((h) => h.token === 'ETH');
    const usdcHolding = portfolio.find((h) => h.token === 'USDC');

    if (action === 'buy') {
      // Buy ETH with USDC
      return {
        fromToken: usdcHolding?.address || 'USDC',
        toToken: ethHolding?.address || 'ETH',
        symbol: 'ETH',
      };
    } else {
      // Sell ETH for USDC
      return {
        fromToken: ethHolding?.address || 'ETH',
        toToken: usdcHolding?.address || 'USDC',
        symbol: 'ETH',
      };
    }
  }

  /**
   * Calculate position size based on confidence and limits
   */
  private calculatePositionSize(
    confidence: number,
    config: StrategyConfig,
    action: TradeAction,
    portfolio: Holding[],
    totalValueUsd: number,
  ): number {
    // Base size from confidence (higher confidence = larger position)
    // Scale from 5% at min confidence to maxPositionPercent at full confidence
    const minSize = 5;
    const confidenceRange = 1 - config.minConfidence;
    const confidenceAboveMin = confidence - config.minConfidence;
    const confidenceScale = confidenceRange > 0 ? confidenceAboveMin / confidenceRange : 0;

    let baseSize = minSize + (config.maxPositionPercent - minSize) * confidenceScale;

    // Check available balance for the action
    if (action === 'buy') {
      // Buying ETH - check USDC balance
      const usdcHolding = portfolio.find((h) => h.token === 'USDC');
      const usdcPercent = usdcHolding
        ? (usdcHolding.valueUsd / totalValueUsd) * 100
        : 0;
      baseSize = Math.min(baseSize, usdcPercent * 0.9); // Keep 10% buffer
    } else {
      // Selling ETH - check ETH balance
      const ethHolding = portfolio.find((h) => h.token === 'ETH');
      const ethPercent = ethHolding
        ? (ethHolding.valueUsd / totalValueUsd) * 100
        : 0;
      baseSize = Math.min(baseSize, ethPercent * 0.9); // Keep 10% buffer
    }

    // Apply max position limit
    return Math.min(baseSize, config.maxPositionPercent);
  }

  /**
   * Determine urgency based on signal strength
   */
  private determineUrgency(score: number, confidence: number): Urgency {
    const absScore = Math.abs(score);

    if (absScore >= 70 && confidence >= 0.8) {
      return 'high';
    }
    if (absScore >= 50 && confidence >= 0.6) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Build human-readable reason string
   */
  private buildReason(
    score: number,
    recommendation: string,
    action: TradeAction,
  ): string {
    const strength = Math.abs(score) >= 60 ? 'Strong' : 'Moderate';
    const direction = score > 0 ? 'bullish' : 'bearish';

    if (action === 'buy') {
      return `${strength} ${direction} signal (score: ${score.toFixed(1)}) suggests buying opportunity`;
    } else {
      return `${strength} ${direction} signal (score: ${score.toFixed(1)}) suggests selling opportunity`;
    }
  }

  /**
   * Collect signal sources for transparency
   */
  private collectSignals(context: StrategyContext): string[] {
    const signals: string[] = [];
    const { signal } = context;

    // Sentiment signals
    if (signal.sentiment) {
      signals.push(`Sentiment: ${signal.sentiment.label} (${signal.sentiment.score.toFixed(0)})`);

      if (signal.sentiment.components.reddit.sampleSize > 0) {
        signals.push(`Reddit: ${signal.sentiment.components.reddit.sampleSize} posts`);
      }
      if (signal.sentiment.components.news.sampleSize > 0) {
        signals.push(`News: ${signal.sentiment.components.news.sampleSize} articles`);
      }
    }

    // Momentum signals
    if (signal.momentum && signal.momentum.confidence > 0) {
      signals.push(`RSI: ${signal.momentum.rsi.toFixed(1)}`);
      signals.push(`Trend: ${signal.momentum.trend}`);
      signals.push(`24h Change: ${signal.momentum.priceChange24h.toFixed(2)}%`);
    }

    return signals;
  }

  /**
   * Calculate slippage tolerance based on urgency
   */
  private calculateSlippage(urgency: Urgency): number {
    switch (urgency) {
      case 'high':
        return 0.05; // 5% for urgent trades
      case 'medium':
        return 0.03; // 3% normal
      case 'low':
        return 0.01; // 1% for patient trades
      default:
        return 0.03;
    }
  }

  /**
   * Validate configuration
   */
  validateConfig(config: StrategyConfig): boolean {
    if (config.bullishThreshold <= 0) return false;
    if (config.bearishThreshold >= 0) return false;
    if (config.minConfidence < 0 || config.minConfidence > 1) return false;
    if (config.maxPositionPercent <= 0 || config.maxPositionPercent > 100) return false;
    if (config.momentumWeight + config.sentimentWeight === 0) return false;
    return true;
  }

  /**
   * Get default configuration
   */
  getDefaultConfig(): Partial<StrategyConfig> {
    return {
      bullishThreshold: DEFAULT_STRATEGY_CONFIG.bullishThreshold,
      bearishThreshold: DEFAULT_STRATEGY_CONFIG.bearishThreshold,
      minConfidence: DEFAULT_STRATEGY_CONFIG.minConfidence,
      momentumWeight: DEFAULT_STRATEGY_CONFIG.momentumWeight,
      sentimentWeight: DEFAULT_STRATEGY_CONFIG.sentimentWeight,
      maxPositionPercent: DEFAULT_STRATEGY_CONFIG.maxPositionPercent,
    };
  }
}

/**
 * Factory function for creating sentiment-momentum strategy
 */
export function createSentimentMomentumStrategy(): TradingStrategy {
  return new SentimentMomentumStrategy();
}

/**
 * Register strategy with global registry
 */
export function registerSentimentMomentumStrategy(): void {
  // Import lazily to avoid circular dependencies
  import('./registry.js').then(({ registerStrategy }) => {
    registerStrategy('sentiment-momentum', createSentimentMomentumStrategy);
  });
}
