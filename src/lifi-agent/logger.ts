/**
 * Sentifi Agent - Rich CLI Logger
 * Colorful logging for demo purposes
 */

import chalk from 'chalk';
import type {
  MonitorResult,
  Action,
  ExecutionResult,
  AgentState,
  PortfolioHolding,
} from './types.js';
import { CHAIN_NAMES } from './types.js';
import { getSentimentLabel, getSentimentEmoji } from './sentiment.js';
import { getActionEmoji } from './decide.js';

/**
 * Print a section header
 */
function header(title: string, color: typeof chalk.blue): void {
  console.log(color(`\n${'═'.repeat(60)}`));
  console.log(color.bold(`  ${title}`));
  console.log(color('═'.repeat(60)));
}

/**
 * Print agent startup banner
 */
export function printBanner(): void {
  console.log(
    chalk.cyan(`
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║   🤖  SENTIFI - AI Cross-Chain Trading Agent              ║
  ║                                                           ║
  ║   Powered by eXpress402 MCP + LI.FI                      ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
  `),
  );
}

/**
 * Log the monitor phase results
 */
export function logMonitor(result: MonitorResult, iteration: number): void {
  header(`📊 MONITOR PHASE (Iteration ${iteration})`, chalk.blue);

  // Timestamp
  console.log(chalk.dim(`  Time: ${result.timestamp.toISOString()}`));

  // Sentiment
  const sentimentColor =
    result.sentiment.score > 0
      ? chalk.green
      : result.sentiment.score < 0
        ? chalk.red
        : chalk.yellow;
  const emoji = getSentimentEmoji(result.sentiment.score);
  const label = getSentimentLabel(result.sentiment.score);

  console.log(chalk.white.bold('\n  Sentiment Analysis:'));
  console.log(
    `    ${emoji} Score: ${sentimentColor(result.sentiment.score.toFixed(1))} (${label})`,
  );
  console.log(`    Confidence: ${(result.sentiment.confidence * 100).toFixed(0)}%`);
  console.log(`    Sources analyzed: ${result.sentiment.sources.length}`);

  // Top sentiment sources
  if (result.sentiment.sources.length > 0) {
    console.log(chalk.dim('\n  Top Signals:'));
    result.sentiment.sources.slice(0, 3).forEach((source, i) => {
      const icon =
        source.score > 0 ? chalk.green('▲') : source.score < 0 ? chalk.red('▼') : chalk.yellow('●');
      const typeLabel = source.type === 'reddit' ? '📱' : '📰';
      const title = source.title.length > 50 ? `${source.title.slice(0, 47)}...` : source.title;
      console.log(`    ${i + 1}. ${icon} ${typeLabel} ${chalk.dim(title)}`);
    });
  }

  // External prices
  if (result.externalPrices.length > 0) {
    console.log(chalk.white.bold('\n  Correlated Assets:'));
    result.externalPrices.forEach(price => {
      console.log(`    ${price.symbol}: $${price.close.toFixed(2)} (${price.date})`);
    });
  }

  // Portfolio
  if (result.portfolio.length > 0) {
    const totalValue = result.portfolio.reduce((sum, h) => sum + h.valueUsd, 0);
    console.log(chalk.white.bold('\n  Portfolio Holdings:'));
    console.log(chalk.dim(`    Total Value: $${totalValue.toFixed(2)}`));

    // Group by chain
    const byChain = new Map<number, PortfolioHolding[]>();
    result.portfolio.forEach(h => {
      const list = byChain.get(h.chainId) ?? [];
      list.push(h);
      byChain.set(h.chainId, list);
    });

    byChain.forEach((holdings, chainId) => {
      const chainTotal = holdings.reduce((sum, h) => sum + h.valueUsd, 0);
      const chainName = CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
      console.log(chalk.cyan(`\n    ${chainName} ($${chainTotal.toFixed(2)}):`));

      holdings.forEach(h => {
        const pct = ((h.valueUsd / totalValue) * 100).toFixed(1);
        console.log(`      ${h.token}: ${h.balanceFormatted} ($${h.valueUsd.toFixed(2)}, ${pct}%)`);
      });
    });
  } else {
    console.log(chalk.yellow('\n  ⚠️  No portfolio holdings detected'));
  }

  // Yellow session status
  console.log(chalk.yellow.bold('\n  💛 Yellow Session:'));
  console.log(`    Session ID: ${result.session.appSessionId.slice(0, 16)}...`);
  console.log(`    Balance Remaining: $${result.session.remaining.toFixed(2)}`);
  console.log(`    Queries Made: ${result.session.queriesMade}`);
  console.log(`    Total Spent: $${result.session.totalSpent.toFixed(2)}`);
}

/**
 * Log the decision phase results
 */
export function logDecision(action: Action | null): void {
  header('🧠 DECIDE PHASE', chalk.magenta);

  if (!action) {
    console.log(chalk.gray('  Decision: ⏸️  HOLD'));
    console.log(chalk.dim('  Reason: No actionable signals detected'));
    return;
  }

  const emoji = getActionEmoji(action.type);
  const actionColor = action.type.includes('BULLISH')
    ? chalk.green
    : action.type.includes('BEARISH')
      ? chalk.red
      : chalk.cyan;

  console.log(`  Action: ${emoji} ${actionColor.bold(action.type)}`);
  console.log(`  Confidence: ${(action.confidence * 100).toFixed(0)}%`);
  console.log(chalk.dim(`\n  Reason: ${action.reason}`));

  console.log(chalk.white.bold('\n  Trade Details:'));
  console.log(`    From: ${action.params.amountFormatted} ${action.params.fromToken}`);
  console.log(`    To: ${action.params.toToken}`);
  console.log(`    Chain: ${CHAIN_NAMES[action.params.fromChain] ?? action.params.fromChain}`);

  if (action.params.composerWorkflow) {
    console.log(chalk.cyan(`\n  🔗 Composer Workflow: ${action.params.composerWorkflow}`));
    if (action.params.yieldProtocol) {
      console.log(`    Protocol: ${action.params.yieldProtocol.toUpperCase()}`);
    }
  }
}

/**
 * Log the execution phase results
 */
export function logExecution(result: ExecutionResult): void {
  header('⚡ ACT PHASE', chalk.green);

  if (result.success) {
    console.log(chalk.green.bold('  ✅ Execution Successful!'));

    if (result.txHash) {
      console.log(`\n  Transaction: ${chalk.cyan(result.txHash)}`);
    }
    if (result.fromAmount) {
      console.log(`  Swapped: ${result.fromAmount}`);
    }
    if (result.toAmount) {
      console.log(`  Received: ${result.toAmount}`);
    }
    if (result.route) {
      console.log(`  Route: ${result.route}`);
    }
    if (result.workflow) {
      console.log(chalk.cyan(`  Workflow: ${result.workflow}`));
    }
    if (result.explorerUrl) {
      console.log(chalk.dim(`\n  Explorer: ${result.explorerUrl}`));
    }
  } else {
    console.log(chalk.red.bold('  ❌ Execution Failed'));
    console.log(`  Error: ${result.error ?? 'Unknown error'}`);
  }
}

/**
 * Log iteration summary
 */
export function logIterationSummary(
  iteration: number,
  sentiment: number,
  action: string,
  success: boolean,
): void {
  const sentimentColor = sentiment > 0 ? chalk.green : sentiment < 0 ? chalk.red : chalk.yellow;
  const statusIcon = success ? chalk.green('✓') : chalk.red('✗');

  console.log(
    `${chalk.dim(
      `\n  [${iteration}] `,
    )}Sentiment: ${sentimentColor(sentiment.toFixed(0).padStart(4))} | ` +
      `Action: ${action.padEnd(12)} | ` +
      `Status: ${statusIcon}`,
  );
}

/**
 * Log agent state summary
 */
export function logAgentState(state: AgentState): void {
  header('📈 Agent Summary', chalk.cyan);

  console.log(`  Iterations: ${state.iteration}`);
  console.log(`  Running: ${state.isRunning ? chalk.green('Yes') : chalk.red('No')}`);

  if (state.history.length > 0) {
    console.log(chalk.white.bold('\n  Recent History:'));

    state.history.slice(-5).forEach(entry => {
      logIterationSummary(entry.iteration, entry.sentiment, entry.action, entry.success);
    });

    // Stats
    const successCount = state.history.filter(e => e.success).length;
    const actionCount = state.history.filter(e => e.action !== 'HOLD').length;

    console.log(chalk.white.bold('\n  Statistics:'));
    console.log(`    Actions taken: ${actionCount}`);
    console.log(
      `    Success rate: ${((successCount / Math.max(state.history.length, 1)) * 100).toFixed(0)}%`,
    );
  }
}

/**
 * Log error with context
 */
export function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.log(chalk.red(`\n  ❌ Error in ${context}: ${message}`));
}

/**
 * Log waiting message
 */
export function logWaiting(seconds: number): void {
  console.log(chalk.dim(`\n  ⏳ Waiting ${seconds}s before next iteration...`));
}

/**
 * Log demo mode notice
 */
export function logDemoMode(): void {
  console.log(chalk.yellow.bold('\n  ⚠️  DEMO MODE ACTIVE'));
  console.log(chalk.yellow('  Transactions will be simulated, not executed'));
}
