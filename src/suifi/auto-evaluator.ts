/**
 * Suifi - Auto Evaluator
 *
 * Automatically evaluates decisions after specified time horizons.
 * Based on Sentifi's evaluation logic.
 */

import cron from 'node-cron';
import type { SuiVaultDecision, SuiDecisionRecord, DecisionEvaluation } from './types.js';
import type { SuiDecisionTracker } from './tracker.js';
import { findVault } from './providers/defillama.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface AutoEvaluatorConfig {
  /** Evaluation windows in days */
  evaluationDays: number[];
  /** Cron schedule for auto-evaluation (default: every hour) */
  cronSchedule?: string;
  /** Enable auto-evaluation on start */
  enabled?: boolean;
}

const DEFAULT_CONFIG: AutoEvaluatorConfig = {
  evaluationDays: [1, 7, 30], // 1 day, 7 days, 30 days
  cronSchedule: '0 * * * *', // Every hour at minute 0
  enabled: true,
};

// ============================================================================
// AUTO EVALUATOR
// ============================================================================

export class SuifiAutoEvaluator {
  private config: AutoEvaluatorConfig;
  private tracker: SuiDecisionTracker;
  private cronJob: ReturnType<typeof cron.schedule> | null = null;

  constructor(tracker: SuiDecisionTracker, config?: Partial<AutoEvaluatorConfig>) {
    this.tracker = tracker;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start auto-evaluation cron job
   */
  start(): void {
    if (!this.config.enabled) {
      console.log('⚠️ Auto-evaluation disabled');
      return;
    }

    if (this.cronJob) {
      console.log('⚠️ Auto-evaluator already running');
      return;
    }

    console.log(`🕐 Starting auto-evaluator (schedule: ${this.config.cronSchedule})`);

    // Schedule evaluation every hour
    this.cronJob = cron.schedule(this.config.cronSchedule!, () => {
      void (async () => {
        try {
          await this.evaluatePending();
        } catch (error) {
          console.error('Auto-evaluation error:', error);
        }
      })();
    });

    console.log('✅ Auto-evaluator started');
  }

  /**
   * Stop auto-evaluation cron job
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log('🛑 Auto-evaluator stopped');
    }
  }

  /**
   * Evaluate all pending decisions
   */
  async evaluatePending(): Promise<number> {
    const allDecisions = this.tracker.getAllDecisions();
    const pending = allDecisions.filter(d => !d.decision.evaluated);

    if (pending.length === 0) {
      return 0;
    }

    console.log(`🔍 Evaluating ${pending.length} pending decisions...`);

    let evaluatedCount = 0;
    const now = Date.now();

    for (const record of pending) {
      const decision = record.decision;

      // Check each evaluation horizon
      for (const horizonDays of this.config.evaluationDays) {
        // Check if this horizon should be evaluated
        const horizonKey = `eval_${horizonDays}d`;

        if (decision[horizonKey as keyof SuiVaultDecision]) {
          continue; // Already evaluated for this horizon
        }

        // Calculate time elapsed
        const daysSince = (now - decision.timestamp.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSince >= horizonDays) {
          // Evaluate for this horizon
          const evaluation = await this.evaluateDecision(record, horizonDays);

          // Store evaluation
          if (evaluation) {
            record.evaluations ??= [];
            record.evaluations.push(evaluation);

            // Mark as evaluated for this horizon
            (decision as any)[horizonKey] = true;

            evaluatedCount++;
          }

          break; // Only evaluate one horizon per run
        }
      }
    }

    if (evaluatedCount > 0) {
      console.log(`✅ Evaluated ${evaluatedCount} decision(s)`);
    }

    return evaluatedCount;
  }

  /**
   * Evaluate a single decision for a specific horizon
   */
  private async evaluateDecision(
    record: SuiDecisionRecord,
    horizonDays: number,
  ): Promise<DecisionEvaluation | null> {
    const decision = record.decision;
    const now = Date.now();

    console.log(`   📊 Evaluating ${decision.id.slice(0, 20)}... (${horizonDays}d horizon)`);

    try {
      // Fetch current vault data from DefiLlama
      const currentVault = await findVault(decision.project, decision.pool);

      if (!currentVault) {
        console.log('      ⚠️  Vault no longer exists');
        return null;
      }

      // Calculate changes
      const apyChange = currentVault.apy - decision.apyAtDecision;
      const tvlChange = currentVault.tvlUsd - decision.tvlAtDecision;

      // Determine outcome based on action
      let outcome: 'correct' | 'incorrect' | 'neutral';
      let pnlPercent = 0;

      if (decision.action === 'deposit') {
        // Deposit was correct if APY stayed stable or increased
        if (apyChange >= -5) {
          outcome = 'correct';
          pnlPercent = apyChange; // Earned the APY
        } else {
          outcome = 'incorrect';
          pnlPercent = apyChange; // Lost from APY drop
        }
      } else if (decision.action === 'withdraw') {
        // Withdraw was correct if APY decreased
        if (apyChange < 0) {
          outcome = 'correct';
          pnlPercent = -apyChange; // Avoided loss = profit
        } else {
          outcome = 'incorrect';
          pnlPercent = -apyChange; // Missed out on gains
        }
      } else {
        // Hold is always neutral
        outcome = 'neutral';
        pnlPercent = 0;
      }

      const evaluation: DecisionEvaluation = {
        decisionId: decision.id,
        horizonDays,
        actualApy: currentVault.apy,
        actualTvl: currentVault.tvlUsd,
        apyChange,
        tvlChange,
        outcome,
        pnlPercent,
        evaluatedAt: new Date(),
      };

      // Log result
      const changeStr = apyChange > 0 ? `+${apyChange.toFixed(2)}%` : `${apyChange.toFixed(2)}%`;
      const tvlChangeStr =
        tvlChange > 0
          ? `+$${this.formatNumber(tvlChange)}`
          : `$${this.formatNumber(Math.abs(tvlChange))}`;

      console.log(`      ${outcome.toUpperCase()}: APY ${changeStr}, TVL ${tvlChangeStr}`);

      // Update decision
      decision.evaluated = true;
      decision.evaluatedAt = new Date();
      decision.actualApy = currentVault.apy;
      decision.actualTvl = currentVault.tvlUsd;
      decision.apyChange = apyChange;
      decision.tvlChange = tvlChange;
      decision.outcome = outcome;

      return evaluation;
    } catch (error) {
      console.error(`      ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Format number for display
   */
  private formatNumber(num: number): string {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toFixed(2);
  }

  /**
   * Get evaluation statistics
   */
  getStats(): {
    totalDecisions: number;
    evaluatedDecisions: number;
    pendingDecisions: number;
    evaluationCount: number;
    byHorizon: Record<number, number>;
  } {
    const allDecisions = this.tracker.getAllDecisions();
    const evaluated = allDecisions.filter(d => d.decision.evaluated);
    const pending = allDecisions.filter(d => !d.decision.evaluated);

    // Count evaluations by horizon
    const byHorizon: Record<number, number> = {};
    for (const horizonDays of this.config.evaluationDays) {
      byHorizon[horizonDays] = 0;
    }

    let evaluationCount = 0;
    for (const record of allDecisions) {
      if (record.evaluations) {
        evaluationCount += record.evaluations.length;
        for (const evaluation of record.evaluations) {
          byHorizon[evaluation.horizonDays]++;
        }
      }
    }

    return {
      totalDecisions: allDecisions.length,
      evaluatedDecisions: evaluated.length,
      pendingDecisions: pending.length,
      evaluationCount,
      byHorizon,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AutoEvaluatorConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart cron job if schedule changed
    if (config.cronSchedule && this.cronJob) {
      this.stop();
      this.start();
    }
  }

  /**
   * Get configuration
   */
  getConfig(): AutoEvaluatorConfig {
    return { ...this.config };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createAutoEvaluator(
  tracker: SuiDecisionTracker,
  config?: Partial<AutoEvaluatorConfig>,
): SuifiAutoEvaluator {
  return new SuifiAutoEvaluator(tracker, config);
}
