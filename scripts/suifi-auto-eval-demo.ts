#!/usr/bin/env tsx
/**
 * Suifi Auto-Evaluator Demo
 *
 * Demonstrates the auto-evaluation feature:
 * 1. Create sample decisions (some old enough to evaluate)
 * 2. Run auto-evaluation
 * 3. Display results
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ override: true });

import chalk from 'chalk';
import { createSuifiRecorder } from '../src/suifi/index.js';
import type { SuiVaultDecision } from '../src/suifi/types.js';

// ============================================================================
// DEMO DATA
// ============================================================================

function createMockDecision(daysAgo: number, apy: number, action: 'deposit' | 'withdraw' | 'hold'): SuiVaultDecision {
  const timestamp = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

  return {
    id: `mock-decision-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp,
    action,
    project: 'Turbos Finance',
    pool: 'SUI-USDC LP',
    symbol: 'SUI',
    apyAtDecision: apy,
    tvlAtDecision: 5000000,
    confidence: 0.8,
    reason: 'Test decision for auto-evaluation',
    expectedApy: apy,
    riskLevel: 'medium',
    score: 75,
    evaluated: false,
  };
}

// ============================================================================
// MAIN DEMO
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              🔮 SUIFI AUTO-EVALUATOR DEMO                        ║');
  console.log('║           Track Decision Accuracy Over Time                     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Create recorder with auto-evaluator disabled (manual mode)
  const recorder = createSuifiRecorder(
    undefined,
    undefined,
    { enabled: false } // Disable auto cron for demo
  );

  const tracker = recorder.getTracker();

  console.log('📊 Step 1: Creating sample decisions...\n');

  // Create decisions at different time horizons
  const decisions: SuiVaultDecision[] = [
    // 2 days ago - should be evaluated for 1d horizon
    createMockDecision(2, 15.5, 'deposit'),
    // 8 days ago - should be evaluated for 1d and 7d horizons
    createMockDecision(8, 18.2, 'deposit'),
    // 35 days ago - should be evaluated for all horizons (1d, 7d, 30d)
    createMockDecision(35, 12.8, 'withdraw'),
    // 12 hours ago - too new, should not be evaluated
    createMockDecision(0.5, 20.1, 'deposit'),
  ];

  // Record decisions
  for (const decision of decisions) {
    const id = await tracker.recordDecision(decision);
    const daysAgo = decision.timestamp.toISOString().slice(0, 10);
    const action = decision.action.toUpperCase().padEnd(8);
    const apy = decision.apyAtDecision.toFixed(1) + '%';

    console.log(`   ✅ ${action} at ${apy} APY (${daysAgo}) → ${id.slice(0, 12)}...`);
  }

  console.log(`\n   Recorded ${decisions.length} decisions\n`);

  // Show stats before evaluation
  console.log('📈 Step 2: Initial state...\n');
  const statsBefore = recorder.getAutoEvalStats();
  displayEvalStats(statsBefore);

  // Run auto-evaluation
  console.log('\n🔍 Step 3: Running auto-evaluation...\n');

  try {
    const evaluatedCount = await recorder.evaluatePending();

    if (evaluatedCount === 0) {
      console.log(chalk.yellow('   ⚠️  No decisions were ready for evaluation'));
      console.log(chalk.yellow('   This is expected if DefiLlama has no matching vault data\n'));
    } else {
      console.log(chalk.green(`   ✅ Evaluated ${evaluatedCount} decision(s)\n`));
    }
  } catch (error) {
    console.log(chalk.red(`   ❌ Error during evaluation: ${error}\n`));
  }

  // Show stats after evaluation
  console.log('📊 Step 4: State after evaluation...\n');
  const statsAfter = recorder.getAutoEvalStats();
  displayEvalStats(statsAfter);

  // Show detailed results
  console.log('\n📋 Step 5: Detailed results...\n');
  const allDecisions = tracker.getAllDecisions();

  if (allDecisions.length === 0) {
    console.log(chalk.dim('   No decisions found\n'));
  } else {
    for (const record of allDecisions) {
      const d = record.decision;
      const daysSince = ((Date.now() - d.timestamp.getTime()) / (1000 * 60 * 60 * 24)).toFixed(1);

      console.log(`   Decision: ${d.id.slice(0, 12)}...`);
      console.log(`   Action:    ${d.action.toUpperCase()}`);
      console.log(`   Age:       ${daysSince} days`);
      console.log(`   APY then:  ${d.apyAtDecision.toFixed(1)}%`);

      if (d.evaluated) {
        const outcomeColor = d.outcome === 'correct' ? chalk.green :
                            d.outcome === 'incorrect' ? chalk.red : chalk.gray;
        console.log(`   APY now:   ${d.actualApy?.toFixed(1) || 'N/A'}%`);
        console.log(`   Change:    ${d.apyChange?.toFixed(1) || 'N/A'}%`);
        console.log(outcomeColor(`   Outcome:   ${d.outcome?.toUpperCase()}`));
        console.log(`   Evaluated: ${d.evaluatedAt?.toISOString().slice(0, 19) || 'N/A'}`);

        if (record.evaluations && record.evaluations.length > 0) {
          console.log(`   Horizons:  ${record.evaluations.map(e => `${e.horizonDays}d`).join(', ')}`);
        }
      } else {
        console.log(chalk.dim(`   Status:    Pending evaluation`));
      }

      console.log();
    }
  }

  // Show overall metrics
  console.log('📈 Step 6: Overall metrics...\n');
  const metrics = tracker.getMetrics();

  console.log('   Total Decisions:      ' + metrics.totalDecisions);
  console.log('   Evaluated:            ' + metrics.evaluatedDecisions);
  console.log('   Pending:              ' + metrics.pendingEvaluation);
  console.log('   Correct:              ' + metrics.correctDecisions);
  console.log('   Incorrect:            ' + metrics.incorrectDecisions);
  console.log('   Accuracy:             ' + (metrics.overallAccuracy * 100).toFixed(1) + '%');
  console.log();

  console.log(chalk.green('\n✅ Demo complete!\n'));
  console.log(chalk.dim('Note: In production, the auto-evaluator runs on a schedule'));
  console.log(chalk.dim('      (default: every hour) and evaluates decisions when they'));
  console.log(chalk.dim('      reach their time horizons (1d, 7d, 30d).\n'));
}

// ============================================================================
// DISPLAY HELPERS
// ============================================================================

function displayEvalStats(stats: {
  totalDecisions: number;
  evaluatedDecisions: number;
  pendingDecisions: number;
  evaluationCount: number;
  byHorizon: Record<number, number>;
}): void {
  console.log('   Total Decisions:      ' + stats.totalDecisions);
  console.log('   Evaluated:            ' + stats.evaluatedDecisions);
  console.log('   Pending:              ' + stats.pendingDecisions);
  console.log('   Evaluation Count:     ' + stats.evaluationCount);
  console.log('   By Horizon:');
  for (const [horizon, count] of Object.entries(stats.byHorizon)) {
    console.log(`     ${horizon}d:               ${count} evaluations`);
  }
  console.log();
}

// ============================================================================
// RUN
// ============================================================================

main().catch((error) => {
  console.error('\n❌ Error:', error);
  process.exit(1);
});
