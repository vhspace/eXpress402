#!/usr/bin/env tsx
/**
 * Suifi Demo Script
 *
 * Run this to see the Sui Decision Recorder in action
 */

import { createSuifiRecorder } from '../src/suifi/index.js';

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    🔮 SUIFI DECISION RECORDER                  ║');
  console.log('║                   Sui Vault AI Decision Tracker                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Create recorder
    const recorder = createSuifiRecorder(
      {
        // Strategy config
        minApyForDeposit: 10, // Lower threshold for demo
        minTvlUsd: 100000,    // Lower TVL requirement
        maxApyForWithdraw: 3,
      },
      {
        // Tracker config
        dbPath: './data/suifi-decisions.json',
      }
    );

    // Run decision cycle
    await recorder.runCycle({
      topN: 20,
      minTvlUsd: 100000,
      record: true,
    });

    console.log('\n✅ Cycle complete!\n');

    // Optional: Show recent decisions
    const tracker = recorder.getTracker();
    const recent = tracker.getRecentDecisions(5);
    if (recent.length > 0) {
      console.log('📜 Recent Decisions:\n');
      for (const record of recent) {
        const d = record.decision;
        const time = d.timestamp.toLocaleTimeString();
        const evalStatus = d.evaluated
          ? `[${d.outcome?.toUpperCase()}]`
          : '[PENDING]';
        console.log(
          `  ${time} ${evalStatus} ${d.action.toUpperCase()} ${d.project} - ${d.apyAtDecision.toFixed(1)}% APY`
        );
      }
      console.log('');
    }

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

// Run
main();
