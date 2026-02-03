/**
 * Sentifi Agent - Monitor Module
 * Gathers market intelligence via eXpress402 MCP
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createPublicClient, http, formatUnits } from 'viem';
import { arbitrum, optimism, base } from 'viem/chains';
import type {
  AgentConfig,
  MonitorResult,
  MarketRumors,
  StockPrice,
  PortfolioHolding,
  SessionStatus,
  ExternalPrice,
} from './types.js';
import { TOKENS, CHAIN_NAMES } from './types.js';
import { analyzeSentiment } from './sentiment.js';

// Chain configurations for viem
const CHAIN_CONFIGS = {
  42161: { chain: arbitrum, rpc: 'https://arb1.arbitrum.io/rpc' },
  10: { chain: optimism, rpc: 'https://mainnet.optimism.io' },
  8453: { chain: base, rpc: 'https://mainnet.base.org' },
};

// ERC20 ABI for balance queries
const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Call market_rumors MCP tool
 */
async function fetchMarketRumors(
  mcpClient: Client,
  symbol: string,
  sessionMeta: { appSessionId: string; payer: string },
): Promise<MarketRumors> {
  const result = await mcpClient.callTool({
    name: 'market_rumors',
    arguments: { symbol },
    _meta: { 'x402/yellow': sessionMeta },
  });

  const content = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text;
  if (!content) {
    throw new Error('Empty response from market_rumors');
  }

  return JSON.parse(content) as MarketRumors;
}

/**
 * Call stock_price MCP tool
 */
async function fetchStockPrice(
  mcpClient: Client,
  symbol: string,
  sessionMeta: { appSessionId: string; payer: string },
): Promise<StockPrice> {
  const result = await mcpClient.callTool({
    name: 'stock_price',
    arguments: { symbol },
    _meta: { 'x402/yellow': sessionMeta },
  });

  const content = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text;
  if (!content) {
    throw new Error('Empty response from stock_price');
  }

  return JSON.parse(content) as StockPrice;
}

/**
 * Get native token balance for an address on a chain
 */
async function getNativeBalance(
  chainId: number,
  address: string,
): Promise<{ balance: bigint; formatted: string }> {
  const chainConfig = CHAIN_CONFIGS[chainId as keyof typeof CHAIN_CONFIGS];
  if (!chainConfig) {
    return { balance: 0n, formatted: '0' };
  }

  const client = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpc),
  });

  const balance = await client.getBalance({ address: address as `0x${string}` });
  const formatted = formatUnits(balance, 18);

  return { balance, formatted };
}

/**
 * Get ERC20 token balance for an address on a chain
 */
async function getTokenBalance(
  chainId: number,
  tokenAddress: string,
  walletAddress: string,
): Promise<{ balance: bigint; formatted: string; decimals: number }> {
  const chainConfig = CHAIN_CONFIGS[chainId as keyof typeof CHAIN_CONFIGS];
  if (!chainConfig) {
    return { balance: 0n, formatted: '0', decimals: 18 };
  }

  const client = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpc),
  });

  try {
    const [balance, decimals] = await Promise.all([
      client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [walletAddress as `0x${string}`],
      }),
      client.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'decimals',
      }),
    ]);

    const formatted = formatUnits(balance, decimals);
    return { balance, formatted, decimals };
  } catch {
    return { balance: 0n, formatted: '0', decimals: 18 };
  }
}

/**
 * Get portfolio holdings across all supported chains
 */
async function getPortfolioState(
  config: AgentConfig,
  walletAddress: string,
): Promise<PortfolioHolding[]> {
  const holdings: PortfolioHolding[] = [];

  for (const chainId of config.lifi.supportedChains) {
    const tokens = TOKENS[chainId];
    if (!tokens) continue;

    // Get native ETH balance
    const nativeBalance = await getNativeBalance(chainId, walletAddress);
    if (nativeBalance.balance > 0n) {
      holdings.push({
        chainId,
        chainName: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
        token: 'ETH',
        tokenAddress: tokens.ETH,
        balance: nativeBalance.balance,
        balanceFormatted: nativeBalance.formatted,
        valueUsd: parseFloat(nativeBalance.formatted) * 2500, // Rough ETH price estimate
      });
    }

    // Get ERC20 token balances
    for (const [symbol, address] of Object.entries(tokens)) {
      if (symbol === 'ETH') continue; // Skip native token
      if (address === '0x0000000000000000000000000000000000000000') continue;

      const tokenBalance = await getTokenBalance(chainId, address, walletAddress);
      if (tokenBalance.balance > 0n) {
        // Rough USD value estimation
        let valueUsd = parseFloat(tokenBalance.formatted);
        if (symbol === 'WETH') valueUsd *= 2500;
        else if (['USDC', 'USDT', 'DAI'].includes(symbol)) valueUsd *= 1;
        else valueUsd *= 1; // Unknown tokens

        holdings.push({
          chainId,
          chainName: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
          token: symbol,
          tokenAddress: address,
          balance: tokenBalance.balance,
          balanceFormatted: tokenBalance.formatted,
          valueUsd,
        });
      }
    }
  }

  return holdings;
}

/**
 * Monitor state for tracking session usage
 */
export interface MonitorState {
  queriesMade: number;
  totalSpent: number;
  pricePerCall: number;
}

/**
 * Main monitor function - gathers all market intelligence
 */
export async function monitor(
  mcpClient: Client,
  config: AgentConfig,
  appSessionId: string,
  walletAddress: string,
  state: MonitorState,
): Promise<MonitorResult> {
  const sessionMeta = {
    appSessionId,
    payer: config.yellow.agentAddress,
  };

  // 1. Fetch market rumors for primary watch symbol
  const primarySymbol = config.strategy.watchSymbols[0] ?? 'ETH';
  let rumors: MarketRumors;
  try {
    rumors = await fetchMarketRumors(mcpClient, primarySymbol, sessionMeta);
    state.queriesMade++;
    state.totalSpent += state.pricePerCall;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to fetch market rumors: ${message}`);
    rumors = { symbol: primarySymbol, reddit: [], tavily: [] };
  }

  // 2. Analyze sentiment
  const sentiment = analyzeSentiment(rumors);

  // 3. Optionally fetch stock prices for correlated assets (e.g., tech stocks)
  const externalPrices: ExternalPrice[] = [];
  const correlatedSymbols = ['NVDA', 'COIN']; // Crypto-correlated stocks

  for (const symbol of correlatedSymbols.slice(0, 1)) {
    // Limit to save session balance
    try {
      const price = await fetchStockPrice(mcpClient, symbol, sessionMeta);
      state.queriesMade++;
      state.totalSpent += state.pricePerCall;
      externalPrices.push(price);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to fetch stock price for ${symbol}: ${message}`);
    }
  }

  // 4. Get portfolio state
  const portfolio = await getPortfolioState(config, walletAddress);

  // 5. Calculate session status
  const initialAllocation = parseFloat(
    config.yellow.sessionAllocations[config.yellow.agentAddress] ?? '10',
  );
  const session: SessionStatus = {
    appSessionId,
    remaining: initialAllocation - state.totalSpent,
    queriesMade: state.queriesMade,
    totalSpent: state.totalSpent,
  };

  return {
    timestamp: new Date(),
    sentiment,
    externalPrices,
    portfolio,
    session,
  };
}

/**
 * Create initial monitor state
 */
export function createMonitorState(pricePerCall: number): MonitorState {
  return {
    queriesMade: 0,
    totalSpent: 0,
    pricePerCall,
  };
}
