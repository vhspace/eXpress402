/**
 * Sentifi Agent - Type Definitions
 * AI-powered cross-chain trading agent using eXpress402 MCP + LI.FI
 */

// LI.FI types are used at runtime, not imported directly

// ============================================================================
// Configuration Types
// ============================================================================

export interface AgentConfig {
  // Yellow Network Session
  yellow: {
    clearnodeUrl: string;
    agentPrivateKey: string;
    agentAddress: string;
    merchantAddress: string;
    assetSymbol: string;
    sessionTtlSeconds: number;
    sessionAllocations: Record<string, string>;
  };

  // LI.FI Configuration
  lifi: {
    integratorId: string;
    supportedChains: number[];
  };

  // Strategy Configuration
  strategy: {
    // Sentiment thresholds (-100 to +100)
    bullishThreshold: number; // e.g., 40
    bearishThreshold: number; // e.g., -40

    // Portfolio drift threshold (0-1)
    rebalanceThreshold: number; // e.g., 0.1 = 10%

    // Trade limits
    maxTradeUsd: number;
    minTradeUsd: number;

    // Target allocations by token symbol
    targetAllocations: Record<string, number>;

    // Symbols to monitor for sentiment
    watchSymbols: string[];
  };

  // Agent wallet for LI.FI execution
  wallet: {
    privateKey: string;
  };

  // Timing
  pollingIntervalMs: number;
  maxIterations?: number; // For demo, limit iterations
}

// ============================================================================
// Monitor Types
// ============================================================================

export interface SentimentSource {
  type: 'reddit' | 'tavily';
  title: string;
  score: number; // -10 to +10
  confidence: number; // 0-1
  url: string;
}

export interface SentimentResult {
  score: number; // -100 to +100
  sources: SentimentSource[];
  confidence: number; // 0-1
  timestamp: Date;
}

export interface ExternalPrice {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
}

export interface PortfolioHolding {
  chainId: number;
  chainName: string;
  token: string;
  tokenAddress: string;
  balance: bigint;
  balanceFormatted: string;
  valueUsd: number;
}

export interface SessionStatus {
  appSessionId: string;
  remaining: number;
  queriesMade: number;
  totalSpent: number;
}

export interface MonitorResult {
  timestamp: Date;
  sentiment: SentimentResult;
  externalPrices: ExternalPrice[];
  portfolio: PortfolioHolding[];
  session: SessionStatus;
}

// ============================================================================
// Decision Types
// ============================================================================

export type ActionType =
  | 'SWAP_BULLISH' // Swap stables to risk assets
  | 'SWAP_BEARISH' // Swap risk assets to stables
  | 'REBALANCE' // Correct portfolio drift
  | 'DEPOSIT_YIELD' // Deposit into yield protocol (Composer)
  | 'WITHDRAW_YIELD' // Withdraw from yield protocol (Composer)
  | 'HOLD'; // No action

export interface ActionParams {
  fromChain: number;
  toChain: number;
  fromToken: string;
  fromTokenAddress: string;
  toToken: string;
  toTokenAddress: string;
  amount: bigint;
  amountFormatted: string;

  // For Composer workflows
  composerWorkflow?: 'bridge-swap-deposit' | 'withdraw-bridge';
  yieldProtocol?: 'aave' | 'morpho';
}

export interface Action {
  type: ActionType;
  params: ActionParams;
  reason: string;
  confidence: number;
}

// ============================================================================
// Execution Types
// ============================================================================

export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  fromAmount?: string;
  toAmount?: string;
  route?: string;
  workflow?: string;
  error?: string;
  explorerUrl?: string;
}

// ============================================================================
// Market Data Types (from MCP tools)
// ============================================================================

export interface RedditPost {
  title: string;
  url: string;
  score: number;
  createdUtc: number;
  subreddit: string;
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface MarketRumors {
  symbol: string;
  reddit: RedditPost[];
  tavily: TavilyResult[];
}

export interface StockPrice {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
}

// ============================================================================
// Agent State
// ============================================================================

export interface AgentState {
  isRunning: boolean;
  iteration: number;
  lastMonitor?: MonitorResult;
  lastAction?: Action;
  lastExecution?: ExecutionResult;
  history: AgentHistoryEntry[];
}

export interface AgentHistoryEntry {
  timestamp: Date;
  iteration: number;
  sentiment: number;
  action: ActionType;
  txHash?: string;
  success: boolean;
}

// ============================================================================
// Chain & Token Constants
// ============================================================================

export const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  137: 'Polygon',
  42161: 'Arbitrum',
  8453: 'Base',
  43114: 'Avalanche',
};

export const CHAIN_EXPLORERS: Record<number, string> = {
  1: 'https://etherscan.io/tx/',
  10: 'https://optimistic.etherscan.io/tx/',
  137: 'https://polygonscan.com/tx/',
  42161: 'https://arbiscan.io/tx/',
  8453: 'https://basescan.org/tx/',
  43114: 'https://snowtrace.io/tx/',
};

// Common token addresses by chain
export const TOKENS: Record<number, Record<string, string>> = {
  // Arbitrum
  42161: {
    ETH: '0x0000000000000000000000000000000000000000',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
  },
  // Optimism
  10: {
    ETH: '0x0000000000000000000000000000000000000000',
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    OP: '0x4200000000000000000000000000000000000042',
  },
  // Base
  8453: {
    ETH: '0x0000000000000000000000000000000000000000',
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
};

// Stablecoins for bearish swaps
export const STABLECOINS = ['USDC', 'USDT', 'DAI'];

// Risk assets for bullish swaps
export const RISK_ASSETS = ['ETH', 'WETH', 'ARB', 'OP'];
