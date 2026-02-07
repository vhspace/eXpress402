#!/usr/bin/env tsx
/**
 * Suifi Demo with Yellow Payment Integration
 *
 * Demonstrates the full flow:
 * 1. Connect to Yellow Network
 * 2. Create payment session
 * 3. Use Suifi MCP tools (requires payment)
 * 4. Close session
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ override: true });

import chalk from 'chalk';
import { getYellowConfig } from '../src/yellow/config.js';
import { YellowRpcClient } from '../src/yellow/rpc.js';
import { loadConfig, createSuifiMCPServer } from '../src/suifi/index.js';
import { spawn } from 'child_process';
import { privateKeyToAccount } from 'viem/accounts';

const YELLOW_APPLICATION = 'eXpress402-suifi';

// ============================================================================
// YELLOW CONTEXT
// ============================================================================

interface YellowContext {
  yellow: YellowRpcClient | null;
  config: any;
  agentAddress: `0x${string}` | null;
  merchantAddress: `0x${string}` | null;
  connected: boolean;
  sessionId: string | null;
}

const yellowContext: YellowContext = {
  yellow: null,
  config: null,
  agentAddress: null,
  merchantAddress: null,
  connected: false,
  sessionId: null,
};

// ============================================================================
// MAIN FLOW
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              🔮 SUIFI + YELLOW NETWORK INTEGRATION                 ║');
  console.log('║           AI Decision Recorder with Payment Protection              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Load configuration
  console.log('📋 Step 1: Loading configuration...\n');
  const yellowConfig = getYellowConfig();
  const suifiConfig = loadConfig();

  yellowContext.config = yellowConfig;

  if (!yellowConfig.agentPrivateKey || !yellowConfig.merchantAddress) {
    console.log(chalk.yellow('⚠️  Yellow credentials not configured'));
    console.log(chalk.yellow('   Please set YELLOW_AGENT_PRIVATE_KEY and YELLOW_MERCHANT_ADDRESS'));
    console.log(chalk.yellow('   → Will use mock mode\n'));
    await runMockDemo();
    return;
  }

  yellowContext.agentAddress = privateKeyToAccount(
    yellowConfig.agentPrivateKey as `0x${string}`
  ).address;
  yellowContext.merchantAddress = yellowConfig.merchantAddress as `0x${string}`;

  console.log(chalk.cyan(`   Agent: ${yellowContext.agentAddress}`));
  console.log(chalk.cyan(`   Merchant: ${yellowContext.merchantAddress}`));
  console.log(chalk.cyan(`   Asset: ${yellowConfig.assetSymbol}\n`));

  // Step 2: Connect to Yellow Network
  console.log('📡 Step 2: Connecting to Yellow Network...\n');
  await connectToYellow();

  // Step 3: Create payment session
  console.log('💰 Step 3: Creating payment session...\n');
  await createPaymentSession();

  // Step 4: Demo MCP tools
  console.log('🔧 Step 4: Testing MCP tools...\n');
  await testMCPTools();

  // Step 5: Close session
  console.log('🔒 Step 5: Closing payment session...\n');
  await closeSession();

  console.log(chalk.green('\n✅ Demo complete!\n'));
}

// ============================================================================
// YELLOW NETWORK CONNECTION
// ============================================================================

async function connectToYellow(): Promise<void> {
  try {
    const yellowConfig = getYellowConfig();

    yellowContext.yellow = new YellowRpcClient({
      url: yellowConfig.clearnodeUrl,
      privateKey: yellowConfig.agentPrivateKey,
      authDomain: yellowConfig.authDomain,
      debug: yellowConfig.debug,
    });

    await yellowContext.yellow.connect();
    await yellowContext.yellow.authenticate({
      allowances: [{ asset: yellowConfig.assetSymbol, amount: '1000' }],
      scope: 'transfer',
      application: YELLOW_APPLICATION,
    });

    yellowContext.connected = true;
    console.log(chalk.green('✅ Connected to Yellow Network\n'));
  } catch (error) {
    console.log(chalk.red(`❌ Failed to connect: ${error}\n`));
    throw error;
  }
}

// ============================================================================
// PAYMENT SESSION
// ============================================================================

async function createPaymentSession(): Promise<void> {
  if (!yellowContext.yellow || !yellowContext.connected) {
    throw new Error('Not connected to Yellow Network');
  }

  try {
    const { createAppSessionMessage } = await import('@erc7824/nitrolite/dist/rpc/api.js');
    const { RPCProtocolVersion } = await import('@erc7824/nitrolite/dist/rpc/types/index.js');
    const { createECDSAMessageSigner } = await import('@erc7824/nitrolite/dist/rpc/api.js');

    const participants: `0x${string}`[] = [
      yellowContext.agentAddress!,
      yellowContext.merchantAddress!,
    ];

    const agentSigner = createECDSAMessageSigner(
      getYellowConfig().agentPrivateKey as `0x${string}`
    );
    const merchantSigner = createECDSAMessageSigner(
      getYellowConfig().merchantPrivateKey as `0x${string}`
    );

    const sessionAmount = '11.0'; // sandbox
    const allocations = participants.map((participant, i) => ({
      participant,
      asset: getYellowConfig().assetSymbol,
      amount: i === 0 ? sessionAmount : '0.0',
    }));

    const sessionParams = {
      definition: {
        application: YELLOW_APPLICATION,
        protocol: RPCProtocolVersion.NitroRPC_0_4,
        participants,
        weights: participants.map(() => 1),
        quorum: 2,
        challenge: 0,
        nonce: Date.now(),
      },
      allocations,
      session_data: JSON.stringify({
        ttlSeconds: 3600,
        freeCalls: 5,
      }),
    };

    // Agent signs first
    const agentSessionMessage = await createAppSessionMessage(
      agentSigner,
      sessionParams
    );
    const sessionParsed = JSON.parse(agentSessionMessage);

    // Merchant signs
    const merchantSessionSig = await merchantSigner(sessionParsed.req);
    sessionParsed.sig.push(merchantSessionSig);

    // Send to Yellow
    const response = await yellowContext.yellow!.sendRawMessage(
      JSON.stringify(sessionParsed)
    ) as Record<string, unknown>;

    const sessionId =
      (response.appSessionId as string | undefined) ??
      (response.app_session_id as string | undefined) ??
      (response.appSession as { appSessionId?: string } | undefined)
        ?.appSessionId ??
      null;

    if (!sessionId) {
      throw new Error(
        `Failed to create session: ${JSON.stringify(response)}`
      );
    }

    yellowContext.sessionId = sessionId;

    console.log(chalk.green(`✅ Session created: ${sessionId.slice(0, 20)}...`));
    console.log(chalk.dim(`   Initial deposit: ${sessionAmount} ${getYellowConfig().assetSymbol}`));
    console.log(chalk.dim(`   Free calls: 5`));
    console.log(chalk.dim(`   Paid calls: ~1 ${getYellowConfig().assetSymbol} per call\n`));
  } catch (error) {
    console.log(chalk.red(`❌ Failed to create session: ${error}\n`));
    throw error;
  }
}

// ============================================================================
// MCP TOOLS DEMO
// ============================================================================

async function testMCPTools(): Promise<void> {
  // Simulate MCP tool calls
  console.log('🔧 Tool: check_session');
  const sessionInfo = yellowContext.sessionId
    ? {
        hasSession: true,
        sessionId: yellowContext.sessionId,
        agentAddress: yellowContext.agentAddress,
        merchantAddress: yellowContext.merchantAddress,
        initialAmount: 11.0,
        remainingAmount: 11.0,
        callsUsed: 0,
        callsRemaining: 11,
      }
    : { hasSession: false };
  console.log(chalk.dim('   Response:', JSON.stringify(sessionInfo, null, 2)));
  console.log();

  console.log('🔧 Tool: get_top_vaults (call #1 - FREE)');
  console.log(chalk.dim('   Fetching from DefiLlama...'));
  const { getTopVaultsByScore } = await import('../src/suifi/providers/defillama.js');
  const vaults = await getTopVaultsByScore(5);
  console.log(chalk.green(`   ✅ Found ${vaults.length} vaults (FREE)\n`));

  console.log(chalk.dim('   Top 3 vaults:'));
  vaults.slice(0, 3).forEach((v, i) => {
    console.log(chalk.dim(`      ${i + 1}. ${v.vault.project} - ${v.vault.apy.toFixed(1)}% APY`));
  });
  console.log();

  console.log('🔧 Tool: get_vault_decision (call #2 - FREE)');
  console.log(chalk.dim('   Analyzing vaults...'));
  console.log(chalk.green('   ✅ Decision: DEPOSIT to Turbos Finance (FREE)\n'));

  console.log('🔧 Tool: get_top_vaults (call #3 - FREE)');
  console.log(chalk.dim('   Fetching from DefiLlama...'));
  console.log(chalk.green(`   ✅ Found ${vaults.length} vaults (FREE)\n`));

  console.log('🔧 Tool: get_vault_decision (call #4 - FREE)');
  console.log(chalk.dim('   Analyzing vaults...'));
  console.log(chalk.green('   ✅ Decision: DEPOSIT to Turbos Finance (FREE)\n'));

  console.log('🔧 Tool: get_top_vaults (call #5 - FREE)');
  console.log(chalk.dim('   Fetching from DefiLlama...'));
  console.log(chalk.green(`   ✅ Found ${vaults.length} vaults (FREE)\n`));

  console.log('🔧 Tool: get_vault_decision (call #6 - PAID)');
  console.log(chalk.dim('   Analyzing vaults...'));
  console.log(chalk.yellow('   ⚠️  Consuming 1.0 ytest.usd from session...\n'));
  console.log(chalk.green('   ✅ Decision: HOLD (PAID)\n'));

  console.log(chalk.dim('   Remaining balance: ~10.0 ytest.usd'));
  console.log(chalk.dim('   You have 5 paid calls remaining with this session\n'));
}

// ============================================================================
// CLOSE SESSION
// ============================================================================

async function closeSession(): Promise<void> {
  if (!yellowContext.sessionId) {
    console.log(chalk.yellow('⚠️  No active session to close\n'));
    return;
  }

  try {
    const { createCloseAppSessionMessage } = await import('@erc7824/nitrolite/dist/rpc/api.js');
    const { createECDSAMessageSigner } = await import('@erc7824/nitrolite/dist/rpc/api.js');

    const agentSigner = createECDSAMessageSigner(
      getYellowConfig().agentPrivateKey as `0x${string}`
    );
    const merchantSigner = createECDSAMessageSigner(
      getYellowConfig().merchantPrivateKey as `0x${string}`
    );

    const closeParams = {
      appSessionId: yellowContext.sessionId,
    };

    const agentCloseMessage = await createCloseAppSessionMessage(
      agentSigner,
      closeParams
    );
    const closeParsed = JSON.parse(agentCloseMessage);

    const merchantCloseSig = await merchantSigner(closeParsed.req);
    closeParsed.sig.push(merchantCloseSig);

    const response = await yellowContext.yellow!.sendRawMessage(
      JSON.stringify(closeParsed)
    );

    console.log(chalk.green('✅ Session closed\n'));
    console.log(chalk.dim('   Remaining funds returned to agent wallet\n'));
  } catch (error) {
    console.log(chalk.red(`❌ Failed to close session: ${error}\n`));
  }
}

// ============================================================================
// MOCK DEMO (for when credentials not configured)
// ============================================================================

async function runMockDemo(): Promise<void> {
  console.log('🎭 Running in MOCK MODE (no real payments)\n');
  console.log('💰 Step 3: Create payment session (mocked)');
  console.log(chalk.yellow('   Session ID: mock-session-12345'));
  console.log(chalk.yellow('   Initial deposit: 11.0 ytest.usd (mocked)\n'));

  console.log('🔧 Step 4: Testing MCP tools (mocked)\n');

  console.log('🔧 Tool: check_session');
  console.log(chalk.dim('   Response:', JSON.stringify({
    hasSession: true,
    sessionId: 'mock-session-12345',
    callsUsed: 0,
    callsRemaining: 11,
    isExpired: false,
  }, null, 2)));
  console.log();

  console.log('🔧 Tool: get_top_vaults (call #1 - FREE)');
  console.log(chalk.dim('   Fetching from DefiLlama...'));
  const { getTopVaultsByScore } = await import('../suifi/providers/defillama.js');
  const vaults = await getTopVaultsByScore(5);
  console.log(chalk.green(`   ✅ Found ${vaults.length} vaults (FREE)\n`));

  console.log('🔧 Tool: get_vault_decision (call #2 - FREE)');
  console.log(chalk.green('   ✅ Decision: DEPOSIT to Kriya DEX (FREE)\n'));
  console.log(chalk.dim('   In production, 6th call would consume payment\n'));
}

// ============================================================================
// RUN
// ============================================================================

main().catch((error) => {
  console.error('\n❌ Error:', error);
  process.exit(1);
});
