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
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  getContract,
  http,
  maxUint256,
  pad,
  parseUnits,
  zeroAddress,
} from 'viem';
import { randomBytes } from 'crypto';

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
import { ARC_TESTNET, arcTestnetChain, getArcConfig } from '../../arc/config.js';
import { createSIWxPayload, encodeSIWxHeader } from '../../x402/siwx/client.js';
import type { CompleteSIWxInfo } from '../../x402/siwx/types.js';

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

const ALLOW_MOCK_DATA = process.env.SENTIFI_ALLOW_MOCK_DATA === 'true';

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

type ArcGatewayContext = {
  account: ReturnType<typeof privateKeyToAccount> | null;
  agentAddress: `0x${string}` | null;
  merchantAddress: `0x${string}` | null;
  connected: boolean;
  unifiedBalanceUsdc: number;
  merchantUsdcBalanceUsdc: number;
  lastMintTxHash?: string;
};

const arcContext: ArcGatewayContext = {
  account: null,
  agentAddress: null,
  merchantAddress: null,
  connected: false,
  unifiedBalanceUsdc: 0,
  merchantUsdcBalanceUsdc: 0,
  lastMintTxHash: undefined,
};

async function ensureMcpConnected(): Promise<void> {
  if (yellowContext.client && yellowContext.transport) {
    return;
  }

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

  // Capture MCP server stderr for debug logging
  if ((transport as any)._process?.stderr) {
    (transport as any)._process.stderr.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      if (output.includes('[MCP]')) {
        const lines = output.split('\n').filter(line => line.includes('[MCP]'));
        lines.forEach(line => {
          const mcpMessage = line.replace(/^\[MCP\]\s*/, '');
          debugLog('HTTP', `MCP Server: ${mcpMessage}`);
        });
      }
    });
  }
}

async function postGatewayJson<T>(path: string, body: unknown): Promise<T> {
  const url = `${ARC_TESTNET.gatewayApiBaseUrl}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gateway API ${res.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function fetchArcUnifiedBalanceUsdc(depositor: string): Promise<number> {
  const response = await postGatewayJson<{
    token: string;
    balances: Array<{ domain: number; depositor: string; balance: string }>;
  }>('/v1/balances', {
    token: 'USDC',
    sources: [{ depositor, domain: ARC_TESTNET.gatewayDomain }],
  });
  const match = response.balances?.find(b => b.domain === ARC_TESTNET.gatewayDomain);
  const raw = match?.balance ?? '0';
  // Gateway API returns a decimal string like "10.000000" (not atomic units).
  // Parse into 6-decimal atomic units, then format consistently.
  let atomic: bigint;
  try {
    atomic = parseUnits(raw, 6);
  } catch {
    // Fallback for any unexpected integer-style payloads.
    atomic = BigInt(raw);
  }
  const formatted = Number(formatUnits(atomic, 6));
  return Number.isFinite(formatted) ? formatted : 0;
}

async function fetchArcOnchainUsdcBalance(address: `0x${string}`): Promise<number> {
  const { rpcUrl, usdcAddress } = getArcConfig();
  const publicClient = createPublicClient({ chain: arcTestnetChain, transport: http(rpcUrl) });
  const balance = await publicClient.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });
  const formatted = Number(formatUnits(balance, 6));
  return Number.isFinite(formatted) ? formatted : 0;
}

async function initializeArcGateway(): Promise<boolean> {
  try {
    const env = getYellowConfig();
    if (!env.agentPrivateKey || !env.merchantAddress) {
      console.log(chalk.yellow('⚠️  Arc/Gateway credentials not configured'));
      console.log(chalk.yellow(`   Agent key: ${env.agentPrivateKey ? 'Set' : 'Missing'}`));
      console.log(chalk.yellow(`   Merchant address: ${env.merchantAddress ? 'Set' : 'Missing'}`));
      return false;
    }

    arcContext.account = privateKeyToAccount(env.agentPrivateKey as `0x${string}`);
    arcContext.agentAddress = arcContext.account.address;
    arcContext.merchantAddress = env.merchantAddress as `0x${string}`;

    await ensureMcpConnected();

    const balance = await fetchArcUnifiedBalanceUsdc(arcContext.agentAddress);
    arcContext.unifiedBalanceUsdc = balance;
    try {
      arcContext.merchantUsdcBalanceUsdc = await fetchArcOnchainUsdcBalance(arcContext.merchantAddress);
    } catch (error) {
      debugLog(
        'HTTP',
        `Failed to fetch Arc merchant USDC balance: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    arcContext.connected = true;

    state.arcWallets = {
      agentAddress: arcContext.agentAddress,
      merchantAddress: arcContext.merchantAddress,
      unifiedBalanceUsdc: arcContext.unifiedBalanceUsdc,
      merchantUsdcBalanceUsdc: arcContext.merchantUsdcBalanceUsdc,
      pricePerCallUsd: getToolPriceUsd('market_rumors'),
      lastMintTxHash: arcContext.lastMintTxHash,
    };

    return true;
  } catch (error) {
    console.error('Arc/Gateway initialization failed:', error);
    arcContext.connected = false;
    state.arcWallets = null;
    return false;
  }
}

async function initializeYellow(): Promise<boolean> {
  try {
    const env = getYellowConfig();

    if (!env.agentPrivateKey || !env.merchantAddress) {
      console.log(chalk.yellow('⚠️  Yellow credentials not configured'));
      console.log(chalk.yellow(`   Agent key: ${env.agentPrivateKey ? 'Set' : 'Missing'}`));
      console.log(chalk.yellow(`   Merchant address: ${env.merchantAddress ? 'Set' : 'Missing'}`));
      if (ALLOW_MOCK_DATA) {
        console.log(chalk.yellow('   → Mock market data enabled (SENTIFI_ALLOW_MOCK_DATA=true)'));
        log('⚠️ Yellow credentials not configured - using mock market data');
      } else {
        console.log(chalk.yellow('   → Mock market data disabled (set SENTIFI_ALLOW_MOCK_DATA=true to enable)'));
        log('⚠️ Yellow credentials not configured - mock market data disabled');
      }
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

    console.log(chalk.dim('   Starting MCP server...'));
    await ensureMcpConnected();
    console.log(chalk.green('✓ MCP Server connected'));
    log('✓ Connected to MCP Server');

    // Create Yellow app session for payment tracking with QUORUM 2
    console.log(chalk.dim('   Creating Yellow payment session (Quorum 2)...'));
    const participants: `0x${string}`[] = [yellowContext.agentAddress, yellowContext.merchantAddress];
    yellowContext.participants = participants;
    const agentSigner = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
    const merchantSigner = createECDSAMessageSigner(env.merchantPrivateKey as `0x${string}`);
    // Session amount: sandbox uses 11.0 test tokens, production uses 0.1 real USDC
    const sessionAmount = env.mode === 'development' ? '11.0' : '0.1';
    const allocations = participants.map((participant, i) => ({
      participant,
      asset: env.assetSymbol,
      amount: i === 0 ? sessionAmount : '0.0',
    }));
    yellowContext.sessionInitialAmount = Number(allocations[0]?.amount ?? 0);

    const sessionParams = {
      definition: {
        application: YELLOW_APPLICATION,
        protocol: RPCProtocolVersion.NitroRPC_0_4,
        participants,
        weights: participants.map(() => 1),
        quorum: 2, // BOTH agent and merchant must sign
        challenge: 0,
        nonce: Date.now(),
      },
      allocations,
      session_data: JSON.stringify({ ttlSeconds: 3600 }),
    };

    const agentSessionMessage = await createAppSessionMessage(agentSigner, sessionParams);
    const sessionParsed = JSON.parse(agentSessionMessage);
    const merchantSessionSig = await merchantSigner(sessionParsed.req);
    sessionParsed.sig.push(merchantSessionSig);

    const response = (await yellowContext.yellow.sendRawMessage(JSON.stringify(sessionParsed))) as Record<string, unknown>;
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
    
    // Update state with wallet info and mark as logged in
    state.loggedIn = true;
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

async function updateYellowWalletState() {
  if (!yellowContext.connected || !yellowContext.agentAddress || !yellowContext.merchantAddress || !yellowContext.yellow) {
    state.yellowWallets = null;
    return;
  }
  
  const sessionRemaining = Math.max(0, yellowContext.sessionInitialAmount - yellowContext.sessionSpent);
  
  // Query UNIFIED off-chain balances
  let agentBalance = 0;
  let merchantBalance = 0;
  
  try {
    // Agent queries their OWN unified balance
    const agentBalances = await yellowContext.yellow.getLedgerBalances(); // No accountId!
    const agentAsset = agentBalances.find((b: any) => b.asset === yellowContext.assetSymbol);
    agentBalance = agentAsset ? parseFloat(agentAsset.amount) : 0;
    
    // Merchant queries their OWN unified balance (need separate client)
    const env = getYellowConfig();
    if (env.merchantPrivateKey) {
      const merchantYellow = new YellowRpcClient({
        url: env.clearnodeUrl,
        privateKey: env.merchantPrivateKey,
        authDomain: env.authDomain,
        debug: false,
      });
      
      await merchantYellow.connect();
      await merchantYellow.authenticate({
        allowances: [{ asset: env.assetSymbol, amount: '1000' }],
        scope: 'transfer',
      });
      
      const merchantBalances = await merchantYellow.getLedgerBalances(); // Merchant's OWN balance
      const merchantAsset = merchantBalances.find((b: any) => b.asset === yellowContext.assetSymbol);
      merchantBalance = merchantAsset ? parseFloat(merchantAsset.amount) : 0;
    }
  } catch (error) {
    console.error('Failed to fetch unified balances:', error);
  }
  
  state.yellowWallets = {
    agentAddress: yellowContext.agentAddress,
    merchantAddress: yellowContext.merchantAddress,
    agentBalance,
    merchantBalance,
    sessionInitial: yellowContext.sessionInitialAmount,
    sessionSpent: yellowContext.sessionSpent,
    sessionRemaining,
    assetSymbol: yellowContext.assetSymbol || 'ytest.usd',
    pricePerCall: getToolPriceUsd('market_rumors'),
  };
  
  // Debug log wallet balance update
  debugLog('WALLET', `Session: ${sessionRemaining.toFixed(2)} ${yellowContext.assetSymbol} remaining (spent: ${yellowContext.sessionSpent.toFixed(2)})`);
  debugLog('WALLET', `AI Agent balance: ${agentBalance.toFixed(2)} ${yellowContext.assetSymbol}`);
  debugLog('WALLET', `MCP Merchant balance: ${merchantBalance.toFixed(2)} ${yellowContext.assetSymbol}`);
}

async function fetchMarketRumors(symbol: string): Promise<{ data: any; isLive: boolean }> {
  if (state.paymentRail === 'arc') {
    return fetchMarketRumorsViaArcGateway(symbol);
  }

  // Check Yellow Network connection status
  if (!yellowContext.connected) {
    console.log(chalk.yellow('⚠️  Yellow Network not connected'));
    if (ALLOW_MOCK_DATA) {
      log('Using mock market data (Yellow Network not connected)');
      debugLog('HTTP', `Mock data enabled - Yellow Network not connected`);
      return { data: generateMockRumors(symbol), isLive: false };
    }
    throw new Error(
      'Yellow Network not connected. Login to Yellow or set SENTIFI_ALLOW_MOCK_DATA=true to enable mock fallback.',
    );
  }
  
  if (!yellowContext.client) {
    console.log(chalk.yellow('⚠️  MCP client not initialized'));
    if (ALLOW_MOCK_DATA) {
      log('Using mock market data (MCP client not available)');
      debugLog('HTTP', `Mock data enabled - MCP client not available`);
      return { data: generateMockRumors(symbol), isLive: false };
    }
    throw new Error(
      'MCP client not available. Restart the demo server or set SENTIFI_ALLOW_MOCK_DATA=true to enable mock fallback.',
    );
  }
  
  if (!yellowContext.appSessionId) {
    console.log(chalk.yellow('⚠️  No Yellow session ID'));
    if (ALLOW_MOCK_DATA) {
      log('Using mock market data (No active Yellow session)');
      debugLog('SESSION', `Mock data enabled - No active Yellow session`);
      return { data: generateMockRumors(symbol), isLive: false };
    }
    throw new Error(
      'No active Yellow session. Click LOGIN (Yellow) or set SENTIFI_ALLOW_MOCK_DATA=true to enable mock fallback.',
    );
  }
  
  if (!yellowContext.agentAddress) {
    console.log(chalk.yellow('⚠️  No agent wallet address'));
    if (ALLOW_MOCK_DATA) {
      log('Using mock market data (No wallet configured)');
      debugLog('WALLET', `Mock data enabled - No wallet configured`);
      return { data: generateMockRumors(symbol), isLive: false };
    }
    throw new Error(
      'No wallet configured. Configure Yellow keys or set SENTIFI_ALLOW_MOCK_DATA=true to enable mock fallback.',
    );
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
    
    // Deduct payment via Yellow Network session (local tracking)
    yellowContext.sessionSpent += toolPrice;
    const balanceAfter = yellowContext.sessionInitialAmount - yellowContext.sessionSpent;
    
    console.log(chalk.magenta(`💸 Session payment: ${toolPrice.toFixed(2)} ${yellowContext.assetSymbol} (total spent: ${yellowContext.sessionSpent.toFixed(2)})`));
    debugLog('SESSION', `Payment deducted: ${toolPrice.toFixed(2)} ${yellowContext.assetSymbol} (total spent: ${yellowContext.sessionSpent.toFixed(2)})`);
    
    // Log detailed response data with freshness indicators
    const redditCount = data.reddit?.length || 0;
    const tavilyCount = data.tavily?.length || 0;
    
    debugLog('HTTP', `✓ LIVE DATA from Yellow MCP: ${redditCount} Reddit, ${tavilyCount} Financial News`);
    
    // Show sample Reddit posts with age
    if (data.reddit && data.reddit.length > 0) {
      const sample = data.reddit[0];
      const createdDate = sample.createdUtc ? new Date(sample.createdUtc * 1000) : null;
      const hoursAgo = createdDate 
        ? ((Date.now() - createdDate.getTime()) / (1000 * 60 * 60)).toFixed(1)
        : '?';
      debugLog('HTTP', `Reddit sample (${hoursAgo}h ago): "${sample.title?.substring(0, 50)}..."`);
    }
    
    // Show sample Tavily financial articles with age
    if (data.tavily && data.tavily.length > 0) {
      const sample = data.tavily[0];
      const publishedDate = sample.published_date ? new Date(sample.published_date) : null;
      const hoursAgo = publishedDate 
        ? ((Date.now() - publishedDate.getTime()) / (1000 * 60 * 60)).toFixed(1)
        : '?';
      debugLog('HTTP', `Financial News sample (${hoursAgo}h ago): "${sample.title?.substring(0, 50)}..."`);
    }
    
    debugLog('SESSION', `✓ Yellow Network payment processed`);
    debugLog('SESSION', `Payment deducted: ${toolPrice.toFixed(2)} ${yellowContext.assetSymbol}`);
    debugLog('SESSION', `Post-call balance: ${balanceAfter.toFixed(2)} ${yellowContext.assetSymbol}`);
    debugLog('SESSION', `Transaction recorded in off-chain session: ${yellowContext.appSessionId.slice(0, 20)}...`);
    
    // Update wallet state after payment
    updateYellowWalletState();

    console.log(chalk.green(`✓ LIVE data received: ${data.reddit?.length || 0} Reddit posts, ${data.tavily?.length || 0} financial news articles`));
    log(
      `✓ Live data: ${data.reddit?.length || 0} Reddit, ${data.tavily?.length || 0} financial news`,
    );
    return { data, isLive: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`❌ MCP call failed: ${msg}`));
    log(`MCP call failed: ${msg}`);
    if (ALLOW_MOCK_DATA) {
      debugLog('HTTP', `Mock data enabled - MCP call failed: ${msg}`);
      console.log(chalk.yellow('Using mock market data (fallback enabled)'));
      log('Using mock market data (API call failed)');
      return { data: generateMockRumors(symbol), isLive: false };
    }
    throw error;
  }
}

async function fetchMarketRumorsViaArcGateway(symbol: string): Promise<{ data: any; isLive: boolean }> {
  if (!arcContext.connected || !arcContext.account || !arcContext.agentAddress || !arcContext.merchantAddress) {
    throw new Error('Arc/Circle Gateway not initialized. Click LOGIN and choose Arc + Circle Gateway.');
  }
  if (!yellowContext.client) {
    throw new Error('MCP client not available. Restart the demo server and try again.');
  }

  try {
    debugLog('HTTP', `Calling MCP tool via Arc/Gateway: market_rumors(symbol=${symbol})`);

    const env = getYellowConfig();
    const resourceUrl = 'mcp://tool/market_rumors';
    const pricePerCall = getToolPriceUsd('market_rumors');
    const requiredAmountUsd = pricePerCall.toString();
    const requiredValue = parseUnits(requiredAmountUsd, 6);
    const arcRuntime = getArcConfig();

    // Build a SIWx payload locally (server does not require a server-issued nonce today;
    // it only enforces nonce uniqueness + freshness + correct URI).
    const nonce = randomBytes(16).toString('hex');
    const issuedAt = new Date().toISOString();
    const expirationTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const siwxInfo: CompleteSIWxInfo = {
      domain: 'mcp.local',
      uri: resourceUrl,
      version: '1',
      nonce,
      issuedAt,
      expirationTime,
      statement: 'Sign in to access paid MCP tools',
      resources: [resourceUrl],
      chainId: ARC_TESTNET.caip2,
      type: 'eip191' as const,
    };

    const siwxPayload = await createSIWxPayload(siwxInfo, arcContext.account);
    const siwxHeader = encodeSIWxHeader(siwxPayload);

    // 2) Ensure unified balance exists (best effort: refresh gateway balance and fail early if empty)
    arcContext.unifiedBalanceUsdc = await fetchArcUnifiedBalanceUsdc(arcContext.agentAddress);
    try {
      arcContext.merchantUsdcBalanceUsdc = await fetchArcOnchainUsdcBalance(arcContext.merchantAddress);
    } catch {
      // Non-fatal; only affects UI display.
    }
    state.arcWallets = {
      agentAddress: arcContext.agentAddress,
      merchantAddress: arcContext.merchantAddress,
      unifiedBalanceUsdc: arcContext.unifiedBalanceUsdc,
      merchantUsdcBalanceUsdc: arcContext.merchantUsdcBalanceUsdc,
      pricePerCallUsd: Number(requiredAmountUsd),
      lastMintTxHash: arcContext.lastMintTxHash,
    };

    if (arcContext.unifiedBalanceUsdc < pricePerCall) {
      throw new Error(
        `Unified balance too low. Need ${requiredAmountUsd} USDC, have ${arcContext.unifiedBalanceUsdc.toFixed(2)} USDC.`,
      );
    }

    // 3) Create and sign burn intent (Arc -> Arc, recipient = merchant)
    const burnIntent = {
      maxBlockHeight: maxUint256,
      maxFee: 2_010000n,
      spec: {
        version: 1,
        sourceDomain: ARC_TESTNET.gatewayDomain,
        destinationDomain: ARC_TESTNET.gatewayDomain,
        sourceContract: ARC_TESTNET.gatewayWallet,
        destinationContract: arcRuntime.gatewayMinter,
        sourceToken: arcRuntime.usdcAddress,
        destinationToken: arcRuntime.usdcAddress,
        sourceDepositor: arcContext.agentAddress,
        destinationRecipient: arcContext.merchantAddress,
        sourceSigner: arcContext.agentAddress,
        destinationCaller: zeroAddress,
        value: requiredValue,
        salt: `0x${randomBytes(32).toString('hex')}`,
        hookData: '0x',
      },
    };

    const typedData = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
        ],
        TransferSpec: [
          { name: 'version', type: 'uint32' },
          { name: 'sourceDomain', type: 'uint32' },
          { name: 'destinationDomain', type: 'uint32' },
          { name: 'sourceContract', type: 'bytes32' },
          { name: 'destinationContract', type: 'bytes32' },
          { name: 'sourceToken', type: 'bytes32' },
          { name: 'destinationToken', type: 'bytes32' },
          { name: 'sourceDepositor', type: 'bytes32' },
          { name: 'destinationRecipient', type: 'bytes32' },
          { name: 'sourceSigner', type: 'bytes32' },
          { name: 'destinationCaller', type: 'bytes32' },
          { name: 'value', type: 'uint256' },
          { name: 'salt', type: 'bytes32' },
          { name: 'hookData', type: 'bytes' },
        ],
        BurnIntent: [
          { name: 'maxBlockHeight', type: 'uint256' },
          { name: 'maxFee', type: 'uint256' },
          { name: 'spec', type: 'TransferSpec' },
        ],
      },
      domain: { name: 'GatewayWallet', version: '1' },
      primaryType: 'BurnIntent',
      message: {
        ...burnIntent,
        spec: {
          ...burnIntent.spec,
          sourceContract: pad(burnIntent.spec.sourceContract.toLowerCase() as `0x${string}`, { size: 32 }),
          destinationContract: pad(burnIntent.spec.destinationContract.toLowerCase() as `0x${string}`, { size: 32 }),
          sourceToken: pad(burnIntent.spec.sourceToken.toLowerCase() as `0x${string}`, { size: 32 }),
          destinationToken: pad(burnIntent.spec.destinationToken.toLowerCase() as `0x${string}`, { size: 32 }),
          sourceDepositor: pad(burnIntent.spec.sourceDepositor.toLowerCase() as `0x${string}`, { size: 32 }),
          destinationRecipient: pad(burnIntent.spec.destinationRecipient.toLowerCase() as `0x${string}`, { size: 32 }),
          sourceSigner: pad(burnIntent.spec.sourceSigner.toLowerCase() as `0x${string}`, { size: 32 }),
          destinationCaller: pad(burnIntent.spec.destinationCaller.toLowerCase() as `0x${string}`, { size: 32 }),
        },
      },
    } as const;

    const burnSig = await arcContext.account.signTypedData(typedData as any);

    // 4) Request attestation from Gateway API
    const transferResp = await postGatewayJson<{
      transferId: string;
      attestation: `0x${string}`;
      signature: `0x${string}`;
      fees?: any;
    }>('/v1/transfer', [{ burnIntent: typedData.message, signature: burnSig }]);

    // 5) Mint on Arc (GatewayMinter.gatewayMint)
    const publicClient = createPublicClient({ chain: arcTestnetChain, transport: http(arcRuntime.rpcUrl) });
    const walletClient = createWalletClient({
      account: arcContext.account,
      chain: arcTestnetChain,
      transport: http(arcRuntime.rpcUrl),
    });

    const gatewayMinter = getContract({
      address: arcRuntime.gatewayMinter,
      abi: [
        {
          type: 'function',
          name: 'gatewayMint',
          inputs: [
            { name: 'attestationPayload', type: 'bytes' },
            { name: 'signature', type: 'bytes' },
          ],
          outputs: [],
          stateMutability: 'nonpayable',
        },
      ] as const,
      client: walletClient,
    });

    const mintTxHash = await gatewayMinter.write.gatewayMint([transferResp.attestation, transferResp.signature], {
      account: arcContext.account,
    });
    await publicClient.waitForTransactionReceipt({ hash: mintTxHash });
    arcContext.lastMintTxHash = mintTxHash;

    // Best-effort refresh so the UI reflects spend immediately.
    try {
      arcContext.unifiedBalanceUsdc = await fetchArcUnifiedBalanceUsdc(arcContext.agentAddress);
    } catch (refreshError) {
      debugLog(
        'HTTP',
        `Failed to refresh unified balance after mint: ${
          refreshError instanceof Error ? refreshError.message : String(refreshError)
        }`,
      );
    }
    try {
      arcContext.merchantUsdcBalanceUsdc = await fetchArcOnchainUsdcBalance(arcContext.merchantAddress);
    } catch (refreshError) {
      debugLog(
        'HTTP',
        `Failed to refresh merchant USDC balance after mint: ${
          refreshError instanceof Error ? refreshError.message : String(refreshError)
        }`,
      );
    }

    state.arcWallets = {
      agentAddress: arcContext.agentAddress,
      merchantAddress: arcContext.merchantAddress,
      unifiedBalanceUsdc: arcContext.unifiedBalanceUsdc,
      merchantUsdcBalanceUsdc: arcContext.merchantUsdcBalanceUsdc,
      pricePerCallUsd: Number(requiredAmountUsd),
      lastMintTxHash: arcContext.lastMintTxHash,
    };

    // 6) Retry tool call with payment proof
    const accepted = {
      scheme: 'arc-usd-offchain',
      network: 'arc-testnet',
      amount: requiredAmountUsd,
      asset: 'usdc',
      payTo: arcContext.merchantAddress,
      maxTimeoutSeconds: env.maxTimeoutSeconds,
      extra: {
        settlement: 'arc',
        rail: 'circle-gateway',
        arc: {
          chainId: ARC_TESTNET.chainId,
          rpcUrl: arcRuntime.rpcUrl,
          explorerBaseUrl: ARC_TESTNET.explorerBaseUrl,
          usdcAddress: arcRuntime.usdcAddress,
        },
        gateway: {
          apiBaseUrl: ARC_TESTNET.gatewayApiBaseUrl,
          domain: ARC_TESTNET.gatewayDomain,
          walletContract: ARC_TESTNET.gatewayWallet,
          minterContract: arcRuntime.gatewayMinter,
        },
      },
    };

    const paymentPayload = {
      x402Version: 2,
      accepted,
      payload: { mintTxHash },
    };

    const result = await yellowContext.client.callTool({
      name: 'market_rumors',
      arguments: { symbol },
      _meta: {
        'SIGN-IN-WITH-X': siwxHeader,
        'x402/payment': paymentPayload,
      },
    } as any);

    const { text, isError } = getToolText(result);
    if (!text) throw new Error('Empty response from market_rumors');
    if (isError) throw new Error(text);
    const data = parseJsonFromToolText<any>('market_rumors', text);
    return { data, isLive: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Arc/Gateway MCP call failed:', msg);
    throw new Error(`Arc/Circle payment failed: ${msg}`);
  }
}

async function closeYellowSession(fullDisconnect: boolean = true): Promise<void> {
  if (yellowContext.yellow && yellowContext.appSessionId) {
    try {
      const env = getYellowConfig();

      const asset = yellowContext.assetSymbol ?? env.assetSymbol;
      
      debugLog('SESSION', `Closing Yellow Network session: ${yellowContext.appSessionId.slice(0, 20)}...`);
      
      // Use LOCAL tracking instead of querying Yellow
      // Yellow Network doesn't track per-call deductions in real-time
      // The MCP server uses a local cache, so we calculate from our tracking
      const initial = Number.isFinite(yellowContext.sessionInitialAmount)
        ? yellowContext.sessionInitialAmount
        : 0;
      const spent = Number.isFinite(yellowContext.sessionSpent) ? yellowContext.sessionSpent : 0;
      const remaining = Math.max(0, initial - spent);
      
      debugLog('SESSION', `Using local tracking: initial=${initial.toFixed(2)}, spent=${spent.toFixed(2)}, remaining=${remaining.toFixed(2)} ${asset}`);
      console.log(chalk.cyan(`Local session tracking: ${spent.toFixed(2)} ${asset} spent from ${initial.toFixed(2)} ${asset}`));

      const allocations = computeSessionCloseAllocations({
        agentAddress: yellowContext.agentAddress,
        merchantAddress: yellowContext.merchantAddress,
        assetSymbol: asset,
        initialAmount: yellowContext.sessionInitialAmount,
        remainingAmount: remaining,
      });
      
      debugLog('SESSION', `Final settlement: Agent refund ${remaining.toFixed(2)} ${asset}, Merchant payment ${yellowContext.sessionSpent.toFixed(2)} ${asset}`);
      debugLog('SESSION', `Allocations: ${JSON.stringify(allocations)}`);
      console.log(chalk.cyan(`Session close allocations: ${JSON.stringify(allocations, null, 2)}`))

      // Close with QUORUM 2 (both agent and merchant sign)
      const agentCloseSigner = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
      const merchantCloseSigner = createECDSAMessageSigner(env.merchantPrivateKey as `0x${string}`);

      const agentCloseMessage = await createCloseAppSessionMessage(agentCloseSigner, {
        app_session_id: yellowContext.appSessionId as `0x${string}`,
        allocations,
      });

      const closeParsed = JSON.parse(agentCloseMessage);
      const merchantCloseSig = await merchantCloseSigner(closeParsed.req);
      closeParsed.sig.push(merchantCloseSig);

      const closeResponse = await yellowContext.yellow.sendRawMessage(JSON.stringify(closeParsed));
      
      console.log(chalk.cyan(`Close response: ${JSON.stringify(closeResponse, null, 2)}`));
      debugLog('SESSION', `✓ Yellow Network session closed with Quorum 2`);
      debugLog('SESSION', `Close response: ${JSON.stringify(closeResponse)}`);
      log('✓ Yellow session closed (Quorum 2)');
      
      // Verify the close was successful
      if (closeResponse && typeof closeResponse === 'object') {
        const success = (closeResponse as any).result?.success ?? (closeResponse as any).success ?? true;
        if (!success) {
          console.error(chalk.red('⚠️  Session close may have failed!'));
          debugLog('SESSION', `⚠️  Close response indicates failure`);
        }
      }
    } catch (error) {
      log(`⚠️ Failed to close session: ${error instanceof Error ? error.message : String(error)}`);
      debugLog('SESSION', `⚠️ Session close failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Reset session tracking
  yellowContext.appSessionId = null;
  yellowContext.sessionInitialAmount = 0;
  yellowContext.sessionSpent = 0;

  // Only disconnect if requested (e.g., on app shutdown)
  if (fullDisconnect) {
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
  loggedIn: boolean;
  paymentRail: 'yellow' | 'arc';
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
    agentBalance: number;
    merchantBalance: number;
    sessionInitial: number;
    sessionSpent: number;
    sessionRemaining: number;
    assetSymbol: string;
    pricePerCall: number;
  } | null;
  arcWallets: {
    agentAddress: string;
    merchantAddress: string;
    unifiedBalanceUsdc: number;
    merchantUsdcBalanceUsdc: number;
    pricePerCallUsd: number;
    lastMintTxHash?: string;
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
  debugLogsEnabled: false, // Feature flag - default OFF (click DEBUG badge to enable)
  portfolio: [],
  usdcBalance: 0,
  dataMode: 'fallback',
  isRunning: false,
  yellowConnected: false,
  mcpConnected: false,
  loggedIn: true,
  paymentRail: 'yellow',
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
  arcWallets: null,
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
      timestamp: article.published_date ? new Date(article.published_date) : new Date(),
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
    url: item.url,
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

// Map common symbols to their tradeable equivalents on Arbitrum
function getTradeableToken(symbol: string): string {
  const tokenMap: Record<string, string> = {
    'ETH': 'WETH',   // Wrapped Ether
    'BTC': 'WBTC',   // Wrapped Bitcoin
    // Add more mappings as needed
  };
  return tokenMap[symbol.toUpperCase()] || symbol;
}

function confirmDecision(action?: string, amount?: string) {
  if (!state.decision) return;

  if (action) {
    const symbol = state.symbol || 'ETH';
    const tradeableToken = getTradeableToken(symbol);
    
    if (action === 'SWAP_BULLISH') {
      state.decision.action = 'SWAP_BULLISH';
      state.decision.reason = `User confirmed: swap to ${symbol}`;
      state.decision.fromToken = 'USDC';
      state.decision.toToken = tradeableToken;
    } else if (action === 'SWAP_BEARISH') {
      state.decision.action = 'SWAP_BEARISH';
      state.decision.reason = `User confirmed: exit to stables`;
      state.decision.fromToken = tradeableToken;
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

  if (url.pathname === '/api/set-rail' && req.method === 'POST') {
    const body = await readBody(req);
    const { rail } = JSON.parse(body || '{}') as { rail?: string };
    if (rail !== 'yellow' && rail !== 'arc') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid rail. Use \"yellow\" or \"arc\".' }));
      return;
    }
    state.paymentRail = rail;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, rail }));
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
      const rail = state.paymentRail === 'arc' ? 'Circle Gateway unified balance' : 'Yellow session balance';
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Please deposit demo trading funds first',
          message: `This is a simulated trading bankroll (separate from the ${rail}).`,
          depositRequired: true,
        }),
      );
      return;
    }

    const pricePerCall = getToolPriceUsd('market_rumors');
    if (state.paymentRail === 'yellow') {
      // Check if Yellow session has enough balance for research
      if (yellowContext.connected && state.yellowWallets) {
        const sessionRemaining = yellowContext.sessionInitialAmount - yellowContext.sessionSpent;
        if (sessionRemaining < pricePerCall) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Research budget depleted',
              message: `Session balance too low. Need ${pricePerCall} ${state.yellowWallets.assetSymbol}, have ${sessionRemaining.toFixed(2)} ${state.yellowWallets.assetSymbol}`,
              budgetDepleted: true,
            }),
          );
          return;
        }
      }
    } else {
      // Arc/Circle Gateway: require unified balance before running paid tool calls.
      if (!arcContext.connected || !arcContext.agentAddress || !arcContext.merchantAddress) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Arc/Circle Gateway not initialized. Click LOGIN and choose Arc + Circle Gateway.',
          }),
        );
        return;
      }

      try {
        const unified = await fetchArcUnifiedBalanceUsdc(arcContext.agentAddress);
        arcContext.unifiedBalanceUsdc = unified;
        let merchantUsdc = arcContext.merchantUsdcBalanceUsdc;
        try {
          merchantUsdc = await fetchArcOnchainUsdcBalance(arcContext.merchantAddress);
          arcContext.merchantUsdcBalanceUsdc = merchantUsdc;
        } catch {
          // Non-fatal; only affects UI display.
        }
        state.arcWallets = {
          agentAddress: arcContext.agentAddress,
          merchantAddress: arcContext.merchantAddress,
          unifiedBalanceUsdc: arcContext.unifiedBalanceUsdc,
          merchantUsdcBalanceUsdc: merchantUsdc,
          pricePerCallUsd: pricePerCall,
          lastMintTxHash: arcContext.lastMintTxHash,
        };

        if (unified < pricePerCall) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Research budget depleted',
              message: `Gateway unified balance too low. Need ${pricePerCall.toFixed(2)} USDC, have ${unified.toFixed(2)} USDC. Fund the GatewayWallet and try again.`,
              budgetDepleted: true,
            }),
          );
          return;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Failed to read Gateway unified balance: ${msg}` }));
        return;
      }
    }

    state.isRunning = true;
    resetState();
    state.usdcBalance =
      parseFloat(body.match(/"usdcBalance":\s*(\d+)/)?.[1] || String(state.usdcBalance)) ||
      state.usdcBalance;
    updatePortfolio();

    try {
      // Fetch sentiment data via selected rail
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
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      state.isRunning = false;
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
      return;
    }
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

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    if (state.paymentRail === 'yellow') {
      // Close Yellow session and settle funds to merchant (but stay connected)
      console.log(chalk.yellow('\n🔒 Logout requested - closing session...'));
      await closeYellowSession(false);
    } else {
      // Arc/Gateway mode: no offchain session to close
      arcContext.connected = false;
      state.arcWallets = null;
    }
    
    // Mark as logged out
    state.loggedIn = false;
    
    // Wait longer for settlement to complete (Yellow Network processing time)
    console.log(chalk.yellow('⏳ Waiting 5 seconds for settlement...'));
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Update wallet balances to show merchant received funds
    console.log(chalk.yellow('💰 Querying final balances...'));
    await updateYellowWalletState();
    console.log(chalk.green('✓ Logout complete'));
    
    // Reset UI state but keep balances
    const currentBalance = state.usdcBalance;
    resetState();
    state.usdcBalance = currentBalance;
    state.loggedIn = false; // Keep logged out after reset
    updatePortfolio();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    if (state.paymentRail === 'yellow') {
      // Create new Yellow session from agent's off-chain balance
      await initializeYellow();
    } else {
      await initializeArcGateway();
    }
    
    // Mark as logged in
    state.loggedIn = true;
    
    // Update wallet balances
    if (state.paymentRail === 'yellow') {
      await updateYellowWalletState();
    }
    
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

  // Do not auto-login any payment rail. The dashboard selects rail at login time.
  state.loggedIn = false;
  state.yellowConnected = false;
  state.mcpConnected = false;
  state.dataMode = 'fallback';

  const PORT = parseInt(process.env.SENTIFI_PORT || '3456');
  const HOST = process.env.SENTIFI_HOST || '127.0.0.1';
  const server = createServer(handleRequest);

  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log(chalk.green(`\n✓ Server running at ${url}\n`));
    console.log(chalk.dim('Data mode:'), chalk.yellow('FALLBACK (login required)'));
    console.log(chalk.dim('Tip:'), chalk.dim('Use the dashboard to select Yellow or Arc, then click LOGIN.'));

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
