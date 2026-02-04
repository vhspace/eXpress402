/**
 * Sentifi - Provider Interfaces
 *
 * Abstract data sources for pluggable provider pattern.
 * All providers implement a common interface for easy testing and swapping.
 */

import type { RawSentimentItem, PriceBar, Holding } from '../types.js';

// ============================================================================
// BASE PROVIDER INTERFACE
// ============================================================================

/**
 * Base interface for all data providers
 * Generic over input and output types for flexibility
 */
export interface DataProvider<TInput, TOutput> {
  /** Unique provider name */
  readonly name: string;

  /** Provider version */
  readonly version: string;

  /** Fetch data from the provider */
  fetch(input: TInput): Promise<TOutput>;

  /** Check if provider is available */
  healthCheck(): Promise<boolean>;
}

// ============================================================================
// SENTIMENT PROVIDER
// ============================================================================

/** Input for sentiment data providers */
export interface SentimentProviderInput {
  symbol: string;
  limit?: number;
  since?: Date;
}

/** Output from sentiment data providers */
export interface SentimentProviderOutput {
  symbol: string;
  items: RawSentimentItem[];
  fetchedAt: Date;
  source: string;
}

/** Sentiment provider interface */
export type SentimentProvider = DataProvider<
  SentimentProviderInput,
  SentimentProviderOutput
>;

// ============================================================================
// PRICE PROVIDER
// ============================================================================

/** Input for price data providers */
export interface PriceProviderInput {
  symbol: string;
  interval?: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  limit?: number;
}

/** Output from price data providers */
export interface PriceProviderOutput {
  symbol: string;
  bars: PriceBar[];
  latestPrice: number;
  change24h: number;
  volume24h: number;
  source: string;
  fetchedAt: Date;
}

/** Price provider interface */
export type PriceProvider = DataProvider<PriceProviderInput, PriceProviderOutput>;

// ============================================================================
// PORTFOLIO PROVIDER
// ============================================================================

/** Input for portfolio data providers */
export interface PortfolioProviderInput {
  walletAddress: string;
  chainIds: number[];
}

/** Output from portfolio data providers */
export interface PortfolioProviderOutput {
  holdings: Holding[];
  totalValueUsd: number;
  fetchedAt: Date;
}

/** Portfolio provider interface */
export type PortfolioProvider = DataProvider<
  PortfolioProviderInput,
  PortfolioProviderOutput
>;

// ============================================================================
// PROVIDER REGISTRY
// ============================================================================

/**
 * Registry for managing multiple providers of the same type
 */
export interface ProviderRegistry<T extends DataProvider<unknown, unknown>> {
  /** Register a provider */
  register(provider: T): void;

  /** Get provider by name */
  get(name: string): T | undefined;

  /** Get all registered providers */
  getAll(): T[];

  /** List provider names */
  list(): string[];

  /** Remove a provider */
  remove(name: string): boolean;
}

/**
 * Create a simple provider registry
 */
export function createProviderRegistry<
  T extends DataProvider<unknown, unknown>,
>(): ProviderRegistry<T> {
  const providers = new Map<string, T>();

  return {
    register(provider: T): void {
      providers.set(provider.name, provider);
    },

    get(name: string): T | undefined {
      return providers.get(name);
    },

    getAll(): T[] {
      return Array.from(providers.values());
    },

    list(): string[] {
      return Array.from(providers.keys());
    },

    remove(name: string): boolean {
      return providers.delete(name);
    },
  };
}

// ============================================================================
// PROVIDER ERRORS
// ============================================================================

/** Error thrown by providers */
export class ProviderError extends Error {
  constructor(
    public readonly providerName: string,
    message: string,
    public readonly cause?: Error,
  ) {
    super(`[${providerName}] ${message}`);
    this.name = 'ProviderError';
  }
}

/** Error when provider is unavailable */
export class ProviderUnavailableError extends ProviderError {
  constructor(providerName: string, cause?: Error) {
    super(providerName, 'Provider is unavailable', cause);
    this.name = 'ProviderUnavailableError';
  }
}

/** Error when provider rate limit is hit */
export class ProviderRateLimitError extends ProviderError {
  constructor(
    providerName: string,
    public readonly retryAfterMs?: number,
  ) {
    super(providerName, `Rate limit exceeded${retryAfterMs ? `, retry after ${retryAfterMs}ms` : ''}`);
    this.name = 'ProviderRateLimitError';
  }
}
