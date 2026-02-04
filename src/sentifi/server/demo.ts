/**
 * Sentifi Demo Server
 *
 * Integration demo using the new clean architecture.
 * Provides HTTP API compatible with existing dashboard.
 */

import 'dotenv/config';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { platform } from 'os';
import chalk from 'chalk';

// Import new Sentifi modules
import {
  SentimentAnalyzer,
  createSentimentAnalyzer,
  SignalAggregator,
  createSignalAggregator,
  createSentimentMomentumStrategy,
  registerStrategy,
  createRiskManager,
  createSimulatedExecutor,
  createPredictionTracker,
} from '../index.js';
import type {
  RawSentimentItem,
  AggregatedSignal,
  Holding,
  AgentPhase,
} from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Fallback mock data
const MOCK_RUMORS: Record<string, any> = {
  ETH: {
    symbol: 'ETH',
    reddit: [
      { title: 'ETH looking bullish! Breaking out 🚀', url: '#', score: 245, createdUtc: Date.now() / 1000 - 3600 },
      { title: 'Ethereum upgrade coming - expect volatility', url: '#', score: 89, createdUtc: Date.now() / 1000 - 7200 },
      { title: 'Buy the dip? ETH fundamentals strong', url: '#', score: 156, createdUtc: Date.now() / 1000 - 1800 },
    ],
    tavily: [
      { title: 'Ethereum Price Surges on Institutional Interest', url: '#', content: 'Major institutions accumulating ETH...', score: 0.92 },
      { title: 'Analyst Upgrades ETH Price Target', url: '#', content: 'Strong on-chain metrics cited...', score: 0.85 },
    ],
  },
  BTC: {
    symbol: 'BTC',
    reddit: [
      { title: 'Bitcoin to $100k? Analysts say yes 🚀', url: '#', score: 512, createdUtc: Date.now() / 1000 - 1800 },
      { title: 'BTC halving impact analysis', url: '#', score: 234, createdUtc: Date.now() / 1000 - 3600 },
      { title: 'Selling pressure decreasing on BTC', url: '#', score: 178, createdUtc: Date.now() / 1000 - 5400 },
    ],
    tavily: [
      { title: 'Bitcoin ETF Inflows Hit Record High', url: '#', content: 'Institutional demand surging...', score: 0.95 },
      { title: 'BTC Mining Difficulty Reaches ATH', url: '#', content: 'Network security stronger than ever...', score: 0.88 },
    ],
  },
  SOL: {
    symbol: 'SOL',
    reddit: [
      { title: 'Solana TPS crushing it lately', url: '#', score: 189, createdUtc: Date.now() / 1000 - 2400 },
      { title: 'SOL ecosystem growing fast 🔥', url: '#', score: 145, createdUtc: Date.now() / 1000 - 4800 },
    ],
    tavily: [
      { title: 'Solana DeFi TVL Doubles in Q4', url: '#', content: 'Ecosystem expansion accelerating...', score: 0.89 },
    ],
  },
};

// ============================================================================
// Demo State
// ============================================================================

interface DemoState {
  phase: AgentPhase;
  symbol: string | null;
  sentiment: {
    score: number;
    confidence: number;
    sources: Array<{ type: string; title: string; score: number }>;
    label: string;
    isLive: boolean;
  } | null;
  decision: {
    action: string;
    reason: string;
    fromToken: string;
    toToken: string;
    amount: string;
    confidence: number;
    signals: string[];
  } | null;
  quote: {
    route: string;
    estimatedOutput: string;
    gasCost: string;
    steps: number;
    isLive: boolean;
  } | null;
  execution: { status: string; txHash: string } | null;
  logs: string[];
  portfolio: Holding[];
  usdcBalance: number;
  dataMode: 'live' | 'fallback';
  isRunning: boolean;
  yellowConnected: boolean;
  mcpConnected: boolean;
  decisionConfirmed: boolean;
  riskAssessment: {
    approved: boolean;
    riskScore: number;
    reasons: string[];
  } | null;
}

const state: DemoState = {
  phase: 'init',
  symbol: null,
  sentiment: null,
  decision: null,
  quote: null,
  execution: null,
  logs: [],
  portfolio: [],
  usdcBalance: 0,
  dataMode: 'fallback',
  isRunning: false,
  yellowConnected: false,
  mcpConnected: false,
  decisionConfirmed: false,
  riskAssessment: null,
};

// Initialize Sentifi components
const sentimentAnalyzer = createSentimentAnalyzer();
const signalAggregator = createSignalAggregator({
  sentimentWeight: 0.6,
  momentumWeight: 0.4,
});
const riskManager = createRiskManager({
  maxPositionSizeUsd: 1000,
  maxPositionPercent: 25,
  minConfidenceToTrade: 0.5,
});
const executor = createSimulatedExecutor();
const predictionTracker = createPredictionTracker({ enabled: true });

// Register default strategy
registerStrategy('sentiment-momentum', createSentimentMomentumStrategy);

// ============================================================================
// Helper Functions
// ============================================================================

function log(message: string) {
  const timestamp = new Date().toLocaleTimeString();
  state.logs.push(`[${timestamp}] ${message}`);
  if (state.logs.length > 50) state.logs.shift();
  console.log(chalk.dim(`[${timestamp}]`), message);
}

function resetState() {
  state.phase = 'init';
  state.symbol = null;
  state.sentiment = null;
  state.decision = null;
  state.quote = null;
  state.execution = null;
  state.riskAssessment = null;
  state.isRunning = false;
  state.decisionConfirmed = false;
  updatePortfolio();
  log('🔄 State reset - ready for new analysis');
}

function updatePortfolio() {
  const ethPrice = 2500;
  state.portfolio = [
    {
      chainId: 42161,
      chainName: 'Arbitrum',
      token: 'USDC',
      tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      balance: state.usdcBalance,
      decimals: 6,
      valueUsd: state.usdcBalance,
    },
    {
      chainId: 42161,
      chainName: 'Arbitrum',
      token: 'ETH',
      tokenAddress: '0x0000000000000000000000000000000000000000',
      address: '0x0000000000000000000000000000000000000000',
      balance: 0,
      decimals: 18,
      valueUsd: 0,
    },
  ];
}

function depositFunds(amount: number) {
  state.usdcBalance = Math.max(0, Math.min(10000, state.usdcBalance + amount));
  updatePortfolio();
  log(`💰 Deposited $${amount.toFixed(2)} USDC → Balance: $${state.usdcBalance.toFixed(2)}`);
}

// ============================================================================
// Convert raw rumors to RawSentimentItem format
// ============================================================================

function convertToSentimentItems(rumors: any): RawSentimentItem[] {
  const items: RawSentimentItem[] = [];

  for (const post of rumors.reddit ?? []) {
    items.push({
      source: 'reddit',
      title: post.title || '',
      content: post.selftext || '',
      url: post.url || '#',
      timestamp: new Date((post.createdUtc || Date.now() / 1000) * 1000),
      engagement: post.score || 0,
    });
  }

  for (const article of rumors.tavily ?? []) {
    items.push({
      source: 'news',
      title: article.title || '',
      content: article.content || '',
      url: article.url || '#',
      timestamp: new Date(),
      engagement: Math.floor((article.score || 0.5) * 100),
    });
  }

  return items;
}

// ============================================================================
// Analysis using new architecture
// ============================================================================

async function analyzeWithNewArchitecture(symbol: string, rumors: any, isLive: boolean) {
  state.phase = 'monitor';
  state.symbol = symbol;
  log(`📊 Analyzing ${symbol} sentiment using enhanced engine...`);

  // Convert rumors to RawSentimentItem format
  const sentimentItems = convertToSentimentItems(rumors);
  log(`   Processing ${sentimentItems.length} data points`);

  // Analyze using new SentimentAnalyzer
  const sentimentSignal = sentimentAnalyzer.analyze(sentimentItems);
  log(`   Sentiment: ${sentimentSignal.label} (score: ${sentimentSignal.score.toFixed(1)}, confidence: ${(sentimentSignal.confidence * 100).toFixed(0)}%)`);
  log(`   Negation adjustment: ${sentimentSignal.negationAdjustment.toFixed(2)}`);
  log(`   Recency factor: ${sentimentSignal.recencyFactor.toFixed(2)}`);

  // Aggregate signals (no momentum data in this demo)
  const aggregatedSignal = signalAggregator.aggregate(symbol, sentimentSignal);
  log(`   Overall: score ${aggregatedSignal.overallScore.toFixed(1)}, recommendation: ${aggregatedSignal.recommendation}`);

  // Convert to dashboard format
  const sources = sentimentItems.map((item) => ({
    type: item.source,
    title: item.title,
    score: item.engagement,
  }));

  state.sentiment = {
    score: aggregatedSignal.overallScore,
    confidence: aggregatedSignal.overallConfidence,
    sources,
    label: sentimentSignal.label.replace('_', ' '),
    isLive,
  };

  return aggregatedSignal;
}

async function makeDecision(signal: AggregatedSignal) {
  state.phase = 'decide';
  log(`🤔 Generating trading decision...`);

  const totalValueUsd = state.portfolio.reduce((sum, h) => sum + h.valueUsd, 0);

  // Use strategy to generate intent
  const strategy = createSentimentMomentumStrategy();
  const context = {
    signal,
    portfolio: state.portfolio,
    totalValueUsd,
    config: {
      bullishThreshold: 40,
      bearishThreshold: -40,
      minConfidence: 0.5,
      momentumWeight: 0.4,
      sentimentWeight: 0.6,
      targetAllocations: { ETH: 0.5, USDC: 0.5 },
      maxPositionPercent: 25,
    },
    availableChains: [42161],
    defaultChainId: 42161,
  };

  const intent = strategy.evaluate(context);

  if (intent) {
    log(`   Decision: ${intent.action.toUpperCase()} ${intent.symbol}`);
    log(`   Reason: ${intent.reason}`);
    log(`   Size: ${intent.suggestedSizePercent.toFixed(1)}% of portfolio`);

    // Assess risk
    const assessment = riskManager.evaluate(intent, state.portfolio, totalValueUsd);
    state.riskAssessment = {
      approved: assessment.approved,
      riskScore: assessment.riskScore,
      reasons: assessment.reasons,
    };

    log(`   Risk: ${assessment.approved ? 'APPROVED' : 'REJECTED'} (score: ${assessment.riskScore})`);
    if (assessment.reasons.length > 0) {
      assessment.reasons.forEach((r) => log(`     - ${r}`));
    }

    const amount = ((intent.suggestedSizePercent / 100) * totalValueUsd).toFixed(2);
    state.decision = {
      action: intent.action === 'buy' ? 'SWAP_BULLISH' : intent.action === 'sell' ? 'SWAP_BEARISH' : 'HOLD',
      reason: intent.reason,
      fromToken: intent.fromToken,
      toToken: intent.toToken,
      amount,
      confidence: intent.confidence,
      signals: intent.signals,
    };
  } else {
    log(`   Decision: HOLD - No trade recommended`);
    state.decision = {
      action: 'HOLD',
      reason: 'Signal not strong enough for action',
      fromToken: '-',
      toToken: '-',
      amount: '0',
      confidence: signal.overallConfidence,
      signals: [],
    };
    state.riskAssessment = null;
  }

  return intent;
}

function confirmDecision(action?: string, amount?: string) {
  if (!state.decision) return;

  if (action) {
    const symbol = state.symbol || 'ETH';
    if (action === 'SWAP_BULLISH') {
      state.decision.action = 'SWAP_BULLISH';
      state.decision.reason = `User confirmed: swap to ${symbol}`;
      state.decision.fromToken = 'USDC';
      state.decision.toToken = symbol === 'ETH' ? 'WETH' : symbol;
    } else if (action === 'SWAP_BEARISH') {
      state.decision.action = 'SWAP_BEARISH';
      state.decision.reason = `User confirmed: exit to stables`;
      state.decision.fromToken = symbol === 'ETH' ? 'WETH' : symbol;
      state.decision.toToken = 'USDC';
    } else {
      state.decision.action = 'HOLD';
      state.decision.reason = `User confirmed: hold position`;
      state.decision.fromToken = '-';
      state.decision.toToken = '-';
      state.decision.amount = '0';
    }
  }

  if (amount && state.decision.action !== 'HOLD') {
    state.decision.amount = amount;
  }

  state.decisionConfirmed = true;
  log(`✓ Decision confirmed: ${state.decision.action} ${state.decision.amount} ${state.decision.fromToken}`);
}

// ============================================================================
// Quote and Execute
// ============================================================================

async function getQuote() {
  if (!state.decision || state.decision.action === 'HOLD' || !state.decisionConfirmed) {
    return null;
  }

  state.phase = 'quote';
  log(`📈 Getting simulated quote...`);

  try {
    const amount = parseFloat(state.decision.amount) || 0;
    const amountWei = Math.floor(amount * Math.pow(10, 6)).toString();

    const quote = await executor.getQuote({
      fromToken: state.decision.fromToken,
      toToken: state.decision.toToken,
      fromChainId: 42161,
      toChainId: 42161,
      amount: amountWei,
      fromAddress: '0x0000000000000000000000000000000000000000',
    });

    if (quote.success) {
      state.quote = {
        route: quote.routeName || 'Direct',
        estimatedOutput: `${quote.estimatedOutput} ${quote.outputToken}`,
        gasCost: `$${quote.gasCostUsd.toFixed(2)}`,
        steps: quote.steps.length,
        isLive: quote.source === 'live',
      };
      log(`✓ Quote: ${quote.inputAmount} ${quote.inputToken} → ${quote.estimatedOutput} ${quote.outputToken}`);
      log(`   Route: ${quote.routeName} | Gas: $${quote.gasCostUsd.toFixed(2)}`);
    } else {
      log(`⚠️ Quote failed: ${quote.error}`);
      state.quote = {
        route: 'Failed',
        estimatedOutput: quote.error || 'Unknown error',
        gasCost: '-',
        steps: 0,
        isLive: false,
      };
    }

    return quote;
  } catch (error) {
    log(`❌ Quote error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function executeSwap() {
  if (!state.quote || !state.decision) {
    return null;
  }

  state.phase = 'execute';
  log(`⚡ Executing simulated swap...`);

  const txHash = `0x${Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')}`;

  state.execution = {
    status: 'Completed (Simulated)',
    txHash,
  };

  log(`✓ Simulated execution complete`);
  log(`   TX: ${txHash.slice(0, 20)}...`);

  if (state.decision.action === 'SWAP_BULLISH') {
    const amount = parseFloat(state.decision.amount);
    state.usdcBalance = Math.max(0, state.usdcBalance - amount);
  }
  updatePortfolio();

  state.phase = 'done';
  return state.execution;
}

// ============================================================================
// HTTP Server
// ============================================================================

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }

  if (url.pathname === '/api/deposit' && req.method === 'POST') {
    const body = await readBody(req);
    const { amount } = JSON.parse(body);
    depositFunds(parseFloat(amount) || 0);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, balance: state.usdcBalance }));
    return;
  }

  if (url.pathname === '/api/analyze' && req.method === 'POST') {
    const body = await readBody(req);
    const { symbol } = JSON.parse(body);

    if (state.usdcBalance <= 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Please deposit funds first' }));
      return;
    }

    state.isRunning = true;
    resetState();
    state.usdcBalance = parseFloat(body.match(/"usdcBalance":\s*(\d+)/)?.[1] || String(state.usdcBalance)) || state.usdcBalance;
    updatePortfolio();

    const rumors = MOCK_RUMORS[symbol] || MOCK_RUMORS.ETH;
    const signal = await analyzeWithNewArchitecture(symbol, rumors, false);
    await makeDecision(signal);

    state.isRunning = false;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (url.pathname === '/api/confirm' && req.method === 'POST') {
    const body = await readBody(req);
    const { action, amount } = JSON.parse(body);
    confirmDecision(action, amount);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (url.pathname === '/api/quote' && req.method === 'POST') {
    if (!state.decisionConfirmed) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Please confirm decision first' }));
      return;
    }
    await getQuote();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, quote: state.quote }));
    return;
  }

  if (url.pathname === '/api/execute' && req.method === 'POST') {
    await executeSwap();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, execution: state.execution }));
    return;
  }

  if (url.pathname === '/api/reset' && req.method === 'POST') {
    const currentBalance = state.usdcBalance;
    resetState();
    state.usdcBalance = currentBalance;
    updatePortfolio();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Serve dashboard HTML
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const dashboardPath = join(__dirname, '../../lifi-agent/dashboard.html');

    try {
      const html = readFileSync(dashboardPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Dashboard not found at: ' + dashboardPath);
    }
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(chalk.cyan.bold('\n🧠 Sentifi Demo Server (New Architecture)\n'));

  updatePortfolio();

  const PORT = parseInt(process.env.SENTIFI_PORT || '3456');
  const server = createServer(handleRequest);

  server.listen(PORT, () => {
    console.log(chalk.green(`\n✓ Server running at http://localhost:${PORT}\n`));
    console.log(chalk.dim('Data mode:'), chalk.yellow('FALLBACK (mock data)'));
    console.log(chalk.dim('Architecture:'), chalk.cyan('NEW (Sentifi Modules)'));
    console.log(chalk.dim('\nFeatures:'));
    console.log(chalk.dim('  - Enhanced sentiment analysis with negation detection'));
    console.log(chalk.dim('  - Recency and engagement weighting'));
    console.log(chalk.dim('  - Risk management with confidence scaling'));
    console.log(chalk.dim('  - Pluggable strategy architecture'));

    const url = `http://localhost:${PORT}`;
    const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} ${url}`);
  });

  process.on('SIGINT', () => {
    console.log(chalk.dim('\n\nShutting down...'));
    process.exit(0);
  });
}

main().catch(console.error);
