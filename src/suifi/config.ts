/**
 * Suifi - Configuration with Yellow Network
 *
 * All configuration is loaded from environment variables with sensible defaults.
 */

import { z } from 'zod';
import { privateKeyToAccount } from 'viem/accounts';

// ============================================================================
// YELLOW APPLICATION
// ============================================================================

export const YELLOW_APPLICATION = 'eXpress402-suifi';

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

export const SuifiConfigSchema = z.object({
  // Yellow Network configuration
  yellow: z.object({
    clearnodeUrl: z.string().url().default('wss://clearnet-sandbox.yellow.com/ws'),
    agentPrivateKey: z.string().startsWith('0x').min(66),
    merchantAddress: z.string().startsWith('0x').length(42),
    merchantPrivateKey: z.string().startsWith('0x').min(66),
    assetSymbol: z.string().default('ytest.usd'),
    sessionAllocations: z.record(z.string(), z.unknown()).default({}),
  }),

  // Pricing configuration
  pricing: z.object({
    pricePerCall: z.string().default('1.0'),
    freeCallsPerSession: z.number().default(5),
    sessionDepositAmount: z.string().default('11.0'), // sandbox
  }),

  // Strategy configuration
  strategy: z.object({
    name: z.string().default('conservative'),
    minApyForDeposit: z.number().default(10),
    minTvlUsd: z.number().default(100000),
    maxApyForWithdraw: z.number().default(3),
    highApyThreshold: z.number().default(30),
    stablecoinBonus: z.number().default(10),
    apyWeight: z.number().default(2),
    tvlWeight: z.number().default(1),
  }),

  // Tracker configuration
  tracker: z.object({
    dbPath: z.string().default('./data/suifi-decisions.json'),
    autoSave: z.boolean().default(true),
    evaluationDays: z.array(z.number()).default([1, 7, 30]),
  }),
});

export type SuifiConfig = z.infer<typeof SuifiConfigSchema>;

// ============================================================================
// CONFIGURATION LOADER
// ============================================================================

/**
 * Load configuration from environment with validation
 */
export function loadConfig(): SuifiConfig {
  const raw = {
    yellow: {
      clearnodeUrl: process.env.YELLOW_CLEARNODE_URL,
      agentPrivateKey: process.env.YELLOW_AGENT_PRIVATE_KEY,
      merchantAddress: process.env.YELLOW_MERCHANT_ADDRESS,
      merchantPrivateKey: process.env.YELLOW_MERCHANT_PRIVATE_KEY,
      assetSymbol: process.env.YELLOW_ASSET_SYMBOL,
      sessionAllocations: parseJsonEnv('YELLOW_APP_SESSION_ALLOCATIONS'),
    },
    pricing: {
      pricePerCall: process.env.SUIFI_PRICE_PER_CALL,
      freeCallsPerSession: parseNumberEnv('SUIFI_FREE_CALLS'),
      sessionDepositAmount: process.env.SUIFI_SESSION_DEPOSIT,
    },
    strategy: {
      name: process.env.SUIFI_STRATEGY,
      minApyForDeposit: parseNumberEnv('SUIFI_MIN_APY'),
      minTvlUsd: parseNumberEnv('SUIFI_MIN_TVL'),
      maxApyForWithdraw: parseNumberEnv('SUIFI_MAX_WITHDRAW_APY'),
      highApyThreshold: parseNumberEnv('SUIFI_HIGH_APY_THRESHOLD'),
      stablecoinBonus: parseNumberEnv('SUIFI_STABLECOIN_BONUS'),
      apyWeight: parseNumberEnv('SUIFI_APY_WEIGHT'),
      tvlWeight: parseNumberEnv('SUIFI_TVL_WEIGHT'),
    },
    tracker: {
      dbPath: process.env.SUIFI_DB_PATH,
      autoSave: parseBoolEnv('SUIFI_AUTO_SAVE'),
      evaluationDays: parseArrayEnv('SUIFI_EVAL_DAYS', Number),
    },
  };

  // Remove undefined values (let Zod defaults handle them)
  const cleaned = removeUndefined(raw);

  return SuifiConfigSchema.parse(cleaned);
}

/**
 * Validate configuration without throwing
 */
export function validateConfig(config: unknown): string[] {
  const result = SuifiConfigSchema.safeParse(config);
  if (result.success) return [];

  return result.error.issues.map(err => `${String(err.path.join('.'))}: ${err.message}`);
}

/**
 * Get agent address from configuration
 */
export function getAgentAddress(config: SuifiConfig): `0x${string}` {
  return privateKeyToAccount(config.yellow.agentPrivateKey as `0x${string}`).address;
}

/**
 * Get merchant address from configuration
 */
export function getMerchantAddress(config: SuifiConfig): `0x${string}` {
  return config.yellow.merchantAddress as `0x${string}`;
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
 */
export function createDemoConfig(overrides?: Partial<SuifiConfig>): SuifiConfig {
  const demoPrivateKey = '0x0000000000000000000000000000000000000000000000000000000000000001';

  return SuifiConfigSchema.parse({
    yellow: {
      clearnodeUrl: 'wss://clearnet-sandbox.yellow.com/ws',
      agentPrivateKey: process.env.YELLOW_AGENT_PRIVATE_KEY ?? demoPrivateKey,
      merchantAddress:
        process.env.YELLOW_MERCHANT_ADDRESS ?? '0x0000000000000000000000000000000000000001',
      merchantPrivateKey: process.env.YELLOW_MERCHANT_PRIVATE_KEY ?? demoPrivateKey,
      assetSymbol: 'ytest.usd',
    },
    pricing: {
      pricePerCall: '1.0',
      freeCallsPerSession: 5,
      sessionDepositAmount: '11.0',
    },
    strategy: {
      name: 'conservative',
      minApyForDeposit: 10,
      minTvlUsd: 100000,
      maxApyForWithdraw: 3,
      highApyThreshold: 30,
      stablecoinBonus: 10,
      apyWeight: 2,
      tvlWeight: 1,
    },
    tracker: {
      dbPath: './data/suifi-decisions.json',
      autoSave: true,
      evaluationDays: [1, 7, 30],
    },
    ...overrides,
  });
}
