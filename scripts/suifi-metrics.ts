#!/usr/bin/env tsx
/**
 * Suifi Metrics Script
 *
 * Display all recorded decisions and metrics
 */

import { createSuifiRecorder } from '../src/suifi/index.js';

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                 🔮 SUIFI DECISION METRICS                      ║');
  console.log('║           View All Recorded Decisions & Stats                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Create recorder
    const recorder = createSuifiRecorder(undefined, {
      dbPath: './data/suifi-decisions.json',
    });

    const tracker = recorder.getTracker();
    const metrics = tracker.getMetrics();

    // Overall stats
    console.log('📊 Overall Statistics:\n');
    console.log(`  Total Decisions:      ${metrics.totalDecisions}`);
    console.log(`  Evaluated:            ${metrics.evaluatedDecisions}`);
    console.log(`  Pending Evaluation:   ${metrics.pendingEvaluation}`);
    console.log(`  Correct:              ${metrics.correctDecisions}`);
    console.log(`  Incorrect:            ${metrics.incorrectDecisions}`);
    console.log(`  Overall Accuracy:     ${(metrics.overallAccuracy * 100).toFixed(1)}%`);
    console.log(`  Avg Confidence:       ${(metrics.avgConfidence * 100).toFixed(1)}%`);
    console.log(`  Avg APY:              ${metrics.avgApy.toFixed(2)}%`);
    console.log(`  Last Updated:         ${metrics.lastUpdated.toLocaleString()}`);

    // Best project
    if (metrics.bestPerformingProject) {
      console.log('\n🏆 Best Performing Project:\n');
      console.log(`  Name:         ${metrics.bestPerformingProject.name}`);
      console.log(`  Accuracy:     ${(metrics.bestPerformingProject.accuracy * 100).toFixed(1)}%`);
      console.log(`  Decisions:    ${metrics.bestPerformingProject.totalDecisions}`);
    }

    // By action
    console.log('\n📋 Metrics by Action:\n');
    console.log('  Action    Total  Correct  Accuracy  Avg APY    Avg Conf');
    console.log('  ────────  ─────  ───────  ────────  ─────────  ─────────');
    for (const [action, data] of Object.entries(metrics.byAction)) {
      if (data.total > 0) {
        const actionStr = action.padEnd(8);
        const totalStr = String(data.total).padStart(6);
        const correctStr = String(data.correct).padStart(7);
        const accStr = `${(data.accuracy * 100).toFixed(1)}%`.padStart(8);
        const apyStr = `${data.avgApy.toFixed(1)}%`.padStart(9);
        const confStr = `${(data.avgConfidence * 100).toFixed(0)}%`.padStart(9);
        console.log(`  ${actionStr} ${totalStr} ${correctStr} ${accStr} ${apyStr} ${confStr}`);
      }
    }

    // By project
    console.log('\n🏢 Metrics by Project:\n');
    const projects = Object.entries(metrics.byProject)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10);

    console.log('  Project              Total  Correct  Accuracy  Best Act   Avg APY');
    console.log('  ────────────────────  ─────  ───────  ────────  ─────────  ────────');
    for (const [project, data] of projects) {
      const name = project.length > 20 ? project.substring(0, 17) + '...' : project;
      const nameStr = name.padEnd(21);
      const totalStr = String(data.total).padStart(6);
      const correctStr = String(data.correct).padStart(7);
      const accStr = `${(data.accuracy * 100).toFixed(1)}%`.padStart(8);
      const actionStr = data.bestAction.padStart(9);
      const apyStr = `${data.avgApy.toFixed(1)}%`.padStart(8);
      console.log(`  ${nameStr} ${totalStr} ${correctStr} ${accStr} ${actionStr} ${apyStr}`);
    }

    // Recent decisions
    const recent = tracker.getRecentDecisions(20);
    if (recent.length > 0) {
      console.log('\n📜 Recent Decisions:\n');
      console.log('  Time        Action    Project             Pool                        APY      Status');
      console.log('  ──────────── ───────── ─────────────────── ─────────────────────────── ──────── ───────');

      for (const record of recent) {
        const d = record.decision;
        const time = d.timestamp.toLocaleTimeString();
        const timeStr = time.padEnd(12);
        const actionStr = d.action.toUpperCase().padEnd(8);
        const projectStr = (d.project.length > 18
          ? d.project.substring(0, 15) + '...'
          : d.project
        ).padEnd(20);
        const poolStr = (d.pool.length > 26
          ? d.pool.substring(0, 23) + '...'
          : d.pool
        ).padEnd(28);
        const apyStr = `${d.apyAtDecision.toFixed(1)}%`.padEnd(7);
        const status = d.evaluated
          ? `[${d.outcome?.toUpperCase()}]`
          : '[PENDING]';

        console.log(
          `  ${timeStr} ${actionStr} ${projectStr} ${poolStr} ${apyStr} ${status}`
        );
      }
    }

    console.log('\n✅ Done!\n');

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
