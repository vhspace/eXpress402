/**
 * Sentifi - Execution Types
 *
 * Interfaces for trade execution, both live (LI.FI) and simulated.
 */

import type { TradeIntent, Holding } from '../types.js';

/** Execution mode */
export type ExecutionMode = 'live' | 'paper' | 'demo';

/** Execution configuration */
export interface ExecutionConfig {
  /** Execution mode */
  mode: ExecutionMode;
  /** LI.FI integrator name */
  integrator: string;
  /** Default slippage tolerance */
  defaultSlippage: number;
  /** Quote timeout in milliseconds */
  quoteTimeoutMs: number;
  /** Execution timeout in milliseconds */
  executionTimeoutMs: number;
  /** Whether to auto-approve transactions */
  autoApprove: boolean;
}

/** Default execution configuration */
export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  mode: 'demo',
  integrator: 'eXpress402-Sentifi',
  defaultSlippage: 0.03,
  quoteTimeoutMs: 30000,
  executionTimeoutMs: 120000,
  autoApprove: false,
};

/** Quote request */
export interface QuoteRequest {
  /** Token to swap from */
  fromToken: string;
  /** Token to swap to */
  toToken: string;
  /** Source chain ID */
  fromChainId: number;
  /** Destination chain ID */
  toChainId: number;
  /** Amount in token units (smallest denomination) */
  amount: string;
  /** Wallet address */
  fromAddress: string;
  /** Destination address (defaults to fromAddress) */
  toAddress?: string;
  /** Maximum slippage (0-1) */
  slippage?: number;
}

/** Route step in a quote */
export interface RouteStep {
  /** Step type (swap, bridge, etc.) */
  type: string;
  /** Tool/protocol used */
  tool: string;
  /** Tool display name */
  toolName: string;
  /** Source chain */
  fromChain: string;
  /** Destination chain */
  toChain: string;
  /** Source token */
  fromToken: string;
  /** Destination token */
  toToken: string;
  /** Estimated duration in seconds */
  estimatedDurationSeconds?: number;
}

/** Quote result */
export interface QuoteResult {
  /** Whether quote was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Quote ID for execution */
  quoteId?: string;
  /** Route name */
  routeName?: string;
  /** Input amount (human readable) */
  inputAmount: string;
  /** Input token symbol */
  inputToken: string;
  /** Estimated output amount (human readable) */
  estimatedOutput: string;
  /** Output token symbol */
  outputToken: string;
  /** Estimated gas cost in USD */
  gasCostUsd: number;
  /** Total fees in USD */
  totalFeesUsd: number;
  /** Exchange rate */
  exchangeRate: number;
  /** Minimum output amount */
  minimumOutput: string;
  /** Route steps */
  steps: RouteStep[];
  /** Raw route data for execution */
  rawRoute?: unknown;
  /** Source of quote */
  source: 'live' | 'fallback' | 'simulated';
  /** Quote timestamp */
  timestamp: Date;
  /** Quote expiry */
  expiresAt?: Date;
}

/** Execution request */
export interface ExecutionRequest {
  /** Trade intent */
  intent: TradeIntent;
  /** Quote to execute */
  quote: QuoteResult;
  /** Wallet address */
  walletAddress: string;
  /** Whether user has approved */
  userApproved: boolean;
}

/** Execution status */
export type ExecutionStatus =
  | 'pending'
  | 'approving'
  | 'approved'
  | 'executing'
  | 'confirming'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Execution result */
export interface ExecutionResult {
  /** Whether execution was successful */
  success: boolean;
  /** Execution status */
  status: ExecutionStatus;
  /** Error message if failed */
  error?: string;
  /** Transaction hash */
  txHash?: string;
  /** Block number */
  blockNumber?: number;
  /** Chain ID of transaction */
  chainId: number;
  /** Actual input amount */
  inputAmount: string;
  /** Actual output amount */
  outputAmount?: string;
  /** Actual gas used in USD */
  gasUsedUsd?: number;
  /** Execution timestamp */
  timestamp: Date;
  /** Execution mode used */
  mode: ExecutionMode;
  /** Explorer URL */
  explorerUrl?: string;
}

/** Trade executor interface */
export interface TradeExecutor {
  /** Executor name */
  readonly name: string;

  /**
   * Get a quote for a trade
   */
  getQuote(request: QuoteRequest): Promise<QuoteResult>;

  /**
   * Execute a trade
   */
  execute(request: ExecutionRequest): Promise<ExecutionResult>;

  /**
   * Check executor health/availability
   */
  healthCheck(): Promise<boolean>;

  /**
   * Get supported chains
   */
  getSupportedChains(): Promise<number[]>;
}

/** Portfolio manager interface for execution */
export interface PortfolioManager {
  /**
   * Get current holdings
   */
  getHoldings(): Promise<Holding[]>;

  /**
   * Get total portfolio value in USD
   */
  getTotalValueUsd(): Promise<number>;

  /**
   * Update holdings after a trade
   */
  updateAfterTrade(result: ExecutionResult): Promise<void>;

  /**
   * Simulate deposit
   */
  deposit(amount: number, token: string, chainId: number): Promise<void>;

  /**
   * Simulate withdrawal
   */
  withdraw(amount: number, token: string, chainId: number): Promise<void>;
}
