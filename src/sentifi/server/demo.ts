/**
 * Sentifi Demo Server
 *
 * Integration demo using the new clean architecture.
 * Provides HTTP API compatible with existing dashboard.
 * Integrates Yellow MCP for real sentiment data via market_rumors tool.
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ override: true });
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { platform } from 'os';
import chalk from 'chalk';
import { parseUnits } from 'viem';

// Yellow and MCP imports
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  createAppSessionMessage,
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

import {
  computeSessionCloseAllocations,
  getSessionAssetBalance,
  getToolText,
  parseJsonFromToolText,
  stopSpawnedMcpServer,
} from './yellow-mcp.js';

const YELLOW_APPLICATION = 'eXpress402-sentifi';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Fallback mock data generator (randomized for variety)
function generateMockRumors(symbol: string): any {
  const bullishTitles = [
    `${symbol} looking bullish! Breaking out 🚀`,
    `${symbol} fundamentals stronger than ever`,
    `Major accumulation detected for ${symbol}`,
    `${symbol} to new ATH? Analysts say yes`,
    `Institutional interest in ${symbol} surging`,
    `${symbol} technical breakout confirmed`,
  ];
  
  const bearishTitles = [
    `${symbol} facing resistance at key level`,
    `Concerns about ${symbol} short-term outlook`,
    `${symbol} showing signs of weakness`,
    `Analysts cautious on ${symbol}`,
    `${symbol} technical indicators turning bearish`,
  ];
  
  const neutralTitles = [
    `${symbol} consolidating, awaiting direction`,
    `${symbol} market analysis for this week`,
    `What's next for ${symbol}? Community discussion`,
    `${symbol} price prediction discussion`,
    `${symbol} technical analysis update`,
  ];
  
  // Randomize sentiment mix
  const rand = Math.random();
  const allTitles = rand > 0.6 ? bullishTitles : rand > 0.3 ? neutralTitles : bearishTitles;
  
  // Generate 3-5 reddit posts with random scores and timestamps
  const numPosts = 3 + Math.floor(Math.random() * 3);
  const reddit = [];
  for (let i = 0; i < numPosts; i++) {
    const titleIndex = Math.floor(Math.random() * allTitles.length);
    reddit.push({
      title: allTitles[titleIndex],
      url: '#',
      score: 50 + Math.floor(Math.random() * 400),
      createdUtc: Date.now() / 1000 - Math.floor(Math.random() * 10800), // Random within last 3 hours
    });
  }
  
  // Generate 2-3 tavily articles
  const numArticles = 2 + Math.floor(Math.random() * 2);
  const tavily = [];
  for (let i = 0; i < numArticles; i++) {
    tavily.push({
      title: `${symbol} Market Analysis ${new Date().toISOString().split('T')[0]}`,
      content: `Analysis of ${symbol} market conditions...`,
      score: 0.7 + Math.random() * 0.25,
    });
  }
  
  return { symbol, reddit, tavily };
}

const MOCK_RUMORS: Record<string, any> = {
  ETH: generateMockRumors('ETH'),
  BTC: generateMockRumors('BTC'),
  SOL: generateMockRumors('SOL'),
};

// ============================================================================
// Yellow MCP Integration (following e2e-paid-tools.ts pattern)
// ============================================================================

interface YellowMcpContext {
  client: Client | null;
  yellow: YellowRpcClient | null;
  appSessionId: string | null;
  agentAddress: `0x${string}` | null;
  merchantAddress: `0x${string}` | null;
  assetSymbol: string | null;
  participants: `0x${string}`[];
  sessionInitialAmount: number;
  sessionSpent: number;
  transport: StdioClientTransport | null;
  connected: boolean;
}

const yellowContext: YellowMcpContext = {
  client: null,
  yellow: null,
  appSessionId: null,
  agentAddress: null,
  merchantAddress: null,
  assetSymbol: null,
  participants: [],
  sessionInitialAmount: 0,
  sessionSpent: 0,
  transport: null,
  connected: false,
};

async function initializeYellow(): Promise<boolean> {
  try {
    const env = getYellowConfig();

    if (!env.agentPrivateKey || !env.merchantAddress) {
      console.log(chalk.yellow('⚠️  Yellow credentials not configured'));
      console.log(chalk.yellow(`   Agent key: ${env.agentPrivateKey ? 'Set' : 'Missing'}`));
      console.log(chalk.yellow(`   Merchant address: ${env.merchantAddress ? 'Set' : 'Missing'}`));
      console.log(chalk.yellow('   → Will use mock market data'));
      log('⚠️ Yellow credentials not configured - using fallback data');
      return false;
    }

    yellowContext.agentAddress = privateKeyToAccount(env.agentPrivateKey as `0x${string}`).address;
    yellowContext.merchantAddress = env.merchantAddress as `0x${string}`;
    yellowContext.assetSymbol = env.assetSymbol;
    yellowContext.sessionSpent = 0;
    console.log(chalk.cyan(`🔑 Agent wallet: ${yellowContext.agentAddress}`));
    console.log(chalk.cyan(`💼 Merchant wallet: ${yellowContext.merchantAddress}`));
    log(`🔑 Agent address: ${yellowContext.agentAddress}`);

    // Connect to Yellow Network and authenticate
    console.log(chalk.dim('   Connecting to Yellow Network...'));
    debugLog('SESSION', `Connecting to Yellow Network: ${env.clearnodeUrl}`);
    yellowContext.yellow = new YellowRpcClient({
      url: env.clearnodeUrl,
      privateKey: env.agentPrivateKey,
      authDomain: env.authDomain,
      debug: env.debug,
    });
    await yellowContext.yellow.connect();
    debugLog('SESSION', `✓ WebSocket connection established to Yellow clearnode`);
    
    await yellowContext.yellow.authenticate({
      allowances: [{ asset: env.assetSymbol, amount: '1000' }],
      scope: 'transfer',
      application: YELLOW_APPLICATION,
    });
    debugLog('SESSION', `✓ Authenticated with Yellow Network (app: ${YELLOW_APPLICATION})`);
    console.log(chalk.green('✓ Connected to Yellow Network'));
    log('✓ Connected to Yellow Network');

    // Spawn MCP server via npm run dev
    // Use -c (not -lc) to avoid login shell loading old Node via bash_profile
    console.log(chalk.dim('   Starting MCP server...'));
    const transport = new StdioClientTransport({
      command: 'bash',
      args: ['-c', 'npm run dev'],
      env: Object.fromEntries(
        Object.entries(process.env).filter(([_, value]) => value !== undefined),
      ) as Record<string, string>,
      stderr: 'pipe',
    });
    yellowContext.transport = transport;

    yellowContext.client = new Client({ name: 'sentifi-agent', version: '0.1.0' });
    await yellowContext.client.connect(transport);
    console.log(chalk.green('✓ MCP Server connected'));
    log('✓ Connected to MCP Server');

    // Create Yellow app session for payment tracking
    console.log(chalk.dim('   Creating Yellow payment session...'));
    const participants: `0x${string}`[] = [yellowContext.agentAddress, yellowContext.merchantAddress];
    yellowContext.participants = participants;
    const signer = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
    const allocations = participants.map((participant, i) => ({
      participant,
      asset: env.assetSymbol,
      amount: i === 0 ? '1.0' : '0.0',
    }));
    yellowContext.sessionInitialAmount = Number(allocations[0]?.amount ?? 0);

    const message = await createAppSessionMessage(signer, {
      definition: {
        application: YELLOW_APPLICATION,
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
      console.log(chalk.red(`❌ Failed to create Yellow session`));
      console.log(chalk.red(`   Response: ${JSON.stringify(response)}`));
      log(`⚠️ Failed to create Yellow session: ${JSON.stringify(response)}`);
      return false;
    }

    console.log(chalk.green(`✓ Yellow session created: ${yellowContext.appSessionId.slice(0, 20)}...`));
    console.log(chalk.green(`   Initial balance: ${yellowContext.sessionInitialAmount} ${yellowContext.assetSymbol}`));
    console.log(chalk.green('✓ Ready to use LIVE market data via Yellow MCP\n'));
    log(`✓ Yellow session: ${yellowContext.appSessionId.slice(0, 20)}...`);
    yellowContext.connected = true;
    
    // Debug log session initialization
    debugLog('SESSION', `✓ Yellow Network session created via RPC`);
    debugLog('SESSION', `Session ID: ${yellowContext.appSessionId}`);
    debugLog('SESSION', `Initial balance: ${yellowContext.sessionInitialAmount.toFixed(2)} ${yellowContext.assetSymbol}`);
    debugLog('SESSION', `Protocol: NitroRPC v0.4, Quorum: 1`);
    debugLog('WALLET', `Agent: ${yellowContext.agentAddress}`);
    debugLog('WALLET', `Merchant: ${yellowContext.merchantAddress}`);
    
    // Update state with wallet info
    updateYellowWalletState();
    
    return true;
  } catch (error) {
    console.log(chalk.red(`❌ Yellow initialization failed: ${error instanceof Error ? error.message : String(error)}`));
    console.log(chalk.yellow('   → Will use mock market data\n'));
    log(`⚠️ Yellow init failed: ${error instanceof Error ? error.message : String(error)}`);
    await stopSpawnedMcpServer(yellowContext.transport);
    yellowContext.transport = null;
    return false;
  }
}

function getToolPriceUsd(toolName: string): number {
  const env = getYellowConfig();
  const raw = env.toolPrices?.[toolName] ?? env.pricePerCall;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function updateYellowWalletState() {
  if (!yellowContext.connected || !yellowContext.agentAddress || !yellowContext.merchantAddress) {
    state.yellowWallets = null;
    return;
  }

  const sessionRemaining = Math.max(0, yellowContext.sessionInitialAmount - yellowContext.sessionSpent);
  
  state.yellowWallets = {
    agentAddress: yellowContext.agentAddress,
    merchantAddress: yellowContext.merchantAddress,
    sessionInitial: yellowContext.sessionInitialAmount,
    sessionSpent: yellowContext.sessionSpent,
    sessionRemaining,
    assetSymbol: yellowContext.assetSymbol || 'ytest.usd',
  };
  
  // Debug log wallet balance update
  debugLog('WALLET', `Balance updated: ${sessionRemaining.toFixed(2)} ${yellowContext.assetSymbol} remaining (spent: ${yellowContext.sessionSpent.toFixed(2)})`);
}

async function fetchMarketRumors(symbol: string): Promise<{ data: any; isLive: boolean }> {
  // Check Yellow Network connection status
  if (!yellowContext.connected) {
    console.log(chalk.yellow('⚠️  Yellow Network not connected'));
    log('📋 Using mock market data (Yellow Network not connected)');
    debugLog('HTTP', `⚠️ MOCK DATA - Yellow Network not connected`);
    return { data: generateMockRumors(symbol), isLive: false };
  }
  
  if (!yellowContext.client) {
    console.log(chalk.yellow('⚠️  MCP client not initialized'));
    log('📋 Using mock market data (MCP client not available)');
    debugLog('HTTP', `⚠️ MOCK DATA - MCP client not available`);
    return { data: generateMockRumors(symbol), isLive: false };
  }
  
  if (!yellowContext.appSessionId) {
    console.log(chalk.yellow('⚠️  No Yellow session ID'));
    log('📋 Using mock market data (No active Yellow session)');
    debugLog('SESSION', `⚠️ MOCK DATA - No active Yellow Network session`);
    return { data: generateMockRumors(symbol), isLive: false };
  }
  
  if (!yellowContext.agentAddress) {
    console.log(chalk.yellow('⚠️  No agent wallet address'));
    log('📋 Using mock market data (No wallet configured)');
    debugLog('WALLET', `⚠️ MOCK DATA - No wallet configured`);
    return { data: generateMockRumors(symbol), isLive: false };
  }

  // All conditions met, try to call MCP with Yellow payment
  try {
    console.log(chalk.cyan(`📡 Fetching LIVE market_rumors for ${symbol} via Yellow MCP...`));
    log(`📡 Fetching market_rumors for ${symbol} via Yellow MCP...`);
    
    const toolPrice = getToolPriceUsd('market_rumors');
    const balanceBefore = yellowContext.sessionInitialAmount - yellowContext.sessionSpent;
    
    debugLog('HTTP', `Calling MCP tool: market_rumors(symbol=${symbol})`);
    debugLog('SESSION', `Using Yellow session: ${yellowContext.appSessionId.slice(0, 20)}...`);
    debugLog('SESSION', `Payer wallet: ${yellowContext.agentAddress}`);
    debugLog('SESSION', `Pre-call balance: ${balanceBefore.toFixed(2)} ${yellowContext.assetSymbol}`);
    debugLog('HTTP', `Request via Yellow Network payment channel`);

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
    
    debugLog('HTTP', `✓ Response received from Yellow MCP server`);

    const { text, isError } = getToolText(result);
    if (!text) {
      throw new Error('Empty response from market_rumors');
    }
    if (isError) {
      throw new Error(text);
    }

    const data = parseJsonFromToolText<any>('market_rumors', text);
    
    // Deduct payment via Yellow Network session
    yellowContext.sessionSpent += toolPrice;
    const balanceAfter = yellowContext.sessionInitialAmount - yellowContext.sessionSpent;
    
    debugLog('HTTP', `MCP response: ${data.reddit?.length || 0} Reddit, ${data.tavily?.length || 0} Tavily`);
    debugLog('SESSION', `✓ Yellow Network payment processed`);
    debugLog('SESSION', `Payment deducted: ${toolPrice.toFixed(2)} ${yellowContext.assetSymbol}`);
    debugLog('SESSION', `Post-call balance: ${balanceAfter.toFixed(2)} ${yellowContext.assetSymbol}`);
    debugLog('SESSION', `Transaction recorded in off-chain session: ${yellowContext.appSessionId.slice(0, 20)}...`);
    
    // Update wallet state after payment
    updateYellowWalletState();

    console.log(chalk.green(`✓ LIVE data received: ${data.reddit?.length || 0} Reddit posts, ${data.tavily?.length || 0} news articles`));
    log(
      `✓ Live data: ${data.reddit?.length || 0} Reddit posts, ${data.tavily?.length || 0} news articles`,
    );
    return { data, isLive: true };
  } catch (error) {
    console.log(chalk.red(`❌ MCP call failed: ${error instanceof Error ? error.message : String(error)}`));
    log(`⚠️ MCP call failed: ${error instanceof Error ? error.message : String(error)}`);
    debugLog('HTTP', `MCP call failed: ${error instanceof Error ? error.message : String(error)}`);
    console.log(chalk.yellow('📋 Falling back to mock market data'));
    log('📋 Using mock market data (API call failed)');
    return { data: generateMockRumors(symbol), isLive: false };
  }
}

async function closeYellowSession(): Promise<void> {
  if (yellowContext.yellow && yellowContext.appSessionId) {
    try {
      const env = getYellowConfig();

      const asset = yellowContext.assetSymbol ?? env.assetSymbol;
      
      debugLog('SESSION', `Closing Yellow Network session: ${yellowContext.appSessionId.slice(0, 20)}...`);
      
      let remaining: number;
      try {
        remaining = await getSessionAssetBalance({
          yellow: yellowContext.yellow,
          sessionId: yellowContext.appSessionId,
          assetSymbol: asset,
        });
        debugLog('SESSION', `✓ Queried final balance from Yellow Network: ${remaining.toFixed(2)} ${asset}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`⚠️ Failed to query session balance, falling back: ${message}`);
        const initial = Number.isFinite(yellowContext.sessionInitialAmount)
          ? yellowContext.sessionInitialAmount
          : 0;
        remaining = Math.max(0, initial - Math.max(0, yellowContext.sessionSpent));
      }

      // Keep local tracking aligned with what Yellow reports.
      if (Number.isFinite(remaining)) {
        const initial = Number.isFinite(yellowContext.sessionInitialAmount)
          ? yellowContext.sessionInitialAmount
          : 0;
        yellowContext.sessionSpent = Math.max(0, initial - remaining);
      }

      const allocations = computeSessionCloseAllocations({
        agentAddress: yellowContext.agentAddress,
        merchantAddress: yellowContext.merchantAddress,
        assetSymbol: asset,
        initialAmount: yellowContext.sessionInitialAmount,
        remainingAmount: remaining,
      });
      
      debugLog('SESSION', `Final settlement: Agent refund ${remaining.toFixed(2)} ${asset}, Merchant payment ${yellowContext.sessionSpent.toFixed(2)} ${asset}`);

      await yellowContext.yellow.closeAppSession({
        appSessionId: yellowContext.appSessionId,
        allocations,
      });
      debugLog('SESSION', `✓ Yellow Network session closed and settled`);
      log('✓ Yellow session closed');
    } catch (error) {
      log(`⚠️ Failed to close session: ${error instanceof Error ? error.message : String(error)}`);
      debugLog('SESSION', `⚠️ Session close failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (yellowContext.client) {
    await yellowContext.client.close();
  }
  await stopSpawnedMcpServer(yellowContext.transport);
  yellowContext.yellow = null;
  yellowContext.client = null;
  yellowContext.transport = null;
  yellowContext.connected = false;
  
  // Clear wallet state
  state.yellowWallets = null;
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
  debugLogs: string[];
  debugLogsEnabled: boolean;
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
  yellowWallets: {
    agentAddress: string;
    merchantAddress: string;
    sessionInitial: number;
    sessionSpent: number;
    sessionRemaining: number;
    assetSymbol: string;
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
  debugLogs: [],
  debugLogsEnabled: true, // Feature flag - default ON
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
  yellowWallets: null,
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

function debugLog(category: 'SESSION' | 'HTTP' | 'WALLET', message: string) {
  if (!state.debugLogsEnabled) return;
  
  const timestamp = new Date().toLocaleTimeString();
  const prefix = {
    SESSION: '💰',
    HTTP: '🌐',
    WALLET: '💼',
  }[category];
  
  const formattedMessage = `[${timestamp}] ${prefix} [${category}] ${message}`;
  state.debugLogs.push(formattedMessage);
  if (state.debugLogs.length > 100) state.debugLogs.shift();
  
  // Also log to console in dim style
  console.log(chalk.dim(`[DEBUG] ${formattedMessage}`));
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
    const amountRaw = String(state.decision.amount ?? '').trim();
    if (!amountRaw) {
      throw new Error('Missing trade amount');
    }

    // Convert to smallest units deterministically (avoid NaN/scientific notation)
    // In this demo, quotes are typically USDC-based.
    const decimals =
      state.decision.fromToken === 'USDC' || state.decision.fromToken === 'USDT' ? 6 : 18;
    const amountWei = parseUnits(amountRaw, decimals).toString();
    if (amountWei === '0') {
      throw new Error(`Trade amount too small: ${amountRaw} ${state.decision.fromToken}`);
    }

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

    // Check if Yellow session has enough balance for research
    const pricePerCall = getToolPriceUsd('market_rumors');
    if (yellowContext.connected && state.yellowWallets) {
      const sessionRemaining = yellowContext.sessionInitialAmount - yellowContext.sessionSpent;
      if (sessionRemaining < pricePerCall) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Research budget depleted',
          message: `Session balance too low. Need ${pricePerCall} ${state.yellowWallets.assetSymbol}, have ${sessionRemaining.toFixed(2)} ${state.yellowWallets.assetSymbol}`,
          budgetDepleted: true
        }));
        return;
      }
    }

    state.isRunning = true;
    resetState();
    state.usdcBalance = parseFloat(body.match(/"usdcBalance":\s*(\d+)/)?.[1] || String(state.usdcBalance)) || state.usdcBalance;
    updatePortfolio();

    // Fetch sentiment data via Yellow MCP (with fallback to mock)
    const { data: rumors, isLive } = await fetchMarketRumors(symbol);
    state.dataMode = isLive ? 'live' : 'fallback';
    state.yellowConnected = yellowContext.connected;
    state.mcpConnected = Boolean(yellowContext.client); // Connected to MCP server via stdio

    const signal = await analyzeWithNewArchitecture(symbol, rumors, isLive);
    await makeDecision(signal);

    state.isRunning = false;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if ((url.pathname === '/api/confirm' || url.pathname === '/api/confirm-decision') && req.method === 'POST') {
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

  if (url.pathname === '/api/toggle-debug' && req.method === 'POST') {
    state.debugLogsEnabled = !state.debugLogsEnabled;
    debugLog('SESSION', `Debug logs ${state.debugLogsEnabled ? 'enabled' : 'disabled'}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, enabled: state.debugLogsEnabled }));
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
  const HOST = process.env.SENTIFI_HOST || '127.0.0.1';
  const server = createServer(handleRequest);

  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log(chalk.green(`\n✓ Server running at ${url}\n`));

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

    const shouldOpen =
      process.env.SENTIFI_NO_OPEN !== 'true' && process.env.CI !== 'true' && HOST === '127.0.0.1';
    if (shouldOpen) {
      const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
      exec(`${cmd} ${url}`);
    }
  });

  process.on('SIGINT', async () => {
    console.log(chalk.dim('\n\nShutting down...'));
    await closeYellowSession();
    process.exit(0);
  });
}

main().catch(console.error);
