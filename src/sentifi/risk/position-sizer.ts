/**
 * Sentifi - Position Sizer
 *
 * Calculates appropriate position sizes based on:
 * - Confidence level
 * - Portfolio constraints
 * - Risk limits
 * - Available balance
 */

import type { RiskConfig, PositionSizeResult } from './types.js';
import type { Holding } from '../types.js';

/**
 * Calculate position size for a trade
 */
export function calculatePositionSize(params: {
  /** Requested size as percentage of portfolio */
  requestedPercent: number;
  /** Trade confidence (0-1) */
  confidence: number;
  /** Current portfolio holdings */
  portfolio: Holding[];
  /** Total portfolio value in USD */
  totalValueUsd: number;
  /** Token being traded from */
  fromToken: string;
  /** Risk configuration */
  config: RiskConfig;
}): PositionSizeResult {
  const { requestedPercent, confidence, portfolio, totalValueUsd, fromToken, config } = params;

  const adjustmentReasons: string[] = [];
  let adjustedPercent = requestedPercent;

  // 1. Apply confidence scaling if enabled
  if (config.confidenceScaling) {
    const confidenceMultiplier = calculateConfidenceMultiplier(confidence, config.minConfidenceToTrade);
    const scaledPercent = requestedPercent * confidenceMultiplier;

    if (scaledPercent < adjustedPercent) {
      adjustmentReasons.push(
        `Confidence scaling: ${requestedPercent.toFixed(1)}% → ${scaledPercent.toFixed(1)}% (confidence: ${(confidence * 100).toFixed(0)}%)`,
      );
      adjustedPercent = scaledPercent;
    }
  }

  // 2. Apply maximum position percent limit
  if (adjustedPercent > config.maxPositionPercent) {
    adjustmentReasons.push(
      `Max position limit: ${adjustedPercent.toFixed(1)}% → ${config.maxPositionPercent}%`,
    );
    adjustedPercent = config.maxPositionPercent;
  }

  // 3. Apply maximum USD limit
  const adjustedUsd = (adjustedPercent / 100) * totalValueUsd;
  if (adjustedUsd > config.maxPositionSizeUsd) {
    const maxPercent = (config.maxPositionSizeUsd / totalValueUsd) * 100;
    adjustmentReasons.push(
      `Max USD limit: $${adjustedUsd.toFixed(0)} → $${config.maxPositionSizeUsd} (${adjustedPercent.toFixed(1)}% → ${maxPercent.toFixed(1)}%)`,
    );
    adjustedPercent = maxPercent;
  }

  // 4. Check available balance
  const fromHolding = portfolio.find(
    (h) => h.token === fromToken || h.address.toLowerCase() === fromToken.toLowerCase(),
  );

  if (fromHolding) {
    const availablePercent = (fromHolding.valueUsd / totalValueUsd) * 100;
    // Keep 5% buffer of the holding
    const maxAvailable = availablePercent * 0.95;

    if (adjustedPercent > maxAvailable) {
      adjustmentReasons.push(
        `Available balance: ${adjustedPercent.toFixed(1)}% → ${maxAvailable.toFixed(1)}% (have ${availablePercent.toFixed(1)}% in ${fromToken})`,
      );
      adjustedPercent = Math.max(0, maxAvailable);
    }
  } else {
    // No holdings in fromToken
    adjustmentReasons.push(`No ${fromToken} balance available`);
    adjustedPercent = 0;
  }

  // Calculate final USD amount
  const sizeUsd = (adjustedPercent / 100) * totalValueUsd;

  return {
    sizeUsd: Math.round(sizeUsd * 100) / 100,
    sizePercent: Math.round(adjustedPercent * 100) / 100,
    wasAdjusted: adjustmentReasons.length > 0,
    requestedPercent,
    adjustmentReasons,
  };
}

/**
 * Calculate confidence multiplier for position sizing
 *
 * Maps confidence to a multiplier:
 * - Below minConfidence: 0 (don't trade)
 * - At minConfidence: 0.5
 * - At 1.0: 1.0
 *
 * Uses a smoothed curve to avoid cliff edges.
 */
export function calculateConfidenceMultiplier(
  confidence: number,
  minConfidence: number,
): number {
  if (confidence < minConfidence) {
    return 0;
  }

  // Linear scaling from minConfidence to 1.0
  // At minConfidence: 0.5 multiplier
  // At 1.0: 1.0 multiplier
  const range = 1 - minConfidence;
  if (range <= 0) return 1;

  const normalized = (confidence - minConfidence) / range;

  // Apply smoothed scaling (starts at 0.5, ends at 1.0)
  return 0.5 + normalized * 0.5;
}

/**
 * Calculate Kelly criterion position size (for reference)
 *
 * Kelly = (bp - q) / b
 * Where:
 * - b = odds received on the bet (win/loss ratio)
 * - p = probability of winning
 * - q = probability of losing (1 - p)
 *
 * We use a fractional Kelly (25%) for safety.
 */
export function calculateKellySize(params: {
  /** Expected win probability (0-1) */
  winProbability: number;
  /** Average win size */
  averageWin: number;
  /** Average loss size */
  averageLoss: number;
  /** Kelly fraction (default 0.25 for quarter-Kelly) */
  kellyFraction?: number;
}): number {
  const { winProbability, averageWin, averageLoss, kellyFraction = 0.25 } = params;

  if (averageLoss === 0 || winProbability <= 0 || winProbability >= 1) {
    return 0;
  }

  const b = averageWin / averageLoss; // Win/loss ratio
  const p = winProbability;
  const q = 1 - p;

  const kelly = (b * p - q) / b;

  // Apply Kelly fraction and clamp to reasonable range
  return Math.max(0, Math.min(0.5, kelly * kellyFraction));
}

/**
 * Check if position would create concentration risk
 */
export function checkConcentrationRisk(params: {
  /** Token to buy */
  toToken: string;
  /** Trade size in USD */
  tradeSizeUsd: number;
  /** Current portfolio */
  portfolio: Holding[];
  /** Total portfolio value */
  totalValueUsd: number;
  /** Max concentration percent */
  maxConcentration: number;
}): { isRisky: boolean; currentPercent: number; postTradePercent: number } {
  const { toToken, tradeSizeUsd, portfolio, totalValueUsd, maxConcentration } = params;

  const currentHolding = portfolio.find(
    (h) => h.token === toToken || h.address.toLowerCase() === toToken.toLowerCase(),
  );

  const currentValue = currentHolding?.valueUsd ?? 0;
  const currentPercent = totalValueUsd > 0 ? (currentValue / totalValueUsd) * 100 : 0;

  const postTradeValue = currentValue + tradeSizeUsd;
  const postTradePercent = totalValueUsd > 0 ? (postTradeValue / totalValueUsd) * 100 : 0;

  return {
    isRisky: postTradePercent > maxConcentration,
    currentPercent,
    postTradePercent,
  };
}
