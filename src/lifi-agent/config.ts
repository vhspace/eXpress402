/**
 * Sentifi Agent - Configuration
 */

import { privateKeyToAccount } from 'viem/accounts';
import type { AgentConfig } from './types.js';

export function getAgentConfig(): AgentConfig {
  // Yellow Network config
  const clearnodeUrl = process.env.YELLOW_CLEARNODE_URL ?? 'wss://clearnet-sandbox.yellow.com/ws';
  const agentPrivateKey = process.env.YELLOW_AGENT_PRIVATE_KEY;
  const merchantAddress = process.env.YELLOW_MERCHANT_ADDRESS;
  const assetSymbol = process.env.YELLOW_ASSET_SYMBOL ?? 'ytest.usd';

  if (!agentPrivateKey) {
    throw new Error('YELLOW_AGENT_PRIVATE_KEY is required');
  }
  if (!merchantAddress) {
    throw new Error('YELLOW_MERCHANT_ADDRESS is required');
  }

  const agentAddress =
    process.env.YELLOW_AGENT_ADDRESS ??
    privateKeyToAccount(agentPrivateKey as `0x${string}`).address;

  // Session config
  const sessionTtlSeconds = Number(process.env.YELLOW_APP_SESSION_TTL_SECONDS ?? '300');
  const sessionAllocationsRaw = process.env.YELLOW_APP_SESSION_ALLOCATIONS ?? '{}';
  const sessionAllocations = JSON.parse(sessionAllocationsRaw) as Record<string, string>;

  // LI.FI config
  const integratorId = process.env.LIFI_INTEGRATOR_ID ?? 'eXpress402-Sentifi';

  // Agent wallet for LI.FI execution
  const walletPrivateKey = process.env.AGENT_WALLET_PRIVATE_KEY ?? agentPrivateKey;

  // Strategy config from env or defaults
  const bullishThreshold = Number(process.env.SENTIFI_BULLISH_THRESHOLD ?? '40');
  const bearishThreshold = Number(process.env.SENTIFI_BEARISH_THRESHOLD ?? '-40');
  const rebalanceThreshold = Number(process.env.SENTIFI_REBALANCE_THRESHOLD ?? '0.1');
  const maxTradeUsd = Number(process.env.SENTIFI_MAX_TRADE_USD ?? '100');
  const minTradeUsd = Number(process.env.SENTIFI_MIN_TRADE_USD ?? '10');
  const pollingIntervalMs = Number(process.env.SENTIFI_POLLING_INTERVAL_MS ?? '60000');
  const maxIterations = process.env.SENTIFI_MAX_ITERATIONS
    ? Number(process.env.SENTIFI_MAX_ITERATIONS)
    : undefined;

  // Watch symbols (comma-separated)
  const watchSymbols = (process.env.SENTIFI_WATCH_SYMBOLS ?? 'ETH,BTC,SOL')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Target allocations (JSON)
  const targetAllocationsRaw =
    process.env.SENTIFI_TARGET_ALLOCATIONS ?? '{"ETH": 0.5, "USDC": 0.5}';
  const targetAllocations = JSON.parse(targetAllocationsRaw) as Record<string, number>;

  // Supported chains (comma-separated chain IDs)
  const supportedChains = (process.env.SENTIFI_SUPPORTED_CHAINS ?? '42161,10,8453')
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => !Number.isNaN(n));

  return {
    yellow: {
      clearnodeUrl,
      agentPrivateKey,
      agentAddress,
      merchantAddress,
      assetSymbol,
      sessionTtlSeconds,
      sessionAllocations,
    },
    lifi: {
      integratorId,
      supportedChains,
    },
    strategy: {
      bullishThreshold,
      bearishThreshold,
      rebalanceThreshold,
      maxTradeUsd,
      minTradeUsd,
      targetAllocations,
      watchSymbols,
    },
    wallet: {
      privateKey: walletPrivateKey,
    },
    pollingIntervalMs,
    maxIterations,
  };
}

/**
 * Validate configuration and return helpful errors
 */
export function validateConfig(config: AgentConfig): string[] {
  const errors: string[] = [];

  // Yellow config
  if (!config.yellow.agentPrivateKey) {
    errors.push('Missing YELLOW_AGENT_PRIVATE_KEY');
  }
  if (!config.yellow.merchantAddress) {
    errors.push('Missing YELLOW_MERCHANT_ADDRESS');
  }

  // Strategy validation
  if (config.strategy.bullishThreshold <= 0 || config.strategy.bullishThreshold > 100) {
    errors.push('SENTIFI_BULLISH_THRESHOLD must be between 1 and 100');
  }
  if (config.strategy.bearishThreshold >= 0 || config.strategy.bearishThreshold < -100) {
    errors.push('SENTIFI_BEARISH_THRESHOLD must be between -100 and -1');
  }

  // Target allocations should sum to ~1
  const allocationSum = Object.values(config.strategy.targetAllocations).reduce((a, b) => a + b, 0);
  if (Math.abs(allocationSum - 1) > 0.01) {
    errors.push(`Target allocations sum to ${allocationSum}, should be 1.0`);
  }

  return errors;
}

/**
 * Print configuration summary
 */
export function printConfigSummary(config: AgentConfig): void {
  console.log('\n📋 Agent Configuration:');
  console.log('  Yellow Network:');
  console.log(`    Clearnode: ${config.yellow.clearnodeUrl}`);
  console.log(`    Agent: ${config.yellow.agentAddress}`);
  console.log(`    Asset: ${config.yellow.assetSymbol}`);
  console.log('  LI.FI:');
  console.log(`    Integrator: ${config.lifi.integratorId}`);
  console.log(`    Chains: ${config.lifi.supportedChains.join(', ')}`);
  console.log('  Strategy:');
  console.log(`    Bullish threshold: ${config.strategy.bullishThreshold}`);
  console.log(`    Bearish threshold: ${config.strategy.bearishThreshold}`);
  console.log(`    Rebalance threshold: ${(config.strategy.rebalanceThreshold * 100).toFixed(0)}%`);
  console.log(`    Watch symbols: ${config.strategy.watchSymbols.join(', ')}`);
  console.log(`    Max trade: $${config.strategy.maxTradeUsd}`);
  console.log('  Timing:');
  console.log(`    Polling interval: ${config.pollingIntervalMs / 1000}s`);
  if (config.maxIterations) {
    console.log(`    Max iterations: ${config.maxIterations}`);
  }
  console.log('');
}
