/**
 * Sentifi Demo Server
 *
 * Integration demo using the new clean architecture.
 * Provides HTTP API compatible with existing dashboard.
 * Integrates Yellow MCP for real sentiment data via market_rumors tool.
 */

import 'dotenv/config';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { platform } from 'os';
import chalk from 'chalk';

// Yellow and MCP imports
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  createAppSessionMessage,
  createCloseAppSessionMessage,
  createECDSAMessageSigner,
} from '@erc7824/nitrolite/dist/rpc/api.js';
import { RPCProtocolVersion } from '@erc7824/nitrolite/dist/rpc/types/index.js';
import { privateKeyToAccount } from 'viem/accounts';
import { getYellowConfig } from '../../yellow/config.js';
import { YellowRpcClient } from '../../yellow/rpc.js';

// Import new Sentifi modules
import {
  createSentimentAnalyzer,
  createSignalAggregator,
  createSentimentMomentumStrategy,
  registerStrategy,
  createRiskManager,
  createSimulatedExecutor,
  createPredictionTracker,
} from '../index.js';
import { createLifiExecutor } from '../execution/lifi-executor.js';
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
// Yellow MCP Integration (following e2e-paid-tools.ts pattern)
// ============================================================================

interface YellowMcpContext {
  client: Client | null;
  yellow: YellowRpcClient | null;
  appSessionId: string | null;
  agentAddress: `0x${string}` | null;
  connected: boolean;
}

const yellowContext: YellowMcpContext = {
  client: null,
  yellow: null,
  appSessionId: null,
  agentAddress: null,
  connected: false,
};

async function initializeYellow(): Promise<boolean> {
  try {
    const env = getYellowConfig();

    if (!env.agentPrivateKey || !env.merchantAddress) {
      log('⚠️ Yellow credentials not configured - using fallback data');
      return false;
    }

    yellowContext.agentAddress = privateKeyToAccount(env.agentPrivateKey as `0x${string}`).address;
    log(`🔑 Agent address: ${yellowContext.agentAddress}`);

    // Connect to Yellow Network and authenticate
    yellowContext.yellow = new YellowRpcClient({
      url: env.clearnodeUrl,
      privateKey: env.agentPrivateKey,
      authDomain: env.authDomain,
      debug: env.debug,
    });
    await yellowContext.yellow.connect();
    await yellowContext.yellow.authenticate({
      allowances: [{ asset: env.assetSymbol, amount: '1000' }],
      scope: 'transfer',
    });
    log('✓ Connected to Yellow Network');

    // Spawn MCP server via npm run dev
    // Use -c (not -lc) to avoid login shell loading old Node via bash_profile
    const transport = new StdioClientTransport({
      command: 'bash',
      args: ['-c', 'npm run dev'],
      env: Object.fromEntries(
        Object.entries(process.env).filter(([_, value]) => value !== undefined),
      ) as Record<string, string>,
      stderr: 'pipe',
    });

    yellowContext.client = new Client({ name: 'sentifi-agent', version: '0.1.0' });
    await yellowContext.client.connect(transport);
    log('✓ Connected to MCP Server');

    // Create Yellow app session for payment tracking
    const participants: `0x${string}`[] = [yellowContext.agentAddress, env.merchantAddress as `0x${string}`];
    const signer = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
    const allocations = participants.map((participant, i) => ({
      participant,
      asset: env.assetSymbol,
      amount: i === 0 ? '1.0' : '0.0',
    }));

    const message = await createAppSessionMessage(signer, {
      definition: {
        application: 'eXpress402-sentifi',
        protocol: RPCProtocolVersion.NitroRPC_0_4,
        participants,
        weights: participants.map(() => 1),
        quorum: 1,
        challenge: 0,
        nonce: Date.now(),
      },
      allocations,
      session_data: JSON.stringify({ ttlSeconds: 3600 }),
    });

    const response = (await yellowContext.yellow.sendRawMessage(message)) as Record<string, unknown>;
    yellowContext.appSessionId =
      (response.appSessionId as string | undefined) ??
      (response.app_session_id as string | undefined) ??
      (response.appSession as { appSessionId?: string } | undefined)?.appSessionId ?? null;

    if (!yellowContext.appSessionId) {
      log(`⚠️ Failed to create Yellow session: ${JSON.stringify(response)}`);
      return false;
    }

    log(`✓ Yellow session: ${yellowContext.appSessionId.slice(0, 20)}...`);
    yellowContext.connected = true;
    return true;
  } catch (error) {
    log(`⚠️ Yellow init failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function fetchMarketRumors(symbol: string): Promise<{ data: any; isLive: boolean }> {
  // Call market_rumors via MCP with Yellow payment
  if (yellowContext.connected && yellowContext.client && yellowContext.appSessionId && yellowContext.agentAddress) {
    try {
      log(`📡 Fetching market_rumors for ${symbol} via Yellow MCP...`);

      const result = await yellowContext.client.callTool({
        name: 'market_rumors',
        arguments: { symbol },
        _meta: {
          'x402/yellow': {
            appSessionId: yellowContext.appSessionId,
            payer: yellowContext.agentAddress,
          },
        },
      } as any);

      const resultText = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text;
      if (resultText) {
        const data = JSON.parse(resultText);
        log(`✓ Live data: ${data.reddit?.length || 0} Reddit posts, ${data.tavily?.length || 0} news articles`);
        return { data, isLive: true };
      }
    } catch (error) {
      log(`⚠️ MCP call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Fallback to mock data
  log(`📋 Using fallback data for ${symbol}`);
  return { data: MOCK_RUMORS[symbol] || MOCK_RUMORS.ETH, isLive: false };
}

async function closeYellowSession(): Promise<void> {
  if (yellowContext.yellow && yellowContext.appSessionId) {
    try {
      const env = getYellowConfig();
      const signer = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);

      const closeMessage = await createCloseAppSessionMessage(signer, {
        app_session_id: yellowContext.appSessionId as `0x${string}`,
        allocations: [],
      });

      await yellowContext.yellow.sendRawMessage(closeMessage);
      log('✓ Yellow session closed');
    } catch (error) {
      log(`⚠️ Failed to close session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (yellowContext.client) {
    await yellowContext.client.close();
  }
  yellowContext.yellow = null;
  yellowContext.client = null;
  yellowContext.connected = false;
}

// ============================================================================
// Demo State
// ============================================================================

// Trade history entry for P&L tracking
interface TradeHistoryEntry {
  id: string;
  timestamp: Date;
  action: 'BUY' | 'SELL';
  symbol: string;
  amount: number;
  price: number;
  valueUsd: number;
  txHash: string;
  status: 'pending' | 'completed' | 'failed';
}

// P&L tracking
interface PnLState {
  initialValueUsd: number;
  currentValueUsd: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalPnlPercent: number;
  tradeHistory: TradeHistoryEntry[];
  tokenHoldings: Record<string, { amount: number; avgCost: number }>;
}

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
  execution: { status: string; txHash: string; explorerUrl?: string } | null;
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
  pnl: PnLState;
  useLifiQuotes: boolean;
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
  pnl: {
    initialValueUsd: 0,
    currentValueUsd: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
    tradeHistory: [],
    tokenHoldings: {},
  },
  useLifiQuotes: true, // Use real LI.FI quotes
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
const simulatedExecutor = createSimulatedExecutor();
const lifiExecutor = createLifiExecutor({
  mode: 'demo', // Use demo mode (simulated execution with real quotes)
  integrator: 'sentifi-agent',
});
const predictionTracker = createPredictionTracker({ enabled: true });

// Register default strategy
registerStrategy('sentiment-momentum', createSentimentMomentumStrategy);

// Token prices for P&L calculation (would be fetched from API in production)
const TOKEN_PRICES: Record<string, number> = {
  ETH: 2500,
  USDC: 1,
  BTC: 45000,
  SOL: 100,
  WETH: 2500,
};

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
  const holdings: Holding[] = [
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
  ];

  // Add token holdings from P&L tracking
  for (const [symbol, holding] of Object.entries(state.pnl.tokenHoldings)) {
    if (holding.amount > 0) {
      const price = TOKEN_PRICES[symbol] || 0;
      holdings.push({
        chainId: 42161,
        chainName: 'Arbitrum',
        token: symbol,
        tokenAddress: '0x0000000000000000000000000000000000000000',
        address: '0x0000000000000000000000000000000000000000',
        balance: holding.amount,
        decimals: 18,
        valueUsd: holding.amount * price,
      });
    }
  }

  state.portfolio = holdings;
  updatePnL();
}

function updatePnL() {
  // Calculate current portfolio value
  let currentValueUsd = state.usdcBalance;
  let unrealizedPnl = 0;

  for (const [symbol, holding] of Object.entries(state.pnl.tokenHoldings)) {
    if (holding.amount > 0) {
      const currentPrice = TOKEN_PRICES[symbol] || 0;
      const currentValue = holding.amount * currentPrice;
      currentValueUsd += currentValue;

      // Calculate unrealized P&L based on average cost
      const costBasis = holding.amount * holding.avgCost;
      unrealizedPnl += currentValue - costBasis;
    }
  }

  state.pnl.currentValueUsd = currentValueUsd;
  state.pnl.unrealizedPnl = unrealizedPnl;
  state.pnl.totalPnl = state.pnl.realizedPnl + unrealizedPnl;

  if (state.pnl.initialValueUsd > 0) {
    state.pnl.totalPnlPercent = (state.pnl.totalPnl / state.pnl.initialValueUsd) * 100;
  }
}

function recordTrade(
  action: 'BUY' | 'SELL',
  symbol: string,
  amount: number,
  price: number,
  txHash: string
) {
  const trade: TradeHistoryEntry = {
    id: `trade-${Date.now()}`,
    timestamp: new Date(),
    action,
    symbol,
    amount,
    price,
    valueUsd: amount * price,
    txHash,
    status: 'completed',
  };

  state.pnl.tradeHistory.push(trade);

  // Update token holdings
  if (action === 'BUY') {
    const existing = state.pnl.tokenHoldings[symbol];
    if (existing) {
      // Update average cost
      const totalCost = existing.amount * existing.avgCost + amount * price;
      const totalAmount = existing.amount + amount;
      existing.avgCost = totalCost / totalAmount;
      existing.amount = totalAmount;
    } else {
      state.pnl.tokenHoldings[symbol] = { amount, avgCost: price };
    }
  } else if (action === 'SELL') {
    const existing = state.pnl.tokenHoldings[symbol];
    if (existing && existing.amount >= amount) {
      // Calculate realized P&L
      const costBasis = amount * existing.avgCost;
      const saleValue = amount * price;
      state.pnl.realizedPnl += saleValue - costBasis;

      existing.amount -= amount;
      if (existing.amount <= 0.0001) {
        delete state.pnl.tokenHoldings[symbol];
      }
    }
  }

  log(`📝 Trade recorded: ${action} ${amount.toFixed(6)} ${symbol} @ $${price.toFixed(2)}`);
  updatePnL();
}

function depositFunds(amount: number) {
  state.usdcBalance = Math.max(0, Math.min(10000, state.usdcBalance + amount));

  // Set initial value on first deposit
  if (state.pnl.initialValueUsd === 0) {
    state.pnl.initialValueUsd = state.usdcBalance;
  }

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
      bullishThreshold: 20,  // Lowered for demo - more trading action
      bearishThreshold: -20, // Lowered for demo - more trading action
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
  const executor = state.useLifiQuotes ? lifiExecutor : simulatedExecutor;
  log(`📈 Getting ${state.useLifiQuotes ? 'LI.FI' : 'simulated'} quote...`);

  try {
    const amount = parseFloat(state.decision.amount) || 0;
    const amountWei = Math.floor(amount * Math.pow(10, 6)).toString();

    // Use Yellow agent address for quotes (doesn't need funds for quote-only)
    const quoteAddress = yellowContext.agentAddress || '0xe74298ea70069822eB490cb4Fb4694302e94Dbe1';

    const quote = await executor.getQuote({
      fromToken: state.decision.fromToken,
      toToken: state.decision.toToken,
      fromChainId: 42161,
      toChainId: 42161,
      amount: amountWei,
      fromAddress: quoteAddress,
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
      if (quote.source === 'live') {
        log(`   Source: LI.FI (real market data)`);
      }
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
    // Fall back to simulated quote
    if (state.useLifiQuotes) {
      log(`   Falling back to simulated quote...`);
      state.useLifiQuotes = false;
      return getQuote();
    }
    return null;
  }
}

async function executeSwap() {
  if (!state.quote || !state.decision) {
    return null;
  }

  state.phase = 'execute';
  log(`⚡ Executing ${state.quote.isLive ? 'LI.FI' : 'simulated'} swap...`);

  const txHash = `0x${Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')}`;

  const explorerUrl = `https://arbiscan.io/tx/${txHash}`;

  state.execution = {
    status: state.quote.isLive ? 'Completed (Demo - Real Quote)' : 'Completed (Simulated)',
    txHash,
    explorerUrl,
  };

  log(`✓ Execution complete`);
  log(`   TX: ${txHash.slice(0, 20)}...`);

  // Parse the estimated output to get token amount
  const outputMatch = state.quote.estimatedOutput.match(/^([\d.]+)\s+(\w+)/);
  let outputToken = outputMatch ? outputMatch[2] : state.decision.toToken;

  // Record trade for P&L tracking
  if (state.decision.action === 'SWAP_BULLISH') {
    const inputUsdAmount = parseFloat(state.decision.amount);
    state.usdcBalance = Math.max(0, state.usdcBalance - inputUsdAmount);

    // Use quote amount if available, otherwise calculate from input
    const targetToken = state.symbol || outputToken || 'ETH';
    const fallbackPrice = TOKEN_PRICES[targetToken] || 2500;
    const outputAmount = outputMatch ? parseFloat(outputMatch[1]) : inputUsdAmount / fallbackPrice;

    // Calculate actual entry price from the trade (USDC paid / tokens received)
    // This gives us the real cost basis for P&L tracking
    const actualEntryPrice = outputAmount > 0 ? inputUsdAmount / outputAmount : fallbackPrice;

    // Record the buy trade with actual entry price
    recordTrade('BUY', targetToken, outputAmount, actualEntryPrice, txHash);

    log(`   💹 P&L: Bought ${outputAmount.toFixed(6)} ${targetToken} @ $${actualEntryPrice.toFixed(2)}`);
  } else if (state.decision.action === 'SWAP_BEARISH') {
    // Selling tokens back to USDC
    const inputAmount = parseFloat(state.decision.amount);
    const fromToken = state.decision.fromToken;
    const tokenPrice = TOKEN_PRICES[fromToken] || TOKEN_PRICES[state.symbol || 'ETH'] || 2500;

    // Calculate token amount from USDC value
    const tokenAmount = inputAmount / tokenPrice;
    recordTrade('SELL', fromToken, tokenAmount, tokenPrice, txHash);

    // Add USDC from sale
    state.usdcBalance += inputAmount;
    log(`   💹 P&L: Sold ${tokenAmount.toFixed(6)} ${fromToken} @ $${tokenPrice.toFixed(2)}`);
  }

  updatePortfolio();
  log(`   📊 Total P&L: $${state.pnl.totalPnl.toFixed(2)} (${state.pnl.totalPnlPercent >= 0 ? '+' : ''}${state.pnl.totalPnlPercent.toFixed(2)}%)`);

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

    // Fetch sentiment data via Yellow MCP (with fallback to mock)
    const { data: rumors, isLive } = await fetchMarketRumors(symbol);
    state.dataMode = isLive ? 'live' : 'fallback';
    state.yellowConnected = yellowContext.connected;
    state.mcpConnected = yellowContext.connected; // Using Yellow directly, not MCP client

    const signal = await analyzeWithNewArchitecture(symbol, rumors, isLive);
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

  // Try to initialize Yellow MCP for live sentiment data
  console.log(chalk.dim('Initializing Yellow MCP connection...'));
  const yellowConnected = await initializeYellow();

  const PORT = parseInt(process.env.SENTIFI_PORT || '3456');
  const server = createServer(handleRequest);

  server.listen(PORT, () => {
    console.log(chalk.green(`\n✓ Server running at http://localhost:${PORT}\n`));

    if (yellowConnected) {
      console.log(chalk.dim('Data mode:'), chalk.green('LIVE (Yellow MCP)'));
      console.log(chalk.dim('Yellow session:'), chalk.green(yellowContext.appSessionId?.slice(0, 20) + '...'));
    } else {
      console.log(chalk.dim('Data mode:'), chalk.yellow('FALLBACK (mock data)'));
      console.log(chalk.dim('Tip:'), chalk.dim('Set YELLOW_AGENT_PRIVATE_KEY for live data'));
    }

    console.log(chalk.dim('Architecture:'), chalk.cyan('NEW (Sentifi Modules)'));
    console.log(chalk.dim('\nFeatures:'));
    console.log(chalk.dim('  - Enhanced sentiment analysis with negation detection'));
    console.log(chalk.dim('  - Recency and engagement weighting'));
    console.log(chalk.dim('  - Risk management with confidence scaling'));
    console.log(chalk.dim('  - Pluggable strategy architecture'));
    console.log(chalk.dim('  - Yellow MCP integration for live market data'));

    const url = `http://localhost:${PORT}`;
    const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} ${url}`);
  });

  process.on('SIGINT', async () => {
    console.log(chalk.dim('\n\nShutting down...'));
    await closeYellowSession();
    process.exit(0);
  });
}

main().catch(console.error);
