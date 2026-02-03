/**
 * Sentifi - AI Cross-Chain Trading Agent
 *
 * Main entry point for the LI.FI + eXpress402 integration.
 * Implements the monitor → decide → act loop.
 *
 * Usage:
 *   npm run sentifi              # Run agent
 *   npm run sentifi:demo         # Run in demo mode (no real execution)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  createAppSessionMessage,
  createCloseAppSessionMessage,
  createECDSAMessageSigner,
} from '@erc7824/nitrolite/dist/rpc/api.js';
import { RPCProtocolVersion } from '@erc7824/nitrolite/dist/rpc/types/index.js';
import { privateKeyToAccount } from 'viem/accounts';

import { YellowRpcClient } from '../yellow/rpc.js';
import { getAgentConfig, validateConfig, printConfigSummary } from './config.js';
import { monitor, createMonitorState, type MonitorState } from './monitor.js';
import { decide } from './decide.js';
import { execute, initLifi } from './execute.js';
import type { AgentConfig, AgentState, AgentHistoryEntry } from './types.js';
import {
  printBanner,
  logMonitor,
  logDecision,
  logExecution,
  logAgentState,
  logError,
  logWaiting,
  logDemoMode,
} from './logger.js';

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse allocations from environment
 */
function parseAllocations(
  participants: `0x${string}`[],
  allocationsRaw: string,
  assetSymbol: string,
): Array<{ participant: `0x${string}`; asset: string; amount: string }> {
  const allocationMap = JSON.parse(allocationsRaw) as Record<string, string>;
  return participants.map(participant => ({
    participant,
    asset: assetSymbol,
    amount: allocationMap[participant] ?? '0',
  }));
}

/**
 * Create Yellow app session for MCP queries
 */
async function createYellowSession(
  yellow: YellowRpcClient,
  config: AgentConfig,
): Promise<{
  appSessionId: string;
  allocations: Array<{ participant: `0x${string}`; asset: string; amount: string }>;
}> {
  const participants = [
    config.yellow.agentAddress as `0x${string}`,
    config.yellow.merchantAddress as `0x${string}`,
  ];

  const signer = createECDSAMessageSigner(config.yellow.agentPrivateKey as `0x${string}`);

  const allocationsRaw = JSON.stringify(config.yellow.sessionAllocations);
  const allocations = parseAllocations(participants, allocationsRaw, config.yellow.assetSymbol);

  const message = await createAppSessionMessage(signer, {
    definition: {
      application: 'eXpress402-sentifi',
      protocol: RPCProtocolVersion.NitroRPC_0_4,
      participants,
      weights: [1, 1],
      quorum: 1,
      challenge: 0,
      nonce: Date.now(),
    },
    allocations,
    session_data: JSON.stringify({ ttlSeconds: config.yellow.sessionTtlSeconds }),
  });

  const response = (await yellow.sendRawMessage(message)) as Record<string, unknown>;
  const appSessionId =
    (response.appSessionId as string | undefined) ??
    (response.app_session_id as string | undefined) ??
    (response.appSession as { appSessionId?: string } | undefined)?.appSessionId;

  if (!appSessionId) {
    throw new Error(`App session creation failed: ${JSON.stringify(response)}`);
  }

  return { appSessionId, allocations };
}

/**
 * Close Yellow app session
 */
async function closeYellowSession(
  yellow: YellowRpcClient,
  config: AgentConfig,
  appSessionId: string,
  monitorState: MonitorState,
): Promise<void> {
  const participants = [
    config.yellow.agentAddress as `0x${string}`,
    config.yellow.merchantAddress as `0x${string}`,
  ];

  const initialAllocation = parseFloat(
    config.yellow.sessionAllocations[config.yellow.agentAddress] ?? '0',
  );
  const remaining = initialAllocation - monitorState.totalSpent;

  const closeAllocations = participants.map(participant => ({
    participant,
    asset: config.yellow.assetSymbol,
    amount:
      participant.toLowerCase() === config.yellow.agentAddress.toLowerCase()
        ? remaining.toString()
        : monitorState.totalSpent.toString(),
  }));

  const signer = createECDSAMessageSigner(config.yellow.agentPrivateKey as `0x${string}`);
  const closeMessage = await createCloseAppSessionMessage(signer, {
    app_session_id: appSessionId as `0x${string}`,
    allocations: closeAllocations,
  });

  await yellow.sendRawMessage(closeMessage);
}

/**
 * Main agent loop
 */
async function runAgent(config: AgentConfig): Promise<void> {
  const state: AgentState = {
    isRunning: true,
    iteration: 0,
    history: [],
  };

  // Get wallet address for portfolio tracking
  const walletAccount = privateKeyToAccount(config.wallet.privateKey as `0x${string}`);
  const walletAddress = walletAccount.address;

  console.log(`\n  Wallet: ${walletAddress}`);

  // Check demo mode
  const isDemoMode = process.env.SENTIFI_DEMO_MODE === 'true';
  if (isDemoMode) {
    logDemoMode();
  }

  // Initialize LI.FI
  initLifi(config.lifi.integratorId);

  // Connect to Yellow Network
  console.log('\n  Connecting to Yellow Network...');
  const yellow = new YellowRpcClient({
    url: config.yellow.clearnodeUrl,
    privateKey: config.yellow.agentPrivateKey,
    debug: false,
  });

  await yellow.connect();
  console.log('  ✓ Connected to clearnode');

  // Authenticate
  await yellow.authenticate({
    allowances: [{ asset: config.yellow.assetSymbol, amount: '1000' }],
    scope: 'transfer',
  });
  console.log('  ✓ Authenticated');

  // Create app session
  console.log('\n  Creating prepaid session for MCP queries...');
  const { appSessionId } = await createYellowSession(yellow, config);
  console.log(`  ✓ Session created: ${appSessionId.slice(0, 20)}...`);

  // Start MCP client
  console.log('\n  Starting MCP server...');
  const transport = new StdioClientTransport({
    command: 'bash',
    args: ['-lc', 'npm run dev'],
    env: Object.fromEntries(
      Object.entries(process.env).filter(([_, v]) => v !== undefined),
    ) as Record<string, string>,
    stderr: 'pipe',
  });

  const mcpClient = new Client({ name: 'sentifi-agent', version: '1.0.0' });
  await mcpClient.connect(transport);
  console.log('  ✓ MCP client connected');

  // Initialize monitor state
  const pricePerCall = Number(process.env.YELLOW_PRICE_PER_CALL ?? '0.1');
  const monitorState = createMonitorState(pricePerCall);

  // Main loop
  console.log('\n  Starting agent loop...');

  try {
    while (state.isRunning) {
      state.iteration++;

      // Check iteration limit
      if (config.maxIterations && state.iteration > config.maxIterations) {
        console.log(`\n  Reached max iterations (${config.maxIterations})`);
        break;
      }

      // ===== MONITOR =====
      let monitorResult;
      try {
        monitorResult = await monitor(mcpClient, config, appSessionId, walletAddress, monitorState);
        logMonitor(monitorResult, state.iteration);
        state.lastMonitor = monitorResult;
      } catch (error) {
        logError('Monitor', error);
        await sleep(config.pollingIntervalMs);
        continue;
      }

      // Check session balance
      if (monitorResult.session.remaining < pricePerCall) {
        console.log('\n  ⚠️  Session balance exhausted');
        break;
      }

      // ===== DECIDE =====
      let action;
      try {
        action = decide(monitorResult, config);
        logDecision(action);
        state.lastAction = action ?? undefined;
      } catch (error) {
        logError('Decide', error);
        await sleep(config.pollingIntervalMs);
        continue;
      }

      // ===== ACT =====
      let executionResult;
      if (action) {
        try {
          executionResult = await execute(action, config);
          logExecution(executionResult);
          state.lastExecution = executionResult;
        } catch (error) {
          logError('Execute', error);
          executionResult = { success: false, error: String(error) };
        }
      } else {
        executionResult = { success: true }; // HOLD is always successful
      }

      // Record history
      const historyEntry: AgentHistoryEntry = {
        timestamp: new Date(),
        iteration: state.iteration,
        sentiment: monitorResult.sentiment.score,
        action: action?.type ?? 'HOLD',
        txHash: executionResult.txHash,
        success: executionResult.success,
      };
      state.history.push(historyEntry);

      // Wait before next iteration
      if (state.isRunning && (!config.maxIterations || state.iteration < config.maxIterations)) {
        logWaiting(config.pollingIntervalMs / 1000);
        await sleep(config.pollingIntervalMs);
      }
    }
  } catch (error) {
    logError('Agent loop', error);
  } finally {
    // Cleanup
    state.isRunning = false;

    console.log('\n  Shutting down...');

    // Close Yellow session
    try {
      await closeYellowSession(yellow, config, appSessionId, monitorState);
      console.log('  ✓ Yellow session closed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ⚠️  Failed to close session: ${message}`);
    }

    // Close MCP client
    await mcpClient.close();
    console.log('  ✓ MCP client closed');

    // Print final summary
    logAgentState(state);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  printBanner();

  // Load and validate config
  let config: AgentConfig;
  try {
    config = getAgentConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Configuration error: ${message}`);
    process.exit(1);
  }

  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.error('Configuration errors:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  printConfigSummary(config);

  // Run the agent
  await runAgent(config);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n  Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n  Received SIGTERM, shutting down...');
  process.exit(0);
});

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
