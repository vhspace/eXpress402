#!/usr/bin/env tsx
/**
 * Suifi Evaluation Script
 *
 * Run this to evaluate pending decisions
 */

import { createSuifiRecorder } from '../src/suifi/index.js';

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              🔮 SUIFI DECISION EVALUATOR                       ║');
  console.log('║           Evaluate Pending Vault Decisions                    ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Create recorder
    const recorder = createSuifiRecorder(
      undefined,
      {
        dbPath: './data/suifi-decisions.json',
      }
    );

    // Evaluate pending decisions
    await recorder.evaluatePending();

    // Show updated metrics
    const tracker = recorder.getTracker();
    const metrics = tracker.getMetrics();

    console.log('\n📈 Updated Metrics:\n');
    console.log(`  Total Decisions:      ${metrics.totalDecisions}`);
    console.log(`  Evaluated:            ${metrics.evaluatedDecisions}`);
    console.log(`  Pending:              ${metrics.pendingEvaluation}`);
    console.log(`  Accuracy:             ${(metrics.overallAccuracy * 100).toFixed(1)}%`);

    if (metrics.bestPerformingProject) {
      console.log(
        `\n  Best Project:\n    ${metrics.bestPerformingProject.name} (${(metrics.bestPerformingProject.accuracy * 100).toFixed(1)}% accuracy)`
      );
    }

    console.log('\n✅ Evaluation complete!\n');

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
