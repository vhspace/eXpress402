/**
 * Sentifi - Momentum Signal Calculator
 *
 * Calculates technical indicators from price data:
 * - RSI (Relative Strength Index)
 * - MACD (Moving Average Convergence Divergence)
 * - Price change percentages
 * - Volume analysis
 */

import type { MomentumSignal, PriceBar, TrendDirection } from '../../types.js';

/** RSI configuration */
export interface RSIConfig {
  period: number; // Default: 14
}

/** MACD configuration */
export interface MACDConfig {
  fastPeriod: number; // Default: 12
  slowPeriod: number; // Default: 26
  signalPeriod: number; // Default: 9
}

/** Momentum calculator configuration */
export interface MomentumConfig {
  rsi?: RSIConfig;
  macd?: MACDConfig;
}

const DEFAULT_CONFIG: Required<MomentumConfig> = {
  rsi: { period: 14 },
  macd: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
};

/**
 * Calculate RSI (Relative Strength Index)
 *
 * RSI = 100 - (100 / (1 + RS))
 * RS = Average Gain / Average Loss
 */
export function calculateRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) {
    return 50; // Not enough data, return neutral
  }

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  // Separate gains and losses
  const gains = changes.map((c) => (c > 0 ? c : 0));
  const losses = changes.map((c) => (c < 0 ? Math.abs(c) : 0));

  // Calculate first average
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Smooth with Wilder's method for remaining periods
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) {
    return 100; // No losses = maximum strength
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return Math.round(rsi * 10) / 10;
}

/**
 * Calculate EMA (Exponential Moving Average)
 */
export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];

  const multiplier = 2 / (period + 1);
  const ema: number[] = [];

  // First EMA is SMA
  const sma = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(sma);

  // Calculate EMA for remaining values
  for (let i = period; i < prices.length; i++) {
    const value = (prices[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
    ema.push(value);
  }

  return ema;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 *
 * MACD Line = 12-period EMA - 26-period EMA
 * Signal Line = 9-period EMA of MACD Line
 * Histogram = MACD Line - Signal Line
 */
export function calculateMACD(
  prices: number[],
  config: MACDConfig = DEFAULT_CONFIG.macd,
): { macd: number; signal: number; histogram: number } {
  const { fastPeriod, slowPeriod, signalPeriod } = config;

  if (prices.length < slowPeriod + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);

  // MACD line (only for periods where both EMAs exist)
  const macdLine: number[] = [];
  const startIndex = slowPeriod - fastPeriod;

  for (let i = 0; i < slowEMA.length; i++) {
    const fastValue = fastEMA[startIndex + i];
    const slowValue = slowEMA[i];
    if (fastValue !== undefined && slowValue !== undefined) {
      macdLine.push(fastValue - slowValue);
    }
  }

  if (macdLine.length < signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  // Signal line
  const signalEMA = calculateEMA(macdLine, signalPeriod);

  const macd = macdLine[macdLine.length - 1];
  const signal = signalEMA[signalEMA.length - 1];
  const histogram = macd - signal;

  return {
    macd: Math.round(macd * 1000) / 1000,
    signal: Math.round(signal * 1000) / 1000,
    histogram: Math.round(histogram * 1000) / 1000,
  };
}

/**
 * Calculate price change percentage
 */
export function calculatePriceChange(prices: number[], periods: number): number {
  if (prices.length < periods + 1) {
    return 0;
  }

  const current = prices[prices.length - 1];
  const previous = prices[prices.length - 1 - periods];

  if (previous === 0) return 0;

  const change = ((current - previous) / previous) * 100;
  return Math.round(change * 100) / 100;
}

/**
 * Calculate volume change percentage
 */
export function calculateVolumeChange(bars: PriceBar[], periods: number): number {
  if (bars.length < periods * 2) {
    return 0;
  }

  const recentVolume = bars
    .slice(-periods)
    .reduce((sum, bar) => sum + bar.volume, 0);

  const previousVolume = bars
    .slice(-periods * 2, -periods)
    .reduce((sum, bar) => sum + bar.volume, 0);

  if (previousVolume === 0) return 0;

  const change = ((recentVolume - previousVolume) / previousVolume) * 100;
  return Math.round(change * 100) / 100;
}

/**
 * Determine trend direction from indicators
 */
export function determineTrend(
  rsi: number,
  macdHistogram: number,
  priceChange: number,
): TrendDirection {
  // Score based on multiple indicators
  let score = 0;

  // RSI contribution
  if (rsi >= 70) score += 2; // Overbought (strong up)
  else if (rsi >= 55) score += 1;
  else if (rsi <= 30) score -= 2; // Oversold (strong down)
  else if (rsi <= 45) score -= 1;

  // MACD contribution
  if (macdHistogram > 0.01) score += 1;
  else if (macdHistogram > 0.05) score += 2;
  else if (macdHistogram < -0.01) score -= 1;
  else if (macdHistogram < -0.05) score -= 2;

  // Price change contribution
  if (priceChange > 5) score += 2;
  else if (priceChange > 2) score += 1;
  else if (priceChange < -5) score -= 2;
  else if (priceChange < -2) score -= 1;

  // Map score to trend
  if (score >= 4) return 'strong_up';
  if (score >= 2) return 'up';
  if (score <= -4) return 'strong_down';
  if (score <= -2) return 'down';
  return 'sideways';
}

/**
 * Calculate confidence from data quality
 */
export function calculateMomentumConfidence(
  barsCount: number,
  minBars = 30,
  volumeAvailable = true,
): number {
  let confidence = 0.5;

  // Data quantity bonus
  if (barsCount >= minBars * 2) confidence += 0.3;
  else if (barsCount >= minBars) confidence += 0.15;

  // Volume data bonus
  if (volumeAvailable) confidence += 0.2;

  return Math.min(1.0, confidence);
}

/**
 * Main momentum calculator
 */
export class MomentumCalculator {
  private config: Required<MomentumConfig>;

  constructor(config?: MomentumConfig) {
    this.config = {
      rsi: { ...DEFAULT_CONFIG.rsi, ...config?.rsi },
      macd: { ...DEFAULT_CONFIG.macd, ...config?.macd },
    };
  }

  /**
   * Calculate momentum signal from price bars
   */
  calculate(bars: PriceBar[]): MomentumSignal {
    if (bars.length < 2) {
      return this.createEmptySignal();
    }

    // Extract close prices
    const prices = bars.map((b) => b.close);

    // Calculate indicators
    const rsi = calculateRSI(prices, this.config.rsi.period);
    const { macd, histogram } = calculateMACD(prices, this.config.macd);

    // Calculate changes (assuming hourly bars, so 24 = 24h)
    const priceChange24h = calculatePriceChange(prices, Math.min(24, prices.length - 1));
    const volumeChange24h = calculateVolumeChange(bars, Math.min(24, Math.floor(bars.length / 2)));

    // Determine trend
    const trend = determineTrend(rsi, histogram, priceChange24h);

    // Calculate confidence
    const hasVolume = bars.some((b) => b.volume > 0);
    const confidence = calculateMomentumConfidence(bars.length, 30, hasVolume);

    return {
      trend,
      rsi,
      macdSignal: histogram, // Using histogram as the actionable signal
      priceChange24h,
      volumeChange24h,
      confidence,
      timestamp: new Date(),
    };
  }

  /**
   * Create empty signal when no data
   */
  private createEmptySignal(): MomentumSignal {
    return {
      trend: 'sideways',
      rsi: 50,
      macdSignal: 0,
      priceChange24h: 0,
      volumeChange24h: 0,
      confidence: 0,
      timestamp: new Date(),
    };
  }
}

/**
 * Create a configured momentum calculator
 */
export function createMomentumCalculator(config?: MomentumConfig): MomentumCalculator {
  return new MomentumCalculator(config);
}
