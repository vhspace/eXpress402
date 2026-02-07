/**
 * Sentifi Position Sizer Tests
 *
 * Tests for position sizing with confidence scaling,
 * portfolio constraints, and risk limits.
 */

import { describe, it, expect } from 'vitest';
import {
  calculatePositionSize,
  calculateConfidenceMultiplier,
  calculateKellySize,
  checkConcentrationRisk,
} from '../src/sentifi/risk/position-sizer.js';
import type { Holding } from '../src/sentifi/types.js';
import type { RiskConfig } from '../src/sentifi/risk/types.js';

const defaultConfig: RiskConfig = {
  maxPositionSizeUsd: 1000,
  maxPositionPercent: 25,
  minConfidenceToTrade: 0.5,
  confidenceScaling: true,
  dailyLossLimitPercent: 10,
  maxDrawdownPercent: 15,
  maxTradesPerHour: 5,
  maxOpenPositions: 3,
};

const mockPortfolio: Holding[] = [
  {
    chainId: 42161,
    chainName: 'Arbitrum',
    token: 'USDC',
    tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    balance: 500,
    decimals: 6,
    valueUsd: 500,
  },
  {
    chainId: 42161,
    chainName: 'Arbitrum',
    token: 'ETH',
    tokenAddress: '0x0000000000000000000000000000000000000000',
    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    balance: 0.1,
    decimals: 18,
    valueUsd: 250,
  },
];

describe('calculatePositionSize', () => {
  it('applies confidence scaling when enabled', () => {
    const result = calculatePositionSize({
      requestedPercent: 20,
      confidence: 0.7,
      portfolio: mockPortfolio,
      totalValueUsd: 750,
      fromToken: 'USDC',
      config: defaultConfig,
    });

    // With 0.7 confidence and min 0.5, should scale down
    expect(result.sizePercent).toBeLessThan(20);
    expect(result.wasAdjusted).toBe(true);
    expect(result.adjustmentReasons.length).toBeGreaterThan(0);
  });

  it('respects max position percent limit', () => {
    const result = calculatePositionSize({
      requestedPercent: 50, // Above max
      confidence: 1.0,
      portfolio: mockPortfolio,
      totalValueUsd: 750,
      fromToken: 'USDC',
      config: defaultConfig,
    });

    expect(result.sizePercent).toBeLessThanOrEqual(defaultConfig.maxPositionPercent);
  });

  it('respects max USD limit', () => {
    const largePortfolio: Holding[] = [
      {
        chainId: 42161,
        chainName: 'Arbitrum',
        token: 'USDC',
        tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
        balance: 10000,
        decimals: 6,
        valueUsd: 10000,
      },
    ];

    const result = calculatePositionSize({
      requestedPercent: 20, // 20% of 10000 = 2000, but max is 1000
      confidence: 1.0,
      portfolio: largePortfolio,
      totalValueUsd: 10000,
      fromToken: 'USDC',
      config: defaultConfig,
    });

    expect(result.sizeUsd).toBeLessThanOrEqual(defaultConfig.maxPositionSizeUsd);
  });

  it('returns zero when no balance available', () => {
    const result = calculatePositionSize({
      requestedPercent: 20,
      confidence: 1.0,
      portfolio: mockPortfolio,
      totalValueUsd: 750,
      fromToken: 'BTC', // Not in portfolio
      config: defaultConfig,
    });

    expect(result.sizePercent).toBe(0);
    expect(result.sizeUsd).toBe(0);
  });

  it('limits to available balance with buffer', () => {
    const result = calculatePositionSize({
      requestedPercent: 100, // Try to trade everything
      confidence: 1.0,
      portfolio: mockPortfolio,
      totalValueUsd: 750,
      fromToken: 'USDC',
      config: { ...defaultConfig, confidenceScaling: false, maxPositionPercent: 100 },
    });

    // USDC is 500/750 = 66.67% of portfolio, with 5% buffer = ~63%
    expect(result.sizePercent).toBeLessThan(66.67);
  });
});

describe('calculateConfidenceMultiplier', () => {
  it('returns 0 below minimum confidence', () => {
    const multiplier = calculateConfidenceMultiplier(0.3, 0.5);
    expect(multiplier).toBe(0);
  });

  it('returns 0.5 at minimum confidence', () => {
    const multiplier = calculateConfidenceMultiplier(0.5, 0.5);
    expect(multiplier).toBe(0.5);
  });

  it('returns 1.0 at full confidence', () => {
    const multiplier = calculateConfidenceMultiplier(1.0, 0.5);
    expect(multiplier).toBe(1.0);
  });

  it('scales linearly between min and max', () => {
    const midpoint = calculateConfidenceMultiplier(0.75, 0.5);
    expect(midpoint).toBeCloseTo(0.75, 1);
  });
});

describe('calculateKellySize', () => {
  it('returns 0 for edge cases', () => {
    expect(
      calculateKellySize({
        winProbability: 0,
        averageWin: 100,
        averageLoss: 50,
      }),
    ).toBe(0);

    expect(
      calculateKellySize({
        winProbability: 1,
        averageWin: 100,
        averageLoss: 50,
      }),
    ).toBe(0);

    expect(
      calculateKellySize({
        winProbability: 0.6,
        averageWin: 100,
        averageLoss: 0,
      }),
    ).toBe(0);
  });

  it('calculates positive Kelly for favorable odds', () => {
    const size = calculateKellySize({
      winProbability: 0.6,
      averageWin: 100,
      averageLoss: 50,
    });

    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(0.5); // Capped at 50%
  });

  it('applies Kelly fraction', () => {
    const fullKelly = calculateKellySize({
      winProbability: 0.6,
      averageWin: 100,
      averageLoss: 50,
      kellyFraction: 1.0,
    });

    const quarterKelly = calculateKellySize({
      winProbability: 0.6,
      averageWin: 100,
      averageLoss: 50,
      kellyFraction: 0.25,
    });

    expect(quarterKelly).toBeLessThan(fullKelly);
  });
});

describe('checkConcentrationRisk', () => {
  it('detects when trade would exceed concentration limit', () => {
    const result = checkConcentrationRisk({
      toToken: 'ETH',
      tradeSizeUsd: 400, // Would make ETH 650/750 = 86%
      portfolio: mockPortfolio,
      totalValueUsd: 750,
      maxConcentration: 50,
    });

    expect(result.isRisky).toBe(true);
    expect(result.postTradePercent).toBeGreaterThan(50);
  });

  it('allows trade within concentration limit', () => {
    const result = checkConcentrationRisk({
      toToken: 'ETH',
      tradeSizeUsd: 50, // Would make ETH 300/750 = 40%
      portfolio: mockPortfolio,
      totalValueUsd: 750,
      maxConcentration: 50,
    });

    expect(result.isRisky).toBe(false);
  });

  it('handles new token not in portfolio', () => {
    const result = checkConcentrationRisk({
      toToken: 'BTC',
      tradeSizeUsd: 100,
      portfolio: mockPortfolio,
      totalValueUsd: 750,
      maxConcentration: 50,
    });

    expect(result.currentPercent).toBe(0);
    expect(result.postTradePercent).toBeCloseTo(13.33, 1);
    expect(result.isRisky).toBe(false);
  });
});
