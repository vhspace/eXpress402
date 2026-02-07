/**
 * Suifi - Sui Decision Recorder
 *
 * Main orchestrator for recording AI decisions on Sui vault investments
 */

// Re-exports
export * from './types.js';
export * from './config.js';
export * from './providers/defillama.js';
export * from './strategy.js';
export * from './tracker.js';
export * from './yellow/index.js';
export * from './auto-evaluator.js';

// Main imports
import { getTopVaultsByScore, formatNumber, formatApy, formatUsd } from './providers/defillama.js';
import { SuiVaultStrategy } from './strategy.js';
import { SuiDecisionTracker } from './tracker.js';
import { SuifiAutoEvaluator, type AutoEvaluatorConfig } from './auto-evaluator.js';
import type { VaultScore, StrategyConfig, TrackerConfig } from './types.js';

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

export class SuifiRecorder {
  private strategy: SuiVaultStrategy;
  private tracker: SuiDecisionTracker;
  private autoEvaluator: SuifiAutoEvaluator;

  constructor(
    strategyConfig?: Partial<StrategyConfig>,
    trackerConfig?: Partial<TrackerConfig>,
    autoEvalConfig?: Partial<AutoEvaluatorConfig>
  ) {
    this.strategy = new SuiVaultStrategy(strategyConfig);
    this.tracker = new SuiDecisionTracker(trackerConfig);
    this.autoEvaluator = new SuifiAutoEvaluator(this.tracker, autoEvalConfig);
  }

  /**
   * Run a complete decision cycle
   */
  async runCycle(options: {
    topN?: number;
    minTvlUsd?: number;
    record?: boolean;
  } = {}): Promise<void> {
    const {
      topN = 20,
      minTvlUsd = 1000000,
      record = true,
    } = options;

    console.log('🚀 Starting Suifi Decision Cycle...\n');

    // Step 1: Fetch data
    console.log('📡 Fetching yields from DefiLlama...');
    const vaults = await getTopVaultsByScore(topN, { minTvlUsd });
    console.log(`✅ Found ${vaults.length} vaults\n`);

    // Display top vaults
    this.displayTopVaults(vaults, 10);

    // Step 2: Make decision
    console.log('\n🤖 Analyzing and making decision...\n');
    const decision = await this.strategy.makeDecision(vaults);

    if (!decision) {
      console.log('⚠️ No decision made - no clear signal\n');
      return;
    }

    // Display decision
    this.displayDecision(decision);

    // Step 3: Record decision
    if (record) {
      console.log('\n📝 Recording decision...');
      const id = await this.tracker.recordDecision(decision);
      console.log(`✅ Decision recorded: ${id}\n`);
    }

    // Step 4: Show metrics
    this.displayMetrics();
  }

  /**
   * Display top vaults
   */
  private displayTopVaults(vaults: VaultScore[], limit: number): void {
    console.log('🏆 Top Vaults by Score:\n');
    console.log(
      '  Rank  Project              Pool                APY      TVL        Score   Conf.'
    );
    console.log(
      '  ───── ──────────────────── ─────────────────── ──────── ───────── ─────── ──────'
    );

    for (let i = 0; i < Math.min(limit, vaults.length); i++) {
      const v = vaults[i];
      const project = v.vault.project.padEnd(21);
      const pool = (v.vault.pool.length > 18
        ? v.vault.pool.substring(0, 15) + '...'
        : v.vault.pool
      ).padEnd(20);
      const apy = formatApy(v.vault.apy).padStart(7);
      const tvl = formatUsd(v.vault.tvlUsd).padStart(8);
      const score = v.score.toFixed(1).padStart(6);
      const conf = `${(v.confidence * 100).toFixed(0)}%`.padStart(5);

      console.log(
        `  ${String(i + 1).padStart(4)}  ${project} ${pool} ${apy} ${tvl} ${score} ${conf}`
      );
    }
  }

  /**
   * Display a decision
   */
  private displayDecision(decision: any): void {
    console.log('📊 Decision:\n');
    console.log(`  Action:      ${decision.action.toUpperCase()}`);
    console.log(`  Project:     ${decision.project}`);
    console.log(`  Pool:        ${decision.pool}`);
    console.log(`  Symbol:      ${decision.symbol}`);
    console.log(`  APY:         ${formatApy(decision.apyAtDecision)}`);
    console.log(`  TVL:         ${formatUsd(decision.tvlAtDecision)}`);
    console.log(`  Confidence:  ${(decision.confidence * 100).toFixed(0)}%`);
    console.log(`  Risk:        ${decision.riskLevel.toUpperCase()}`);
    console.log(`  Score:       ${decision.score.toFixed(1)}`);
    console.log(`  Reason:      ${decision.reason}`);
  }

  /**
   * Display metrics
   */
  private displayMetrics(): void {
    const metrics = this.tracker.getMetrics();

    console.log('\n📈 All-Time Metrics:\n');
    console.log(`  Total Decisions:      ${metrics.totalDecisions}`);
    console.log(`  Evaluated:            ${metrics.evaluatedDecisions}`);
    console.log(`  Pending:              ${metrics.pendingEvaluation}`);
    console.log(`  Correct:              ${metrics.correctDecisions}`);
    console.log(`  Incorrect:            ${metrics.incorrectDecisions}`);
    console.log(`  Accuracy:             ${(metrics.overallAccuracy * 100).toFixed(1)}%`);
    console.log(`  Avg Confidence:       ${(metrics.avgConfidence * 100).toFixed(1)}%`);
    console.log(`  Avg APY:              ${formatApy(metrics.avgApy)}`);

    // Best project
    if (metrics.bestPerformingProject) {
      console.log(
        `\n  Best Project:\n    ${metrics.bestPerformingProject.name} (${(metrics.bestPerformingProject.accuracy * 100).toFixed(1)}% accuracy, ${metrics.bestPerformingProject.totalDecisions} decisions)`
      );
    }

    // By action
    console.log('\n  By Action:');
    for (const [action, data] of Object.entries(metrics.byAction)) {
      console.log(
        `    ${action.padEnd(8)}: ${data.total} total, ${(data.accuracy * 100).toFixed(1)}% accuracy, ${formatApy(data.avgApy)} avg APY`
      );
    }
  }

  /**
   * Start auto-evaluator cron job
   */
  startAutoEvaluator(): void {
    this.autoEvaluator.start();
  }

  /**
   * Stop auto-evaluator cron job
   */
  stopAutoEvaluator(): void {
    this.autoEvaluator.stop();
  }

  /**
   * Evaluate pending decisions (manual trigger)
   */
  async evaluatePending(): Promise<number> {
    return await this.autoEvaluator.evaluatePending();
  }

  /**
   * Get auto-evaluator stats
   */
  getAutoEvalStats() {
    return this.autoEvaluator.getStats();
  }

  /**
   * Get tracker instance
   */
  getTracker(): SuiDecisionTracker {
    return this.tracker;
  }

  /**
   * Get strategy instance
   */
  getStrategy(): SuiVaultStrategy {
    return this.strategy;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createSuifiRecorder(
  strategyConfig?: Partial<StrategyConfig>,
  trackerConfig?: Partial<TrackerConfig>,
  autoEvalConfig?: Partial<AutoEvaluatorConfig>
): SuifiRecorder {
  return new SuifiRecorder(strategyConfig, trackerConfig, autoEvalConfig);
}
