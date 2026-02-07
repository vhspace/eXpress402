/**
 * Suifi - Vault Decision Strategy
 *
 * Makes deposit/withdraw decisions based on vault scores and metrics
 */

import type {
  VaultScore,
  SuiVaultDecision,
  DecisionAction,
  RiskLevel,
  StrategyConfig,
  DefiLlamaVault,
} from './types.js';
import { DEFAULT_STRATEGY_CONFIG } from './types.js';

// ============================================================================
// STRATEGY CLASS
// ============================================================================

export class SuiVaultStrategy {
  private config: StrategyConfig;

  constructor(config?: Partial<StrategyConfig>) {
    this.config = { ...DEFAULT_STRATEGY_CONFIG, ...config };
  }

  /**
   * Make a decision based on scored vaults
   */
  async makeDecision(vaults: VaultScore[]): Promise<SuiVaultDecision | null> {
    if (vaults.length === 0) {
      console.log('⚠️ No vaults available for decision');
      return null;
    }

    const topVault = vaults[0];
    const { vault, score, confidence, factors } = topVault;

    // Decision logic
    const decision = this.evaluateVault(vault, score, confidence, factors);

    if (!decision) {
      return null;
    }

    return {
      id: `suifi-decision-${Date.now()}`,
      timestamp: new Date(),
      ...decision,
      score,
    };
  }

  /**
   * Evaluate a single vault and determine action
   */
  private evaluateVault(
    vault: DefiLlamaVault,
    score: number,
    confidence: number,
    factors: any
  ): Omit<SuiVaultDecision, 'id' | 'timestamp' | 'score'> | null {
    const action = this.determineAction(vault, score);
    const riskLevel = this.assessRisk(vault);
    const reason = this.buildReason(vault, action, score, factors);

    return {
      action,
      project: vault.project,
      pool: vault.pool,
      symbol: vault.symbol,
      apyAtDecision: vault.apy,
      tvlAtDecision: vault.tvlUsd,
      confidence,
      reason,
      expectedApy: vault.apy,
      riskLevel,
      evaluated: false,
    };
  }

  /**
   * Determine action based on vault metrics
   */
  private determineAction(
    vault: DefiLlamaVault,
    score: number
  ): DecisionAction {
    const { minApyForDeposit, minTvlUsd, maxApyForWithdraw } = this.config;

    // DEPOSIT conditions
    if (
      vault.apy >= minApyForDeposit &&
      vault.tvlUsd >= minTvlUsd &&
      score >= 30
    ) {
      return 'deposit';
    }

    // WITHDRAW conditions
    if (vault.apy <= maxApyForWithdraw) {
      return 'withdraw';
    }

    // Default: HOLD
    return 'hold';
  }

  /**
   * Assess risk level based on vault characteristics
   */
  private assessRisk(vault: DefiLlamaVault): RiskLevel {
    // Low risk conditions
    if (
      vault.stablecoin &&
      vault.tvlUsd > 10000000 &&
      vault.apy < 20
    ) {
      return 'low';
    }

    // High risk conditions
    if (
      vault.apy > this.config.highApyThreshold ||
      vault.tvlUsd < 500000
    ) {
      return 'high';
    }

    // Medium risk (default)
    return 'medium';
  }

  /**
   * Build human-readable reason string
   */
  private buildReason(
    vault: DefiLlamaVault,
    action: DecisionAction,
    score: number,
    factors: any
  ): string {
    const apyStr = vault.apy.toFixed(1);
    const tvlStr = `$${this.formatNumber(vault.tvlUsd)}`;

    switch (action) {
      case 'deposit':
        return `High APY (${apyStr}%) with solid TVL (${tvlStr}) and score (${score.toFixed(1)})`;

      case 'withdraw':
        return `Low APY (${apyStr}%) - better opportunities elsewhere`;

      case 'hold':
        return `Moderate metrics - APY: ${apyStr}%, TVL: ${tvlStr}%, Score: ${score.toFixed(1)}`;

      default:
        return 'No clear signal';
    }
  }

  /**
   * Format number for display
   */
  private formatNumber(num: number): string {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<StrategyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): StrategyConfig {
    return { ...this.config };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createStrategy(config?: Partial<StrategyConfig>): SuiVaultStrategy {
  return new SuiVaultStrategy(config);
}
