/**
 * Sentifi - Execution Simulator
 *
 * Simulates trade execution and portfolio management for demo mode.
 * Tracks virtual holdings and P&L without real transactions.
 */

import type {
  TradeExecutor,
  PortfolioManager,
  QuoteRequest,
  QuoteResult,
  ExecutionRequest,
  ExecutionResult,
  RouteStep,
} from './types.js';
import type { Holding } from '../types.js';

/** Simulated price data */
interface PriceData {
  price: number;
  lastUpdated: Date;
}

/** Default token prices for simulation */
const SIMULATED_PRICES: Record<string, number> = {
  ETH: 2500,
  USDC: 1,
  USDT: 1,
  WETH: 2500,
  WBTC: 45000,
  MATIC: 0.85,
};

/** Chain names for display */
const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  137: 'Polygon',
  42161: 'Arbitrum',
  8453: 'Base',
};

/**
 * Simulated trade executor for demo mode
 */
export class SimulatedExecutor implements TradeExecutor {
  readonly name = 'simulator';
  private priceCache: Map<string, PriceData> = new Map();
  private executionDelay: number;

  constructor(options?: { executionDelayMs?: number }) {
    this.executionDelay = options?.executionDelayMs ?? 1000;
    this.initializePrices();
  }

  private initializePrices(): void {
    for (const [symbol, price] of Object.entries(SIMULATED_PRICES)) {
      this.priceCache.set(symbol.toUpperCase(), {
        price,
        lastUpdated: new Date(),
      });
    }
  }

  /**
   * Get a simulated quote
   */
  async getQuote(request: QuoteRequest): Promise<QuoteResult> {
    // Simulate some latency
    await this.delay(200);

    const fromToken = this.normalizeToken(request.fromToken);
    const toToken = this.normalizeToken(request.toToken);

    const fromPrice = this.getPrice(fromToken);
    const toPrice = this.getPrice(toToken);

    if (fromPrice === 0 || toPrice === 0) {
      return {
        success: false,
        error: `Unknown token: ${fromPrice === 0 ? fromToken : toToken}`,
        inputAmount: '0',
        inputToken: fromToken,
        estimatedOutput: '0',
        outputToken: toToken,
        gasCostUsd: 0,
        totalFeesUsd: 0,
        exchangeRate: 0,
        minimumOutput: '0',
        steps: [],
        source: 'simulated',
        timestamp: new Date(),
      };
    }

    // Calculate amounts
    const inputAmount = parseFloat(request.amount) / Math.pow(10, 18);
    const inputValueUsd = inputAmount * fromPrice;
    const outputAmount = inputValueUsd / toPrice;

    // Simulate slippage and fees
    const slippage = request.slippage ?? 0.03;
    const fee = 0.003; // 0.3% fee
    const gasCost = this.estimateGas(request.fromChainId, request.toChainId);

    const outputAfterFees = outputAmount * (1 - fee) * (1 - slippage / 2);
    const minimumOutput = outputAmount * (1 - fee) * (1 - slippage);

    // Build route steps
    const steps: RouteStep[] = [];

    if (request.fromChainId !== request.toChainId) {
      // Bridge step
      steps.push({
        type: 'bridge',
        tool: 'stargate',
        toolName: 'Stargate Finance',
        fromChain: CHAIN_NAMES[request.fromChainId] || `Chain ${request.fromChainId}`,
        toChain: CHAIN_NAMES[request.toChainId] || `Chain ${request.toChainId}`,
        fromToken,
        toToken: fromToken,
        estimatedDurationSeconds: 120,
      });
    }

    if (fromToken !== toToken) {
      // Swap step
      steps.push({
        type: 'swap',
        tool: 'uniswap',
        toolName: 'Uniswap V3',
        fromChain: CHAIN_NAMES[request.toChainId] || `Chain ${request.toChainId}`,
        toChain: CHAIN_NAMES[request.toChainId] || `Chain ${request.toChainId}`,
        fromToken,
        toToken,
        estimatedDurationSeconds: 30,
      });
    }

    return {
      success: true,
      quoteId: `sim-${Date.now()}`,
      routeName: steps.map((s) => s.toolName).join(' → ') || 'Direct Transfer',
      inputAmount: inputAmount.toFixed(6),
      inputToken: fromToken,
      estimatedOutput: outputAfterFees.toFixed(6),
      outputToken: toToken,
      gasCostUsd: gasCost,
      totalFeesUsd: gasCost + inputValueUsd * fee,
      exchangeRate: toPrice / fromPrice,
      minimumOutput: minimumOutput.toFixed(6),
      steps,
      source: 'simulated',
      timestamp: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    };
  }

  /**
   * Execute a simulated trade
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const { intent, quote, userApproved } = request;

    if (!userApproved) {
      return {
        success: false,
        status: 'cancelled',
        error: 'User approval required',
        chainId: intent.fromChainId,
        inputAmount: quote.inputAmount,
        timestamp: new Date(),
        mode: 'demo',
      };
    }

    // Simulate execution time
    await this.delay(this.executionDelay);

    // Generate fake transaction hash
    const txHash = `0x${this.generateHex(64)}`;

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
      mode: 'demo',
      explorerUrl: `https://etherscan.io/tx/${txHash}`,
    };
  }

  /**
   * Health check always passes for simulator
   */
  async healthCheck(): Promise<boolean> {
    return true;
  }

  /**
   * Get supported chains
   */
  async getSupportedChains(): Promise<number[]> {
    return [1, 10, 137, 42161, 8453];
  }

  /**
   * Update simulated price
   */
  setPrice(token: string, price: number): void {
    this.priceCache.set(token.toUpperCase(), {
      price,
      lastUpdated: new Date(),
    });
  }

  /**
   * Get simulated price
   */
  getPrice(token: string): number {
    return this.priceCache.get(token.toUpperCase())?.price ?? 0;
  }

  private normalizeToken(tokenOrAddress: string): string {
    if (tokenOrAddress.startsWith('0x')) {
      // Common address mappings
      const lower = tokenOrAddress.toLowerCase();
      if (lower === '0x0000000000000000000000000000000000000000') return 'ETH';
      if (lower === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48') return 'USDC';
      return tokenOrAddress.slice(0, 10);
    }
    return tokenOrAddress.toUpperCase();
  }

  private estimateGas(fromChain: number, toChain: number): number {
    // Base gas cost
    let gasCost = 5;

    // Cross-chain adds cost
    if (fromChain !== toChain) {
      gasCost += 10;
    }

    // Ethereum mainnet is more expensive
    if (fromChain === 1 || toChain === 1) {
      gasCost += 10;
    }

    return gasCost;
  }

  private generateHex(length: number): string {
    return Array.from({ length }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Simulated portfolio manager for demo mode
 */
export class SimulatedPortfolioManager implements PortfolioManager {
  private holdings: Holding[] = [];
  private executor: SimulatedExecutor;

  constructor(executor?: SimulatedExecutor) {
    this.executor = executor || new SimulatedExecutor();
  }

  /**
   * Get current holdings
   */
  async getHoldings(): Promise<Holding[]> {
    // Update USD values
    return this.holdings.map((h) => ({
      ...h,
      valueUsd: h.balance * this.executor.getPrice(h.token),
    }));
  }

  /**
   * Get total portfolio value
   */
  async getTotalValueUsd(): Promise<number> {
    const holdings = await this.getHoldings();
    return holdings.reduce((sum, h) => sum + h.valueUsd, 0);
  }

  /**
   * Update holdings after a trade
   */
  async updateAfterTrade(result: ExecutionResult): Promise<void> {
    if (!result.success || !result.outputAmount) {
      return;
    }

    // This would be called by the orchestrator with the actual trade details
    // For now, the portfolio update logic is handled externally
  }

  /**
   * Simulate deposit
   */
  async deposit(amount: number, token: string, chainId: number): Promise<void> {
    const existing = this.holdings.find(
      (h) => h.token === token && h.chainId === chainId,
    );

    if (existing) {
      existing.balance += amount;
      existing.valueUsd = existing.balance * this.executor.getPrice(token);
    } else {
      this.holdings.push({
        chainId,
        chainName: CHAIN_NAMES[chainId] || `Chain ${chainId}`,
        token,
        tokenAddress: '0x0000000000000000000000000000000000000000',
        address: '0x0000000000000000000000000000000000000000',
        balance: amount,
        decimals: 18,
        valueUsd: amount * this.executor.getPrice(token),
      });
    }
  }

  /**
   * Simulate withdrawal
   */
  async withdraw(amount: number, token: string, chainId: number): Promise<void> {
    const existing = this.holdings.find(
      (h) => h.token === token && h.chainId === chainId,
    );

    if (existing) {
      existing.balance = Math.max(0, existing.balance - amount);
      existing.valueUsd = existing.balance * this.executor.getPrice(token);

      // Remove if zero balance
      if (existing.balance === 0) {
        this.holdings = this.holdings.filter((h) => h !== existing);
      }
    }
  }

  /**
   * Execute a trade and update portfolio
   */
  async executeTrade(
    fromToken: string,
    toToken: string,
    fromAmount: number,
    toAmount: number,
    chainId: number,
  ): Promise<void> {
    // Deduct from token
    await this.withdraw(fromAmount, fromToken, chainId);

    // Add to token
    await this.deposit(toAmount, toToken, chainId);
  }

  /**
   * Set holdings directly (for initialization)
   */
  setHoldings(holdings: Holding[]): void {
    this.holdings = holdings.map((h) => ({
      ...h,
      valueUsd: h.balance * this.executor.getPrice(h.token),
    }));
  }

  /**
   * Clear all holdings
   */
  clear(): void {
    this.holdings = [];
  }
}

/**
 * Create a simulated executor
 */
export function createSimulatedExecutor(options?: {
  executionDelayMs?: number;
}): SimulatedExecutor {
  return new SimulatedExecutor(options);
}

/**
 * Create a simulated portfolio manager
 */
export function createSimulatedPortfolioManager(
  executor?: SimulatedExecutor,
): SimulatedPortfolioManager {
  return new SimulatedPortfolioManager(executor);
}
