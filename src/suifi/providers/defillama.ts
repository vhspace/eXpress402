/**
 * Suifi - DefiLlama Yields Provider
 *
 * Fetches yield data from DefiLlama API for Sui chain
 */

import type { DefiLlamaVault, VaultScore, ScoreFactors } from '../types.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFILLAMA_YIELDS_API = 'https://yields.llama.fi/pools';
const CHAIN_FILTER = 'Sui';

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Fetch all Sui chain yields from DefiLlama
 */
export async function fetchSuiYields(): Promise<DefiLlamaVault[]> {
  try {
    const response = await fetch(DEFILLAMA_YIELDS_API);
    if (!response.ok) {
      throw new Error(`DefiLlama API error: ${response.status}`);
    }

    const data = await response.json();

    // Filter hanya Sui chain
    const suiVaults = data.data
      .filter((pool: any) => pool.chain.toLowerCase() === CHAIN_FILTER.toLowerCase())
      .map((pool: any) => mapToVault(pool));

    return suiVaults;
  } catch (error) {
    console.error('❌ Error fetching from DefiLlama:', error);
    throw error;
  }
}

/**
 * Get top vaults by score
 */
export async function getTopVaultsByScore(
  limit: number = 20,
  config: { minTvlUsd?: number } = {},
): Promise<VaultScore[]> {
  const vaults = await fetchSuiYields();

  // Filter by minimum TVL if specified
  let filteredVaults = vaults;
  if (config.minTvlUsd) {
    filteredVaults = vaults.filter(v => v.tvlUsd >= config.minTvlUsd!);
  }

  // Calculate scores
  const scored = filteredVaults.map(vault => ({
    vault,
    score: calculateVaultScore(vault),
    confidence: calculateConfidence(vault),
    factors: calculateScoreFactors(vault),
    rank: 0, // Will be set after sorting
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Set ranks
  scored.forEach((item, index) => {
    item.rank = index + 1;
  });

  // Return top N
  return scored.slice(0, Math.min(limit, scored.length));
}

/**
 * Get vaults by project name
 */
export async function getVaultsByProject(projectName: string): Promise<DefiLlamaVault[]> {
  const vaults = await fetchSuiYields();
  return vaults.filter(v => v.project.toLowerCase().includes(projectName.toLowerCase()));
}

/**
 * Find a specific vault by project and pool name
 */
export async function findVault(project: string, pool: string): Promise<DefiLlamaVault | null> {
  const vaults = await fetchSuiYields();
  return vaults.find(v => v.project === project && v.pool === pool) || null;
}

// ============================================================================
// SCORE CALCULATION
// ============================================================================

/**
 * Calculate overall vault score
 */
export function calculateVaultScore(vault: DefiLlamaVault): number {
  const factors = calculateScoreFactors(vault);
  return factors.apyScore + factors.tvlScore + factors.safetyBonus;
}

/**
 * Calculate individual score factors
 */
export function calculateScoreFactors(vault: DefiLlamaVault): ScoreFactors {
  const apyScore = vault.apy * 2;
  const tvlScore = calculateTvlScore(vault.tvlUsd);
  const safetyBonus = vault.stablecoin ? 10 : 0;

  return {
    apyScore,
    tvlScore,
    safetyBonus,
  };
}

/**
 * Calculate TVL score (logarithmic scale)
 */
function calculateTvlScore(tvlUsd: number): number {
  if (tvlUsd < 100000) return 0; // < $100K
  if (tvlUsd < 1000000) return 5; // $100K - $1M
  if (tvlUsd < 10000000) return 10; // $1M - $10M
  if (tvlUsd < 50000000) return 15; // $10M - $50M
  return 20; // > $50M
}

/**
 * Calculate confidence level for a vault
 */
export function calculateConfidence(vault: DefiLlamaVault): number {
  let confidence = 0.5; // Base confidence

  // TVL higher = higher confidence
  if (vault.tvlUsd > 10000000) confidence += 0.2;
  else if (vault.tvlUsd > 1000000) confidence += 0.1;
  else if (vault.tvlUsd < 100000) confidence -= 0.2;

  // Stablecoin is safer
  if (vault.stablecoin) confidence += 0.1;

  // Very high APY might be suspicious (lower confidence)
  if (vault.apy > 100) confidence -= 0.3;
  else if (vault.apy > 50) confidence -= 0.2;
  else if (vault.apy > 30) confidence -= 0.1;

  // Base APY only is more stable than rewards
  if (vault.apyBase > 0 && vault.apyReward === 0) confidence += 0.05;

  return Math.min(1, Math.max(0, confidence));
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Map DefiLlama API response to our type
 */
function mapToVault(pool: any): DefiLlamaVault {
  return {
    project: pool.project || 'Unknown',
    chain: pool.chain || 'Unknown',
    symbol: pool.symbol || 'Unknown',
    tvlUsd: pool.tvlUsd || 0,
    apy: pool.apy || 0,
    apyBase: pool.apyBase || 0,
    apyReward: pool.apyReward || 0,
    pool: pool.pool || pool.name || 'Unknown',
    stablecoin: pool.stablecoin || false,
  };
}

/**
 * Format number for display
 */
export function formatNumber(num: number): string {
  if (num >= 1000000000) return `${(num / 1000000000).toFixed(2)}B`;
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toFixed(2);
}

/**
 * Format APY for display
 */
export function formatApy(apy: number): string {
  return `${apy.toFixed(2)}%`;
}

/**
 * Format USD amount
 */
export function formatUsd(amount: number): string {
  return `$${formatNumber(amount)}`;
}
