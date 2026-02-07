/**
 * Sentifi Agent - Decision Engine
 * Determines trading actions based on sentiment and portfolio state
 */

import { parseUnits } from 'viem';
import type {
  AgentConfig,
  MonitorResult,
  Action,
  ActionType,
  ActionParams,
  PortfolioHolding,
} from './types.js';
import { TOKENS, STABLECOINS, RISK_ASSETS, CHAIN_NAMES } from './types.js';

/**
 * Calculate portfolio drift from target allocations
 * Returns drift as 0-1 value (e.g., 0.15 = 15% drift)
 */
function calculatePortfolioDrift(
  portfolio: PortfolioHolding[],
  targetAllocations: Record<string, number>,
): number {
  const totalValue = portfolio.reduce((sum, h) => sum + h.valueUsd, 0);
  if (totalValue === 0) return 0;

  let totalDrift = 0;

  for (const [token, targetPct] of Object.entries(targetAllocations)) {
    const holdings = portfolio.filter(h => h.token === token || h.token === `W${token}`);
    const currentValue = holdings.reduce((sum, h) => sum + h.valueUsd, 0);
    const currentPct = currentValue / totalValue;
    const drift = Math.abs(currentPct - targetPct);
    totalDrift += drift;
  }

  return totalDrift / 2; // Normalize (drift is counted twice)
}

/**
 * Find the best chain to trade on (highest balance)
 * Exported for potential future use in cross-chain optimization
 */
export function selectBestChain(portfolio: PortfolioHolding[], preferredChains: number[]): number {
  // Filter to preferred chains with holdings
  const chainBalances = new Map<number, number>();

  for (const holding of portfolio) {
    if (preferredChains.includes(holding.chainId)) {
      const current = chainBalances.get(holding.chainId) ?? 0;
      chainBalances.set(holding.chainId, current + holding.valueUsd);
    }
  }

  // Find chain with highest total value
  let bestChain = preferredChains[0] ?? 42161; // Default to Arbitrum
  let bestValue = 0;

  for (const [chainId, value] of chainBalances) {
    if (value > bestValue) {
      bestValue = value;
      bestChain = chainId;
    }
  }

  return bestChain;
}

/**
 * Find stablecoins in portfolio
 */
function findStablecoins(portfolio: PortfolioHolding[]): PortfolioHolding[] {
  return portfolio.filter(h => STABLECOINS.includes(h.token));
}

/**
 * Find risk assets in portfolio
 */
function findRiskAssets(portfolio: PortfolioHolding[]): PortfolioHolding[] {
  return portfolio.filter(h => RISK_ASSETS.includes(h.token));
}

/**
 * Calculate trade amount respecting limits
 */
function calculateTradeAmount(
  holding: PortfolioHolding,
  config: AgentConfig,
  tradePct: number = 0.5, // Trade 50% of holding by default
): { amount: bigint; amountFormatted: string; valueUsd: number } {
  const tradeValue = Math.min(holding.valueUsd * tradePct, config.strategy.maxTradeUsd);

  if (tradeValue < config.strategy.minTradeUsd) {
    return { amount: 0n, amountFormatted: '0', valueUsd: 0 };
  }

  // Calculate token amount based on value
  const tokenAmount = (tradeValue / holding.valueUsd) * parseFloat(holding.balanceFormatted);
  const decimals = holding.token === 'ETH' || holding.token === 'WETH' ? 18 : 6;
  const amount = parseUnits(tokenAmount.toFixed(decimals), decimals);

  return {
    amount,
    amountFormatted: tokenAmount.toFixed(6),
    valueUsd: tradeValue,
  };
}

/**
 * Select bullish trade parameters (stables → risk assets)
 */
function selectBullishTrade(
  portfolio: PortfolioHolding[],
  config: AgentConfig,
): ActionParams | null {
  const stables = findStablecoins(portfolio);
  if (stables.length === 0) return null;

  // Find stable with highest balance
  const fromHolding = stables.reduce((best, h) => (h.valueUsd > best.valueUsd ? h : best));

  const trade = calculateTradeAmount(fromHolding, config);
  if (trade.amount === 0n) return null;

  // Get WETH address on same chain
  const toTokenAddress =
    TOKENS[fromHolding.chainId]?.WETH ??
    TOKENS[fromHolding.chainId]?.ETH ??
    '0x0000000000000000000000000000000000000000';

  return {
    fromChain: fromHolding.chainId,
    toChain: fromHolding.chainId, // Same chain for simple swap
    fromToken: fromHolding.token,
    fromTokenAddress: fromHolding.tokenAddress,
    toToken: 'WETH',
    toTokenAddress,
    amount: trade.amount,
    amountFormatted: trade.amountFormatted,
  };
}

/**
 * Select bearish trade parameters (risk assets → stables)
 */
function selectBearishTrade(
  portfolio: PortfolioHolding[],
  config: AgentConfig,
): ActionParams | null {
  const riskAssets = findRiskAssets(portfolio);
  if (riskAssets.length === 0) return null;

  // Find risk asset with highest balance
  const fromHolding = riskAssets.reduce((best, h) => (h.valueUsd > best.valueUsd ? h : best));

  const trade = calculateTradeAmount(fromHolding, config);
  if (trade.amount === 0n) return null;

  // Get USDC address on same chain
  const toTokenAddress =
    TOKENS[fromHolding.chainId]?.USDC ?? '0x0000000000000000000000000000000000000000';

  return {
    fromChain: fromHolding.chainId,
    toChain: fromHolding.chainId,
    fromToken: fromHolding.token,
    fromTokenAddress: fromHolding.tokenAddress,
    toToken: 'USDC',
    toTokenAddress,
    amount: trade.amount,
    amountFormatted: trade.amountFormatted,
  };
}

/**
 * Select rebalance trade parameters
 */
function selectRebalanceTrade(
  portfolio: PortfolioHolding[],
  config: AgentConfig,
): ActionParams | null {
  const totalValue = portfolio.reduce((sum, h) => sum + h.valueUsd, 0);
  if (totalValue === 0) return null;

  // Find most overweight asset
  let maxOverweight = 0;
  let overweightHolding: PortfolioHolding | null = null;
  let targetToken = 'USDC';

  for (const holding of portfolio) {
    const targetPct = config.strategy.targetAllocations[holding.token] ?? 0;
    const currentPct = holding.valueUsd / totalValue;
    const overweight = currentPct - targetPct;

    if (overweight > maxOverweight) {
      maxOverweight = overweight;
      overweightHolding = holding;
    }
  }

  if (!overweightHolding) return null;

  // Find most underweight asset as target
  let maxUnderweight = 0;
  for (const [token, targetPct] of Object.entries(config.strategy.targetAllocations)) {
    const holdings = portfolio.filter(h => h.token === token);
    const currentValue = holdings.reduce((sum, h) => sum + h.valueUsd, 0);
    const currentPct = currentValue / totalValue;
    const underweight = targetPct - currentPct;

    if (underweight > maxUnderweight) {
      maxUnderweight = underweight;
      targetToken = token;
    }
  }

  const trade = calculateTradeAmount(overweightHolding, config, maxOverweight);
  if (trade.amount === 0n) return null;

  const toTokenAddress =
    TOKENS[overweightHolding.chainId]?.[targetToken] ??
    TOKENS[overweightHolding.chainId]?.USDC ??
    '0x0000000000000000000000000000000000000000';

  return {
    fromChain: overweightHolding.chainId,
    toChain: overweightHolding.chainId,
    fromToken: overweightHolding.token,
    fromTokenAddress: overweightHolding.tokenAddress,
    toToken: targetToken,
    toTokenAddress,
    amount: trade.amount,
    amountFormatted: trade.amountFormatted,
  };
}

/**
 * Select yield deposit parameters (for Composer workflow)
 */
function selectYieldDeposit(
  portfolio: PortfolioHolding[],
  config: AgentConfig,
): ActionParams | null {
  const stables = findStablecoins(portfolio);
  if (stables.length === 0) return null;

  // Find stable with highest balance on Base (for Morpho) or Arbitrum (for Aave)
  const baseStables = stables.filter(h => h.chainId === 8453);
  const arbStables = stables.filter(h => h.chainId === 42161);

  const targetStables = baseStables.length > 0 ? baseStables : arbStables;
  if (targetStables.length === 0) return null;

  const fromHolding = targetStables.reduce((best, h) => (h.valueUsd > best.valueUsd ? h : best));

  const trade = calculateTradeAmount(fromHolding, config, 0.8); // Deposit 80%
  if (trade.amount === 0n) return null;

  return {
    fromChain: fromHolding.chainId,
    toChain: fromHolding.chainId,
    fromToken: fromHolding.token,
    fromTokenAddress: fromHolding.tokenAddress,
    toToken: 'aUSDC', // Aave receipt token
    toTokenAddress: fromHolding.tokenAddress, // Will be resolved by Composer
    amount: trade.amount,
    amountFormatted: trade.amountFormatted,
    composerWorkflow: 'bridge-swap-deposit',
    yieldProtocol: fromHolding.chainId === 8453 ? 'morpho' : 'aave',
  };
}

/**
 * Main decision function
 * Analyzes monitor results and returns recommended action
 */
export function decide(monitorResult: MonitorResult, config: AgentConfig): Action | null {
  const { sentiment, portfolio } = monitorResult;

  // Check if we have any holdings to trade
  const totalValue = portfolio.reduce((sum, h) => sum + h.valueUsd, 0);
  if (totalValue < config.strategy.minTradeUsd) {
    return null; // Insufficient balance
  }

  // Strategy 1: Strong bullish sentiment
  if (sentiment.score >= config.strategy.bullishThreshold) {
    const params = selectBullishTrade(portfolio, config);
    if (params) {
      return {
        type: 'SWAP_BULLISH',
        params,
        reason: `Strong bullish sentiment (score: ${sentiment.score.toFixed(1)}) - swapping ${params.fromToken} to ${params.toToken}`,
        confidence: sentiment.confidence,
      };
    }
  }

  // Strategy 2: Strong bearish sentiment
  if (sentiment.score <= config.strategy.bearishThreshold) {
    const params = selectBearishTrade(portfolio, config);
    if (params) {
      return {
        type: 'SWAP_BEARISH',
        params,
        reason: `Strong bearish sentiment (score: ${sentiment.score.toFixed(1)}) - swapping ${params.fromToken} to ${params.toToken}`,
        confidence: sentiment.confidence,
      };
    }
  }

  // Strategy 3: Portfolio rebalancing
  const drift = calculatePortfolioDrift(portfolio, config.strategy.targetAllocations);
  if (drift > config.strategy.rebalanceThreshold) {
    const params = selectRebalanceTrade(portfolio, config);
    if (params) {
      return {
        type: 'REBALANCE',
        params,
        reason: `Portfolio drift ${(drift * 100).toFixed(1)}% exceeds threshold - rebalancing ${params.fromToken} to ${params.toToken}`,
        confidence: 0.9, // High confidence for mechanical rebalancing
      };
    }
  }

  // Strategy 4: Yield optimization (moderate sentiment)
  if (sentiment.score > 10 && sentiment.score < 40) {
    const idleStables = findStablecoins(portfolio);
    const stableValue = idleStables.reduce((sum, h) => sum + h.valueUsd, 0);

    if (stableValue > config.strategy.minTradeUsd * 2) {
      const params = selectYieldDeposit(portfolio, config);
      if (params) {
        return {
          type: 'DEPOSIT_YIELD',
          params,
          reason: `Moderate bullish sentiment - deploying idle ${params.fromToken} to ${params.yieldProtocol} yield`,
          confidence: 0.7,
        };
      }
    }
  }

  // No action needed
  return null;
}

/**
 * Get action type emoji
 */
export function getActionEmoji(actionType: ActionType): string {
  switch (actionType) {
    case 'SWAP_BULLISH':
      return '🚀';
    case 'SWAP_BEARISH':
      return '🛡️';
    case 'REBALANCE':
      return '⚖️';
    case 'DEPOSIT_YIELD':
      return '🌾';
    case 'WITHDRAW_YIELD':
      return '💰';
    case 'HOLD':
    default:
      return '⏸️';
  }
}

/**
 * Format action for logging
 */
export function formatAction(action: Action | null): string {
  if (!action) {
    return 'HOLD - No action needed';
  }

  const emoji = getActionEmoji(action.type);
  const { params } = action;

  return `${emoji} ${action.type}: ${params.amountFormatted} ${params.fromToken} → ${params.toToken} on ${CHAIN_NAMES[params.fromChain] ?? `Chain ${params.fromChain}`}`;
}
