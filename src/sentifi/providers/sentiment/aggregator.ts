/**
 * Sentifi - Sentiment Provider Aggregator
 *
 * Combines sentiment data from multiple providers (Reddit, Tavily, etc.)
 * with fallback handling and health checking.
 */

import type { RawSentimentItem } from '../../types.js';
import type {
  SentimentProvider,
  SentimentProviderInput,
  SentimentProviderOutput,
  ProviderRegistry,
} from '../types.js';
import { createProviderRegistry, ProviderError } from '../types.js';
import type { AggregatedSentimentData } from './types.js';

export interface SentimentAggregatorConfig {
  /** Providers to use (in order of priority) */
  providerNames: string[];
  /** Whether to continue if a provider fails */
  continueOnError: boolean;
  /** Minimum items required for valid result */
  minItems: number;
  /** Timeout for each provider in ms */
  timeoutMs: number;
}

const DEFAULT_CONFIG: SentimentAggregatorConfig = {
  providerNames: ['reddit', 'tavily'],
  continueOnError: true,
  minItems: 1,
  timeoutMs: 10000,
};

/**
 * Aggregates sentiment data from multiple providers
 */
export class SentimentAggregator implements SentimentProvider {
  readonly name = 'sentiment-aggregator';
  readonly version = '1.0.0';

  private registry: ProviderRegistry<SentimentProvider>;
  private config: SentimentAggregatorConfig;

  constructor(config?: Partial<SentimentAggregatorConfig>) {
    this.registry = createProviderRegistry<SentimentProvider>();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a sentiment provider
   */
  registerProvider(provider: SentimentProvider): void {
    this.registry.register(provider);
  }

  /**
   * Get registered providers
   */
  getProviders(): SentimentProvider[] {
    return this.registry.getAll();
  }

  /**
   * Fetch and aggregate sentiment from all providers
   */
  async fetch(input: SentimentProviderInput): Promise<SentimentProviderOutput> {
    const aggregated = await this.fetchAggregated(input);

    return {
      symbol: input.symbol,
      items: aggregated.combined,
      fetchedAt: aggregated.fetchedAt,
      source: 'aggregated',
    };
  }

  /**
   * Fetch with full breakdown by source
   */
  async fetchAggregated(input: SentimentProviderInput): Promise<AggregatedSentimentData> {
    const results: {
      name: string;
      items: RawSentimentItem[];
      available: boolean;
      error?: string;
    }[] = [];

    // Fetch from each provider
    for (const providerName of this.config.providerNames) {
      const provider = this.registry.get(providerName);

      if (!provider) {
        results.push({ name: providerName, items: [], available: false, error: 'Not registered' });
        continue;
      }

      try {
        const output = await this.fetchWithTimeout(provider, input);
        results.push({ name: providerName, items: output.items, available: true });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';

        if (!this.config.continueOnError) {
          throw new ProviderError(providerName, errorMsg, error instanceof Error ? error : undefined);
        }

        results.push({ name: providerName, items: [], available: false, error: errorMsg });
      }
    }

    // Combine all items
    const combined = results.flatMap((r) => r.items);

    // Sort by timestamp (most recent first)
    combined.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Build response
    const reddit = results.find((r) => r.name === 'reddit')?.items ?? [];
    const tavily = results.find((r) => r.name === 'tavily')?.items ?? [];

    return {
      symbol: input.symbol,
      reddit,
      tavily,
      combined,
      fetchedAt: new Date(),
      sources: results.map((r) => ({
        name: r.name,
        count: r.items.length,
        available: r.available,
      })),
    };
  }

  /**
   * Fetch with timeout wrapper
   */
  private async fetchWithTimeout(
    provider: SentimentProvider,
    input: SentimentProviderInput,
  ): Promise<SentimentProviderOutput> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${this.config.timeoutMs}ms`)), this.config.timeoutMs);
    });

    return Promise.race([provider.fetch(input), timeoutPromise]);
  }

  /**
   * Check if any provider is available
   */
  async healthCheck(): Promise<boolean> {
    const providers = this.registry.getAll();

    if (providers.length === 0) {
      return false;
    }

    const checks = await Promise.all(
      providers.map(async (p) => {
        try {
          return await p.healthCheck();
        } catch {
          return false;
        }
      }),
    );

    return checks.some((c) => c);
  }

  /**
   * Get health status of all providers
   */
  async getHealthStatus(): Promise<Record<string, boolean>> {
    const providers = this.registry.getAll();
    const status: Record<string, boolean> = {};

    await Promise.all(
      providers.map(async (p) => {
        try {
          status[p.name] = await p.healthCheck();
        } catch {
          status[p.name] = false;
        }
      }),
    );

    return status;
  }
}

/**
 * Create a configured sentiment aggregator
 */
export function createSentimentAggregator(
  providers: SentimentProvider[],
  config?: Partial<SentimentAggregatorConfig>,
): SentimentAggregator {
  const aggregator = new SentimentAggregator(config);

  for (const provider of providers) {
    aggregator.registerProvider(provider);
  }

  return aggregator;
}
