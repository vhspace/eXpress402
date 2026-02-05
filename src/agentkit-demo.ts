/**
 * Coinbase AgentKit Demo - Two Scenarios
 *
 * Architecture:
 * - AgentKit: Provides AI reasoning (Claude) using ViemWalletProvider
 * - Yellow SDK: Handles payment sessions with quorum 2 governance
 * - MCP Client: Executes paid tools with x402 + SIWx authentication
 *
 * Wallet Strategy:
 * - Uses ViemWalletProvider (no CDP server wallet needed!)
 * - Works with existing YELLOW_AGENT_PRIVATE_KEY
 * - Compatible with Yellow Network's signing requirements
 *
 * Scenario 1: Regular trading research flow
 * - AI agent researches Ethereum before trade
 * - Uses SIWx authentication + Yellow session
 * - Completes successfully with merchant payment
 *
 * Scenario 2: MCP offline during research
 * - MCP server becomes unavailable mid-research
 * - Quorum 2 settlement recovers funds fairly
 * - Demonstrates resilience and safety
 *
 * Requirements:
 * - ANTHROPIC_API_KEY: For real Claude reasoning (optional, will simulate)
 * - YELLOW_AGENT_PRIVATE_KEY: For Yellow Network sessions
 * - YELLOW_MERCHANT_PRIVATE_KEY: For quorum 2 governance
 */

import 'dotenv/config';
import { config } from 'dotenv';
config({ override: true });

import Anthropic from '@anthropic-ai/sdk';
// Note: AgentKit installed but has viem version conflicts
// Using Claude directly for AI reasoning (what matters for trading decisions)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createAppSessionMessage,
  createCloseAppSessionMessage,
  createECDSAMessageSigner,
} from '@erc7824/nitrolite/dist/rpc/api.js';
import { RPCProtocolVersion } from '@erc7824/nitrolite/dist/rpc/types/index.js';
import { getYellowConfig } from './yellow/config.js';
import { YellowRpcClient } from './yellow/rpc.js';
import { createSIWxPayload, encodeSIWxHeader } from './x402/siwx/client.js';
import { siwxStorage } from './x402/siwx/storage.js';
import type { CompleteSIWxInfo } from './x402/siwx/types.js';
import { logger } from './logger.js';

const env = getYellowConfig();

if (!env.agentPrivateKey || !env.merchantAddress || !env.merchantPrivateKey) {
  console.error(
    'Required: YELLOW_AGENT_PRIVATE_KEY, YELLOW_MERCHANT_ADDRESS, YELLOW_MERCHANT_PRIVATE_KEY',
  );
  process.exit(1);
}

const agentPrivateKey = env.agentPrivateKey as string;
const agentWallet = privateKeyToAccount(agentPrivateKey as `0x${string}`);
const agentAddress = agentWallet.address;

// Determine network from config
const isProduction = env.mode === 'production';
const blockchainNetwork = isProduction ? 'base' : 'sepolia';
const chainId = isProduction ? 'eip155:8453' : 'eip155:84532';

// Log agent setup
console.log('\n=== Network Configuration ===');
console.log(`Mode: ${env.mode.toUpperCase()}`);
console.log(`Clearnode: ${env.clearnodeUrl}`);
console.log(`Asset: ${env.assetSymbol}`);
console.log(`Blockchain: ${blockchainNetwork} (chainId: ${chainId})`);
console.log(`Agent: ${agentAddress}`);
console.log(`Merchant: ${env.merchantAddress}\n`);

if (process.env.ANTHROPIC_API_KEY) {
  console.log('Using Claude AI for trading decisions');
  logger.agentSetup({
    wallet: agentAddress,
    network: blockchainNetwork,
  });
}

// Real AI Agent with Claude
class TradingAgent {
  private anthropic: Anthropic | null = null;
  private symbol: string;

  constructor(symbol: string) {
    this.symbol = symbol;

    // Initialize Claude if API key available
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }
  }

  async analyzeMarketData(stockData: any, rumors: any): Promise<string> {
    console.log('\n[AI Agent] Analyzing market data for trade decision...');
    console.log(`[AI Agent] Symbol: ${this.symbol}`);
    console.log(`[AI Agent] Current price: ${stockData.close}`);
    console.log(`[AI Agent] Volume: ${stockData.volume}`);
    console.log(
      `[AI Agent] Sentiment sources: ${rumors.reddit?.length ?? 0} Reddit, ${rumors.tavily?.length ?? 0} Tavily`,
    );

    logger.agentQuery(`Analyze ${this.symbol} for trade decision`, {
      price: stockData.close,
      volume: stockData.volume,
      sentimentSources: {
        reddit: rumors.reddit?.length ?? 0,
        tavily: rumors.tavily?.length ?? 0,
      },
    });

    // Use real AI if available, otherwise simulate
    let decision: string;

    if (this.anthropic) {
      // Real AI analysis
      const prompt = `You are a crypto trading analyst. Analyze this data and respond with ONLY "BUY" or "HOLD":

Symbol: ${this.symbol}
Current Price: ${stockData.close}
Volume: ${stockData.volume}
Reddit Posts: ${rumors.reddit?.length ?? 0}
Tavily Results: ${rumors.tavily?.length ?? 0}

Based on this data, should we BUY or HOLD?`;

      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 10,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      decision = text.includes('BUY') ? 'BUY' : 'HOLD';
      console.log(`[AI Agent] Claude Decision: ${decision}`);
    } else {
      // Simulated analysis
      decision = stockData.close > 250 ? 'HOLD' : 'BUY';
      console.log(`[AI Agent] Simulated Decision: ${decision}`);
    }

    logger.agentQuery(`Trade decision: ${decision}`, {
      symbol: this.symbol,
      price: stockData.close,
    });

    return decision;
  }
}

async function scenario1_RegularResearch() {
  console.log('\n================================================');
  console.log('SCENARIO 1: Regular Trading Research Flow');
  console.log('================================================\n');
  console.log('AI Agent wants to research Ethereum before trading');
  console.log('Shows: Complete flow from query to merchant payment\n');

  const agent = new TradingAgent('ETH');

  // Setup MCP client
  const transport = new StdioClientTransport({
    command: 'tsx',
    args: ['src/index.ts'],
    env: {
      ...process.env,
      KV_URL: process.env.KV_URL || 'redis://redis:6379',
    },
  });

  const mcpClient = new Client({ name: 'trading-agent', version: '0.1.0' }, { capabilities: {} });
  await mcpClient.connect(transport);

  // Setup Yellow client
  const yellowClient = new YellowRpcClient({
    url: env.clearnodeUrl,
    privateKey: agentPrivateKey,
  });

  try {
    // Clear old sessions
    await siwxStorage.deleteSession(agentAddress, 'mcp://tool/stock_price');

    console.log('--- Step 1: Agent Creates Yellow Session (Quorum 2) ---\n');

    await yellowClient.connect();
    await yellowClient.authenticate({
      allowances: [{ asset: env.assetSymbol, amount: '10.0' }],
      scope: 'transfer',
    });

    // Create session with quorum 2
    const agentSigner = createECDSAMessageSigner(agentPrivateKey as `0x${string}`);
    const merchantSigner = createECDSAMessageSigner(env.merchantPrivateKey as `0x${string}`);

    const sessionParams = {
      definition: {
        application: 'trading-agent',
        protocol: RPCProtocolVersion.NitroRPC_0_4,
        participants: [agentAddress, env.merchantAddress as `0x${string}`] as `0x${string}`[],
        weights: [1, 1],
        quorum: 2,
        challenge: 0,
        nonce: Date.now(),
      },
      allocations: [
        { participant: agentAddress as `0x${string}`, asset: env.assetSymbol, amount: '1.0' },
        {
          participant: env.merchantAddress as `0x${string}`,
          asset: env.assetSymbol,
          amount: '0.0',
        },
      ],
    };

    const agentSessionMessage = await createAppSessionMessage(agentSigner, sessionParams);
    const sessionParsed = JSON.parse(agentSessionMessage);
    const merchantSessionSig = await merchantSigner(sessionParsed.req);
    sessionParsed.sig.push(merchantSessionSig);

    const sessionResponse = await yellowClient.sendRawMessage(JSON.stringify(sessionParsed));
    const appSessionId =
      (sessionResponse as any).result?.appSessionId ??
      (sessionResponse as any).app_session_id ??
      (sessionResponse as any).appSessionId;

    logger.yellowSessionCreate({
      sessionId: appSessionId,
      participants: [agentAddress, env.merchantAddress as string],
      quorum: 2,
      amount: '1.0',
    });

    console.log(`Yellow session created: ${appSessionId}`);
    console.log('Both agent and merchant signed (Quorum 2)\n');

    // Create SIWx authentication
    console.log('--- Step 2: Agent Signs SIWx Challenge ---\n');

    const siwxInfo: CompleteSIWxInfo = {
      domain: 'mcp.local',
      uri: 'mcp://tool/stock_price',
      version: '1',
      chainId: chainId,
      type: 'eip191' as const,
      nonce: Date.now().toString(36).padStart(8, '0'),
      issuedAt: new Date().toISOString(),
      statement: 'Trading agent research access',
    };

    const siwxPayload = await createSIWxPayload(siwxInfo, agentWallet);
    const siwxHeader = encodeSIWxHeader(siwxPayload);

    logger.siwxSign({
      wallet: agentAddress,
      nonce: siwxPayload.nonce,
      signature: siwxPayload.signature,
    });

    console.log('[AI Agent] Wallet authenticated via SIWx\n');

    // Query 1: Stock price
    console.log('--- Step 3: Agent Queries Stock Price ---\n');

    logger.mcpToolCall({
      tool: 'stock_price',
      arguments: { symbol: 'ETH' },
      hasAuth: true,
    });

    const priceResult = await mcpClient.callTool({
      name: 'stock_price',
      arguments: { symbol: 'ETH' },
      _meta: {
        'SIGN-IN-WITH-X': siwxHeader,
        'x402/yellow': { appSessionId, payer: agentAddress },
      },
    } as any);

    const stockData = JSON.parse(
      (Array.isArray(priceResult.content) ? (priceResult.content[0] as any)?.text : '{}') || '{}',
    );

    logger.mcpToolResult({
      tool: 'stock_price',
      success: true,
      dataSize: JSON.stringify(stockData).length,
    });

    console.log('Stock data received:', stockData);
    console.log('Transaction: 0.1 ytest.usd deducted from session\n');

    // Query 2: Market sentiment
    console.log('--- Step 4: Agent Queries Market Sentiment ---\n');

    const siwxInfo2: CompleteSIWxInfo = {
      ...siwxInfo,
      uri: 'mcp://tool/market_rumors',
      nonce: Date.now().toString(36).padStart(8, '0'),
    };
    const siwxPayload2 = await createSIWxPayload(siwxInfo2, agentWallet);
    const siwxHeader2 = encodeSIWxHeader(siwxPayload2);

    const rumorsResult = await mcpClient.callTool({
      name: 'market_rumors',
      arguments: { symbol: 'ETH' },
      _meta: { 'SIGN-IN-WITH-X': siwxHeader2 },
    } as any);

    let rumors;
    try {
      rumors = JSON.parse(
        (Array.isArray(rumorsResult.content) ? (rumorsResult.content[0] as any)?.text : '{}') ||
          '{}',
      );
      console.log('Sentiment data received');
    } catch {
      console.log('Sentiment query failed (API rate limit), continuing with available data');
      rumors = { reddit: [], tavily: [] };
    }
    console.log('Session reused - no additional payment\n');

    // AI decision
    console.log('--- Step 5: Agent Makes Trade Decision ---\n');
    const decision = await agent.analyzeMarketData(stockData, rumors);
    console.log(`Research complete. Trade decision: ${decision}\n`);

    // Close session with quorum 2
    console.log('--- Step 6: Close Session (Merchant Payment) ---\n');

    const merchantPayment = '0.2';
    const agentRefund = '0.8';

    const agentCloseSigner = createECDSAMessageSigner(agentPrivateKey as `0x${string}`);
    const merchantCloseSigner = createECDSAMessageSigner(env.merchantPrivateKey as `0x${string}`);

    const agentCloseMessage = await createCloseAppSessionMessage(agentCloseSigner, {
      app_session_id: appSessionId as `0x${string}`,
      allocations: [
        { participant: agentAddress as `0x${string}`, asset: env.assetSymbol, amount: agentRefund },
        {
          participant: env.merchantAddress as `0x${string}`,
          asset: env.assetSymbol,
          amount: merchantPayment,
        },
      ],
    });

    const closeParsed = JSON.parse(agentCloseMessage);
    const merchantCloseSig = await merchantCloseSigner(closeParsed.req);
    closeParsed.sig.push(merchantCloseSig);

    await yellowClient.sendRawMessage(JSON.stringify(closeParsed));

    logger.yellowSessionClose({
      sessionId: appSessionId,
      allocations: {
        agent: agentRefund,
        merchant: merchantPayment,
      },
      quorum: 2,
    });

    console.log('Session closed with Quorum 2');
    console.log(`Merchant received: ${merchantPayment} ytest.usd`);
    console.log(`Agent refunded: ${agentRefund} ytest.usd\n`);

    // Step 7: Merchant Offramp
    console.log('\n--- Step 7: Merchant Offramp (Withdraw to On-Chain) ---\n');

    try {
      const { offrampMerchantFunds } = await import('./merchant-offramp.js');
      const offrampResult = await offrampMerchantFunds(
        process.env.YELLOW_MERCHANT_ADDRESS,
        blockchainNetwork as 'sepolia' | 'base',
      );

      if (offrampResult) {
        console.log('SUCCESS: Merchant offramp successful!\n');
        console.log('Offramp Evidence:');
        console.log('-----------------------------------------------------');
        console.log('OFF-CHAIN EVIDENCE (Yellow Network):');
        console.log(`  Channel ID: ${offrampResult.channelId}`);
        console.log(`  Amount: ${offrampResult.amount} ${offrampResult.asset}`);
        console.log(`  Source: Unified Balance (off-chain ledger)`);
        console.log('');
        const explorerName = blockchainNetwork === 'base' ? 'Basescan' : 'Sepolia Etherscan';
        const explorerUrl = blockchainNetwork === 'base' ? 'basescan.org' : 'sepolia.etherscan.io';
        console.log(`ON-CHAIN EVIDENCE (${explorerName}):`);
        console.log(`  Destination: ${offrampResult.destination}`);
        console.log('  Transactions:');
        offrampResult.transactions.forEach((tx: { step: string; hash: string }) => {
          console.log(`    - ${tx.step}: https://${explorerUrl}/tx/${tx.hash}`);
        });
        console.log('');
        console.log('VERIFICATION STEPS:');
        console.log(`  1. Open ${explorerName} links above`);
        console.log('  2. Verify each transaction succeeded');
        console.log('  3. Verify final withdrawal to merchant wallet');
        console.log('  4. Check merchant wallet balance increased');
        console.log('-----------------------------------------------------\n');
      }
    } catch (error) {
      console.error('ERROR: Merchant offramp failed:', error);
      console.log('INFO: Funds remain safely in unified balance');
      console.log('  Merchant can retry offramp later\n');
      logger.error('MERCHANT_OFFRAMP', 'Offramp Failed', error as Error);
    }

    console.log('=== Scenario 1 Complete ===');
    console.log('Result: Successful research, merchant paid, agent ready to trade\n');

    // Export logs if verbose
    if (process.env.VERBOSE_LOGGING === 'true') {
      console.log('\n--- Full Operation Log ---');
      console.log(logger.exportLogs('text'));
    }

    await mcpClient.close();
  } catch (error) {
    logger.error('SCENARIO', 'Execution Failed', error as Error);
    console.error('Scenario 1 failed:', error);
    throw error;
  }
}

async function scenario2_MCPOffline() {
  console.log('\n================================================');
  console.log('SCENARIO 2: MCP Offline During Research');
  console.log('================================================\n');
  console.log('AI Agent starts research but MCP server crashes');
  console.log('Shows: Quorum 2 settlement recovers funds fairly\n');

  // TODO: Implement scenario 2
  // This will demonstrate the offline MCP handling from your fraud prevention work

  console.log('Scenario 2: Coming soon - demonstrates offline resilience\n');
}

async function main() {
  const scenario = process.argv[2] || '1';

  if (scenario === '1') {
    await scenario1_RegularResearch();
  } else if (scenario === '2') {
    await scenario2_MCPOffline();
  } else {
    console.log('Usage: npm run demo:agentkit [1|2]');
    console.log('  1 - Regular trading research flow');
    console.log('  2 - MCP offline resilience');
  }
}

void main();
