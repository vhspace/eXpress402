/**
 * Sentifi - LI.FI Trade Executor
 *
 * Executes trades using the LI.FI SDK for cross-chain swaps.
 * Supports live execution, paper trading, and demo mode.
 */

import { createConfig, getRoutes } from '@lifi/sdk';
import type {
  TradeExecutor,
  ExecutionConfig,
  QuoteRequest,
  QuoteResult,
  ExecutionRequest,
  ExecutionResult,
  RouteStep,
} from './types.js';
import { DEFAULT_EXECUTION_CONFIG } from './types.js';

/** Chain ID to name mapping */
const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  56: 'BNB Chain',
  100: 'Gnosis',
  137: 'Polygon',
  250: 'Fantom',
  324: 'zkSync Era',
  8453: 'Base',
  42161: 'Arbitrum',
  43114: 'Avalanche',
  59144: 'Linea',
};

/** Common token addresses */
const TOKEN_ADDRESSES: Record<number, Record<string, string>> = {
  1: {
    ETH: '0x0000000000000000000000000000000000000000',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
  10: {
    ETH: '0x0000000000000000000000000000000000000000',
    USDC: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
  },
  137: {
    MATIC: '0x0000000000000000000000000000000000000000',
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  },
  42161: {
    ETH: '0x0000000000000000000000000000000000000000',
    USDC: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
  },
  8453: {
    ETH: '0x0000000000000000000000000000000000000000',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
};

/** Supported chains */
const SUPPORTED_CHAINS = [1, 10, 137, 42161, 8453];

let lifiInitialized = false;

/**
 * Initialize LI.FI SDK lazily
 */
function ensureLifiInitialized(integrator: string): void {
  if (!lifiInitialized) {
    createConfig({ integrator });
    lifiInitialized = true;
  }
}

/**
 * LI.FI Trade Executor
 */
export class LifiExecutor implements TradeExecutor {
  readonly name = 'lifi';
  private config: ExecutionConfig;

  constructor(config?: Partial<ExecutionConfig>) {
    this.config = { ...DEFAULT_EXECUTION_CONFIG, ...config };
  }

  /**
   * Get a quote for a trade
   */
  async getQuote(request: QuoteRequest): Promise<QuoteResult> {
    try {
      ensureLifiInitialized(this.config.integrator);

      if (!request.amount || !/^\d+$/.test(request.amount)) {
        return this.createErrorQuote(
          `Invalid amount (must be integer base-units string): ${String(request.amount)}`,
        );
      }

      // Resolve token addresses
      const fromTokenAddress = this.resolveTokenAddress(
        request.fromToken,
        request.fromChainId,
      );
      const toTokenAddress = this.resolveTokenAddress(
        request.toToken,
        request.toChainId,
      );

      // Build routes request
      const routesRequest = {
        fromChainId: request.fromChainId,
        toChainId: request.toChainId,
        fromTokenAddress,
        toTokenAddress,
        fromAmount: request.amount,
        fromAddress: request.fromAddress,
        toAddress: request.toAddress || request.fromAddress,
        options: {
          slippage: request.slippage || this.config.defaultSlippage,
          order: 'RECOMMENDED' as const,
        },
      };

      // Fetch routes with timeout
      const routesPromise = getRoutes(routesRequest);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Quote timeout')),
          this.config.quoteTimeoutMs,
        ),
      );

      const routesResponse = await Promise.race([routesPromise, timeoutPromise]);

      if (!routesResponse.routes || routesResponse.routes.length === 0) {
        return this.createErrorQuote('No routes available for this trade');
      }

      const bestRoute = routesResponse.routes[0];

      // Extract route details
      const steps: RouteStep[] = bestRoute.steps.map((step: any) => ({
        type: step.type,
        tool: step.tool,
        toolName: step.toolDetails?.name || step.tool,
        fromChain: CHAIN_NAMES[step.action.fromChainId] || `Chain ${step.action.fromChainId}`,
        toChain: CHAIN_NAMES[step.action.toChainId] || `Chain ${step.action.toChainId}`,
        fromToken: step.action.fromToken.symbol,
        toToken: step.action.toToken.symbol,
        estimatedDurationSeconds: step.estimate?.executionDuration,
      }));

      // Calculate totals
      const gasCostUsd = parseFloat(bestRoute.gasCostUSD || '0');
      const totalFeesUsd = gasCostUsd + parseFloat((bestRoute as any).feeCostUSD || '0');

      return {
        success: true,
        quoteId: bestRoute.id,
        routeName: bestRoute.steps.map((s: any) => s.toolDetails?.name || s.tool).join(' → '),
        inputAmount: this.formatAmount(
          bestRoute.fromAmount,
          bestRoute.fromToken.decimals,
        ),
        inputToken: bestRoute.fromToken.symbol,
        estimatedOutput: this.formatAmount(
          bestRoute.toAmount,
          bestRoute.toToken.decimals,
        ),
        outputToken: bestRoute.toToken.symbol,
        gasCostUsd,
        totalFeesUsd,
        exchangeRate: parseFloat(bestRoute.toAmount) / parseFloat(bestRoute.fromAmount),
        minimumOutput: this.formatAmount(
          bestRoute.toAmountMin,
          bestRoute.toToken.decimals,
        ),
        steps,
        rawRoute: bestRoute,
        source: 'live',
        timestamp: new Date(),
        expiresAt: new Date(Date.now() + 60000), // 1 minute expiry
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return this.createErrorQuote(message);
    }
  }

  /**
   * Execute a trade
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const { intent, quote, walletAddress, userApproved } = request;

    // Check mode
    if (this.config.mode === 'demo') {
      return this.simulateExecution(request);
    }

    if (!userApproved && !this.config.autoApprove) {
      return {
        success: false,
        status: 'cancelled',
        error: 'User approval required',
        chainId: intent.fromChainId,
        inputAmount: quote.inputAmount,
        timestamp: new Date(),
        mode: this.config.mode,
      };
    }

    // Paper trading mode - simulate but track
    if (this.config.mode === 'paper') {
      return this.simulateExecution(request);
    }

    // Live execution
    // NOTE: Live execution requires wallet signing which isn't implemented
    // in this demo context. Would use executeRoute from @lifi/sdk
    return {
      success: false,
      status: 'failed',
      error: 'Live execution requires wallet integration',
      chainId: intent.fromChainId,
      inputAmount: quote.inputAmount,
      timestamp: new Date(),
      mode: 'live',
    };
  }

  /**
   * Simulate execution for demo/paper modes
   */
  private simulateExecution(request: ExecutionRequest): ExecutionResult {
    const { intent, quote } = request;

    // Generate a fake transaction hash
    const txHash = `0x${Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('')}`;

    return {
      success: true,
      status: 'completed',
      txHash,
      blockNumber: Math.floor(Math.random() * 1000000) + 18000000,
      chainId: intent.fromChainId,
      inputAmount: quote.inputAmount,
      outputAmount: quote.estimatedOutput,
      gasUsedUsd: quote.gasCostUsd,
      timestamp: new Date(),
      mode: this.config.mode,
      explorerUrl: this.getExplorerUrl(intent.fromChainId, txHash),
    };
  }

  /**
   * Check executor health
   */
  async healthCheck(): Promise<boolean> {
    try {
      ensureLifiInitialized(this.config.integrator);
      // Could add actual health check to LI.FI API here
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get supported chains
   */
  async getSupportedChains(): Promise<number[]> {
    return SUPPORTED_CHAINS;
  }

  /**
   * Resolve token symbol to address
   */
  private resolveTokenAddress(tokenOrAddress: string, chainId: number): string {
    // If already an address, return it
    if (tokenOrAddress.startsWith('0x')) {
      return tokenOrAddress;
    }

    // Look up by symbol
    const chainTokens = TOKEN_ADDRESSES[chainId];
    if (chainTokens && chainTokens[tokenOrAddress.toUpperCase()]) {
      return chainTokens[tokenOrAddress.toUpperCase()];
    }

    // Default to native token address for unknown symbols
    return '0x0000000000000000000000000000000000000000';
  }

  /**
   * Format amount from wei to human readable
   */
  private formatAmount(amount: string, decimals: number): string {
    const value = parseFloat(amount) / Math.pow(10, decimals);
    return value.toFixed(6);
  }

  /**
   * Create error quote result
   */
  private createErrorQuote(error: string): QuoteResult {
    return {
      success: false,
      error,
      inputAmount: '0',
      inputToken: '',
      estimatedOutput: '0',
      outputToken: '',
      gasCostUsd: 0,
      totalFeesUsd: 0,
      exchangeRate: 0,
      minimumOutput: '0',
      steps: [],
      source: 'fallback',
      timestamp: new Date(),
    };
  }

  /**
   * Get block explorer URL
   */
  private getExplorerUrl(chainId: number, txHash: string): string {
    const explorers: Record<number, string> = {
      1: 'https://etherscan.io/tx/',
      10: 'https://optimistic.etherscan.io/tx/',
      137: 'https://polygonscan.com/tx/',
      42161: 'https://arbiscan.io/tx/',
      8453: 'https://basescan.org/tx/',
    };

    const base = explorers[chainId] || 'https://etherscan.io/tx/';
    return `${base}${txHash}`;
  }
}

/**
 * Create a LI.FI executor instance
 */
export function createLifiExecutor(config?: Partial<ExecutionConfig>): LifiExecutor {
  return new LifiExecutor(config);
}
