/**
 * Sentifi - Strategy Registry
 *
 * Factory and registry for managing pluggable trading strategies.
 */

import type { TradingStrategy, StrategyFactory } from './types.js';

/**
 * Strategy registry for managing available strategies
 */
export class StrategyRegistry {
  private factories = new Map<string, StrategyFactory>();
  private instances = new Map<string, TradingStrategy>();

  /**
   * Register a strategy factory
   */
  register(name: string, factory: StrategyFactory): void {
    this.factories.set(name, factory);
    // Clear cached instance
    this.instances.delete(name);
  }

  /**
   * Get a strategy instance by name
   * Creates instance on first access (lazy loading)
   */
  get(name: string): TradingStrategy | undefined {
    // Check for cached instance
    if (this.instances.has(name)) {
      return this.instances.get(name);
    }

    // Create from factory
    const factory = this.factories.get(name);
    if (!factory) {
      return undefined;
    }

    const instance = factory();
    this.instances.set(name, instance);
    return instance;
  }

  /**
   * Check if a strategy is registered
   */
  has(name: string): boolean {
    return this.factories.has(name);
  }

  /**
   * List all registered strategy names
   */
  list(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * Get all registered strategies with their descriptions
   */
  listDetailed(): Array<{ name: string; description: string; version: string }> {
    return this.list().map((name) => {
      const strategy = this.get(name)!;
      return {
        name: strategy.name,
        description: strategy.description,
        version: strategy.version,
      };
    });
  }

  /**
   * Remove a strategy
   */
  remove(name: string): boolean {
    this.instances.delete(name);
    return this.factories.delete(name);
  }

  /**
   * Clear all strategies
   */
  clear(): void {
    this.factories.clear();
    this.instances.clear();
  }
}

// Global registry instance
let globalRegistry: StrategyRegistry | null = null;

/**
 * Get the global strategy registry
 */
export function getStrategyRegistry(): StrategyRegistry {
  if (!globalRegistry) {
    globalRegistry = new StrategyRegistry();
  }
  return globalRegistry;
}

/**
 * Register a strategy in the global registry
 */
export function registerStrategy(name: string, factory: StrategyFactory): void {
  getStrategyRegistry().register(name, factory);
}

/**
 * Get a strategy from the global registry
 */
export function getStrategy(name: string): TradingStrategy | undefined {
  return getStrategyRegistry().get(name);
}

/**
 * Create a new isolated registry
 */
export function createStrategyRegistry(): StrategyRegistry {
  return new StrategyRegistry();
}
