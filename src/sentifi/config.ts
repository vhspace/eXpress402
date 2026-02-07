/**
 * Sentifi Agent - Configuration with Zod Validation
 *
 * All configuration is loaded from environment variables with sensible defaults.
 * Following the existing pattern from src/yellow/config.ts
 */

import { z } from 'zod';
import { privateKeyToAccount } from 'viem/accounts';

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

export const SentifiConfigSchema = z.object({
  // Yellow Network (existing pattern from yellow/config.ts)
  yellow: z.object({
    clearnodeUrl: z.string().url().default('wss://clearnet-sandbox.yellow.com/ws'),
    agentPrivateKey: z.string().startsWith('0x').min(66),
    merchantAddress: z.string().startsWith('0x').length(42),
    merchantPrivateKey: z.string().startsWith('0x').min(66),
    assetSymbol: z.string().default('ytest.usd'),
    sessionAllocations: z.record(z.string(), z.unknown()).default({}),
  }),

  // Wallet for execution
  wallet: z.object({
    privateKey: z.string().startsWith('0x').min(66),
  }),

  // LI.FI execution settings
  lifi: z.object({
    integratorId: z.string().default('eXpress402-Sentifi'),
    supportedChains: z.array(z.number()).default([42161, 10, 8453]),
    defaultSlippage: z.number().min(0).max(0.5).default(0.03),
    defaultChainId: z.number().default(42161),
  }),

  // Provider settings
  providers: z.object({
    sentiment: z.object({
      enabled: z.array(z.enum(['reddit', 'tavily'])).default(['reddit', 'tavily']),
      redditSubreddits: z.array(z.string()).default(['cryptocurrency', 'ethtrader']),
      tavilyApiKey: z.string().optional(),
    }),
    price: z.object({
      enabled: z.array(z.enum(['coingecko', 'stooq', 'chainlink'])).default(['coingecko']),
      coingeckoApiKey: z.string().optional(),
    }),
  }),

  // Signal processing settings
  signals: z.object({
    sentimentWeight: z.number().min(0).max(1).default(0.6),
    momentumWeight: z.number().min(0).max(1).default(0.4),
    recencyDecayHours: z.number().default(24),
    negationEnabled: z.boolean().default(true),
    minDataPoints: z.number().default(3),
  }),

  // Strategy settings
  strategy: z.object({
    name: z.string().default('sentiment-momentum'),
    bullishThreshold: z.number().min(0).max(100).default(40),
    bearishThreshold: z.number().min(-100).max(0).default(-40),
    minConfidence: z.number().min(0).max(1).default(0.5),
    watchSymbols: z.array(z.string()).default(['ETH', 'BTC', 'SOL']),
    targetAllocations: z.record(z.string(), z.number()).default({ ETH: 0.5, USDC: 0.5 }),
  }),

  // Risk management
  risk: z.object({
    maxPositionSizeUsd: z.number().default(1000),
    maxPositionPercent: z.number().min(0).max(100).default(25),
    maxTotalExposurePercent: z.number().min(0).max(100).default(80),
    minTradeUsd: z.number().default(10),
    maxTradesPerHour: z.number().default(5),
    maxDrawdownPercent: z.number().default(10),
    confidenceScaling: z.boolean().default(true),
  }),

  // Execution mode
  execution: z.object({
    mode: z.enum(['live', 'paper', 'demo']).default('demo'),
    confirmBeforeExecute: z.boolean().default(true),
  }),

  // Learning settings
  learning: z.object({
    enabled: z.boolean().default(true),
    trackOutcomes: z.boolean().default(true),
    outcomeHorizonHours: z.array(z.number()).default([1, 4, 24]),
    redisUrl: z.string().default('redis://localhost:6379'),
  }),

  // Timing
  pollingIntervalMs: z.number().default(60000),
  maxIterations: z.number().optional(),
});

export type SentifiConfig = z.infer<typeof SentifiConfigSchema>;

// ============================================================================
// CONFIGURATION LOADER
// ============================================================================

/**
 * Load configuration from environment with validation
 */
export function loadConfig(): SentifiConfig {
  const raw = {
    yellow: {
      clearnodeUrl: process.env.YELLOW_CLEARNODE_URL,
      agentPrivateKey: process.env.YELLOW_AGENT_PRIVATE_KEY,
      merchantAddress: process.env.YELLOW_MERCHANT_ADDRESS,
      merchantPrivateKey: process.env.YELLOW_MERCHANT_PRIVATE_KEY,
      assetSymbol: process.env.YELLOW_ASSET_SYMBOL,
      sessionAllocations: parseJsonEnv('YELLOW_APP_SESSION_ALLOCATIONS'),
    },
    wallet: {
      privateKey: process.env.SENTIFI_WALLET_PRIVATE_KEY ?? process.env.YELLOW_AGENT_PRIVATE_KEY,
    },
    lifi: {
      integratorId: process.env.LIFI_INTEGRATOR_ID,
      supportedChains: parseArrayEnv('SENTIFI_CHAINS', Number),
      defaultSlippage: parseNumberEnv('SENTIFI_SLIPPAGE'),
      defaultChainId: parseNumberEnv('SENTIFI_DEFAULT_CHAIN'),
    },
    providers: {
      sentiment: {
        enabled: parseArrayEnv('SENTIFI_SENTIMENT_PROVIDERS'),
        redditSubreddits: parseArrayEnv('SENTIFI_REDDIT_SUBREDDITS'),
        tavilyApiKey: process.env.TAVILY_API_KEY,
      },
      price: {
        enabled: parseArrayEnv('SENTIFI_PRICE_PROVIDERS'),
        coingeckoApiKey: process.env.COINGECKO_API_KEY,
      },
    },
    signals: {
      sentimentWeight: parseNumberEnv('SENTIFI_SENTIMENT_WEIGHT'),
      momentumWeight: parseNumberEnv('SENTIFI_MOMENTUM_WEIGHT'),
      recencyDecayHours: parseNumberEnv('SENTIFI_RECENCY_DECAY_HOURS'),
      negationEnabled: parseBoolEnv('SENTIFI_NEGATION'),
      minDataPoints: parseNumberEnv('SENTIFI_MIN_DATA_POINTS'),
    },
    strategy: {
      name: process.env.SENTIFI_STRATEGY,
      bullishThreshold: parseNumberEnv('SENTIFI_BULLISH_THRESHOLD'),
      bearishThreshold: parseNumberEnv('SENTIFI_BEARISH_THRESHOLD'),
      minConfidence: parseNumberEnv('SENTIFI_MIN_CONFIDENCE'),
      watchSymbols: parseArrayEnv('SENTIFI_WATCH_SYMBOLS'),
      targetAllocations: parseJsonEnv('SENTIFI_TARGET_ALLOCATIONS'),
    },
    risk: {
      maxPositionSizeUsd: parseNumberEnv('SENTIFI_MAX_POSITION_USD'),
      maxPositionPercent: parseNumberEnv('SENTIFI_MAX_POSITION_PCT'),
      maxTotalExposurePercent: parseNumberEnv('SENTIFI_MAX_EXPOSURE_PCT'),
      minTradeUsd: parseNumberEnv('SENTIFI_MIN_TRADE_USD'),
      maxTradesPerHour: parseNumberEnv('SENTIFI_MAX_TRADES_PER_HOUR'),
      maxDrawdownPercent: parseNumberEnv('SENTIFI_MAX_DRAWDOWN'),
      confidenceScaling: parseBoolEnv('SENTIFI_CONFIDENCE_SCALING'),
    },
    execution: {
      mode: process.env.SENTIFI_EXECUTION_MODE,
      confirmBeforeExecute: parseBoolEnv('SENTIFI_CONFIRM'),
    },
    learning: {
      enabled: parseBoolEnv('SENTIFI_LEARNING'),
      trackOutcomes: parseBoolEnv('SENTIFI_TRACK_OUTCOMES'),
      outcomeHorizonHours: parseArrayEnv('SENTIFI_OUTCOME_HORIZONS', Number),
      redisUrl: process.env.KV_URL ?? process.env.REDIS_URL,
    },
    pollingIntervalMs: parseNumberEnv('SENTIFI_POLLING_MS'),
    maxIterations: parseNumberEnv('SENTIFI_MAX_ITERATIONS'),
  };

  // Remove undefined values (let Zod defaults handle them)
  const cleaned = removeUndefined(raw);

  return SentifiConfigSchema.parse(cleaned);
}

/**
 * Validate configuration without throwing
 * Returns array of error messages
 */
export function validateConfig(config: unknown): string[] {
  const result = SentifiConfigSchema.safeParse(config);
  if (result.success) return [];

  return result.error.issues.map(err => `${String(err.path.join('.'))}: ${err.message}`);
}

/**
 * Get wallet address from configuration
 */
export function getWalletAddress(config: SentifiConfig): `0x${string}` {
  return privateKeyToAccount(config.wallet.privateKey as `0x${string}`).address;
}

/**
 * Get agent address from configuration
 */
export function getAgentAddress(config: SentifiConfig): `0x${string}` {
  return privateKeyToAccount(config.yellow.agentPrivateKey as `0x${string}`).address;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function parseNumberEnv(key: string): number | undefined {
  const val = process.env[key];
  if (!val) return undefined;
  const num = Number(val);
  return isNaN(num) ? undefined : num;
}

function parseBoolEnv(key: string): boolean | undefined {
  const val = process.env[key];
  if (!val) return undefined;
  return val.toLowerCase() !== 'false' && val !== '0';
}

function parseArrayEnv<T = string>(key: string, transform?: (s: string) => T): T[] | undefined {
  const val = process.env[key];
  if (!val) return undefined;
  const arr = val.split(',').map(s => s.trim());
  return transform ? arr.map(transform) : (arr as T[]);
}

function parseJsonEnv(key: string): Record<string, unknown> | undefined {
  const val = process.env[key];
  if (!val) return undefined;
  try {
    return JSON.parse(val);
  } catch {
    return undefined;
  }
}

function removeUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(obj, (_, v) => (v === undefined ? undefined : v)));
}

// ============================================================================
// DEFAULT CONFIG FOR DEMO
// ============================================================================

/**
 * Create a minimal demo configuration
 * Useful for testing without full env setup
 */
export function createDemoConfig(overrides?: Partial<SentifiConfig>): SentifiConfig {
  const demoPrivateKey = '0x0000000000000000000000000000000000000000000000000000000000000001';

  return SentifiConfigSchema.parse({
    yellow: {
      clearnodeUrl: 'wss://clearnet-sandbox.yellow.com/ws',
      agentPrivateKey: process.env.YELLOW_AGENT_PRIVATE_KEY ?? demoPrivateKey,
      merchantAddress:
        process.env.YELLOW_MERCHANT_ADDRESS ?? '0x0000000000000000000000000000000000000001',
      merchantPrivateKey: process.env.YELLOW_MERCHANT_PRIVATE_KEY ?? demoPrivateKey,
      assetSymbol: 'ytest.usd',
    },
    wallet: {
      privateKey: process.env.YELLOW_AGENT_PRIVATE_KEY ?? demoPrivateKey,
    },
    execution: {
      mode: 'demo',
      confirmBeforeExecute: false,
    },
    ...overrides,
  });
}
