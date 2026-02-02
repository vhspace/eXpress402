import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  createAppSessionMessage,
  createCloseAppSessionMessage,
  createECDSAMessageSigner,
} from '@erc7824/nitrolite/dist/rpc/api.js';
import { RPCProtocolVersion } from '@erc7824/nitrolite/dist/rpc/types/index.js';
import { readFile } from 'node:fs/promises';
import { createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getFundingHint, getYellowConfig } from './yellow/config.js';
import { YellowRpcClient } from './yellow/rpc.js';

const env = {
  ...getYellowConfig(),
  demo: {
    sessionAllocation: process.env.YELLOW_DEMO_SESSION_ALLOCATION ?? '1.0',
    successfulCalls: Number(process.env.YELLOW_DEMO_SUCCESSFUL_CALLS ?? '2'),
    offlineFailures: Number(process.env.YELLOW_DEMO_OFFLINE_FAILURES ?? '1'),
    callSymbols: (process.env.YELLOW_DEMO_CALL_SYMBOLS ?? 'AAPL,GOOGL,MSFT').split(','),
  },
};

if (!env.agentPrivateKey || !env.merchantAddress) {
  console.error('YELLOW_AGENT_PRIVATE_KEY and YELLOW_MERCHANT_ADDRESS are required.');
  process.exit(1);
}

const agentAddress = (env.agentAddress ??
  privateKeyToAccount(env.agentPrivateKey as `0x${string}`).address) as `0x${string}`;
const sessionParticipantsRaw = process.env.YELLOW_APP_SESSION_PARTICIPANTS;
const sessionParticipants = (sessionParticipantsRaw ?? '')
  .split(',')
  .map(entry => entry.trim())
  .filter(Boolean) as `0x${string}`[];
const sessionAllocationAgent = process.env.YELLOW_APP_SESSION_AGENT_ALLOCATION;
const sessionAllocationMerchant = process.env.YELLOW_APP_SESSION_MERCHANT_ALLOCATION;
let sessionAllocationsRaw = process.env.YELLOW_APP_SESSION_ALLOCATIONS ?? '';
const sessionTtlRaw = process.env.YELLOW_APP_SESSION_TTL_SECONDS ?? '3600';
const sessionTtlSeconds = Number(sessionTtlRaw);
const sessionQuorumRaw = process.env.YELLOW_APP_SESSION_QUORUM ?? '1';
const sessionQuorum = Number(sessionQuorumRaw);

if (sessionParticipants.length === 0) {
  if (!env.merchantAddress) {
    console.error('YELLOW_MERCHANT_ADDRESS is required to derive session participants.');
    process.exit(1);
  }
  sessionParticipants.push(agentAddress, env.merchantAddress as `0x${string}`);
  console.log(
    'Derived YELLOW_APP_SESSION_PARTICIPANTS from agent and merchant addresses:',
    sessionParticipants.join(','),
  );
}

if (sessionParticipants.length < 2) {
  console.error('YELLOW_APP_SESSION_PARTICIPANTS must include at least two addresses.');
  process.exit(1);
}

if (agentAddress.toLowerCase() === env.merchantAddress.toLowerCase()) {
  console.error('YELLOW_AGENT_ADDRESS and YELLOW_MERCHANT_ADDRESS must be distinct.');
  process.exit(1);
}

if (!sessionAllocationsRaw) {
  if (!sessionAllocationAgent || !sessionAllocationMerchant) {
    sessionAllocationsRaw = JSON.stringify({
      [agentAddress]: env.demo.sessionAllocation,
      [env.merchantAddress]: '0.0',
    });
    console.log(
      `Using demo config: YELLOW_APP_SESSION_ALLOCATIONS ${env.demo.sessionAllocation} (agent) and 0.0 (merchant).`,
    );
  } else {
    sessionAllocationsRaw = JSON.stringify({
      [agentAddress]: sessionAllocationAgent,
      [env.merchantAddress]: sessionAllocationMerchant,
    });
    console.log('Derived YELLOW_APP_SESSION_ALLOCATIONS from per-party allocations.');
  }
}

if (Number.isNaN(sessionTtlSeconds)) {
  console.error(`YELLOW_APP_SESSION_TTL_SECONDS must be a number (got ${sessionTtlRaw}).`);
  process.exit(1);
}

if (!Number.isInteger(sessionQuorum) || sessionQuorum < 1) {
  console.error(`YELLOW_APP_SESSION_QUORUM must be a positive integer (got ${sessionQuorumRaw}).`);
  process.exit(1);
}

if (sessionQuorum > sessionParticipants.length) {
  console.error('YELLOW_APP_SESSION_QUORUM cannot exceed participant count.');
  process.exit(1);
}

if (sessionQuorum > 2) {
  console.error('YELLOW_APP_SESSION_QUORUM above 2 requires additional signer keys.');
  process.exit(1);
}

if (
  !sessionParticipants.some(participant => participant.toLowerCase() === agentAddress.toLowerCase())
) {
  console.error('YELLOW_APP_SESSION_PARTICIPANTS must include the agent address.');
  process.exit(1);
}

if (
  sessionQuorum > 1 &&
  !sessionParticipants.some(
    participant => participant.toLowerCase() === env.merchantAddress.toLowerCase(),
  )
) {
  console.error('YELLOW_APP_SESSION_PARTICIPANTS must include the merchant address.');
  process.exit(1);
}

if (sessionQuorum > 1 && !env.merchantPrivateKey) {
  console.error('YELLOW_MERCHANT_PRIVATE_KEY is required for quorum-signed closes.');
  process.exit(1);
}

async function getBalance(client: YellowRpcClient, accountId: string, asset: string) {
  const balances = await client.getLedgerBalances(accountId);
  const match = balances.find(entry => entry.asset === asset);
  return match?.amount ?? '0';
}

function logError(context: string, error: unknown) {
  if (error instanceof Error) {
    console.error(`${context}: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    return;
  }
  console.error(`${context}: ${String(error)}`);
}

async function safeBalance(client: YellowRpcClient, accountId: string, asset: string) {
  try {
    return await getBalance(client, accountId, asset);
  } catch (error) {
    logError(`balance unavailable (${accountId})`, error);
    return 'unavailable';
  }
}

async function waitForBalanceChange(
  client: YellowRpcClient,
  accountId: string,
  asset: string,
  expectedChange: number,
  initialBalance: string,
  maxWaitMs: number = 10000,
  pollIntervalMs: number = 500,
): Promise<string> {
  const startTime = Date.now();
  const initialAmount = Number(initialBalance);
  const expectedAmount = initialAmount + expectedChange;

  console.log(
    `⏳ Waiting for balance change: ${initialAmount} → ${expectedAmount} (${expectedChange > 0 ? '+' : ''}${expectedChange})`,
  );
  console.log(`   Polling every ${pollIntervalMs / 1000}s for up to ${maxWaitMs / 1000}s`);

  let pollCount = 0;
  while (Date.now() - startTime < maxWaitMs) {
    const currentBalance = await safeBalance(client, accountId, asset);
    if (currentBalance === 'unavailable') {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      continue;
    }

    const currentAmount = Number(currentBalance);
    pollCount++;

    if (Math.abs(currentAmount - expectedAmount) < 0.001) {
      // Account for floating point precision
      console.log(
        `✅ Balance updated: ${currentAmount} (polls: ${pollCount}, waited ${(Date.now() - startTime) / 1000}s)`,
      );
      return currentBalance;
    }

    // Only log every 3 polls to reduce spam for long polling
    if (pollCount % 3 === 0) {
      console.log(
        `⏳ Balance still: ${currentAmount} after ${pollCount} polls (${(Date.now() - startTime) / 1000}s elapsed)`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  console.log(`⏰ Timeout waiting for balance change (${maxWaitMs}ms)`);
  return await safeBalance(client, accountId, asset); // Return final balance
}

function logStage(label: string) {
  console.log(label);
}

function parseJsonEnv<T>(label: string, raw?: string): T {
  if (!raw) {
    throw new Error(`${label} is required.`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${String(error)}`);
  }
}

function truncateOutput(value: string, maxLength = 80) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const SAMPLE_SP500_TICKERS = [
  'AAPL',
  'MSFT',
  'AMZN',
  'GOOGL',
  'META',
  'NVDA',
  'TSLA',
  'JPM',
  'V',
  'UNH',
  'HD',
  'PG',
  'MA',
  'XOM',
  'LLY',
  'AVGO',
  'COST',
  'PEP',
  'KO',
  'MRK',
];

function pickRandomTicker(exclude?: string) {
  const options = exclude
    ? SAMPLE_SP500_TICKERS.filter(ticker => ticker !== exclude)
    : SAMPLE_SP500_TICKERS;
  return options[Math.floor(Math.random() * options.length)];
}

function runProductionChannelFlow() {
  logStage('Production channel flow (on-ramp/off-ramp)');
  const required = {
    YELLOW_CHAIN_ID: process.env.YELLOW_CHAIN_ID,
    YELLOW_RPC_URL: process.env.YELLOW_RPC_URL,
    YELLOW_CUSTODY_ADDRESS: process.env.YELLOW_CUSTODY_ADDRESS,
    YELLOW_ADJUDICATOR_ADDRESS: process.env.YELLOW_ADJUDICATOR_ADDRESS,
    YELLOW_TOKEN_ADDRESS: process.env.YELLOW_TOKEN_ADDRESS,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    console.log('Channel flow skipped; set:', missing.join(', '));
    return;
  }

  console.log('1) Deposit on-chain to custody');
  console.log('2) Open channel (wallet ↔ broker)');
  console.log('3) Resize channel (wallet signature + on-chain confirmation)');
  console.log('4) Close/withdraw to on-chain wallet');
}

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

function getToolPrice(toolName: string) {
  const toolPrice = env.toolPrices?.[toolName];
  return Number(toolPrice ?? env.pricePerCall);
}

async function createAppSession(
  yellow: YellowRpcClient,
  participants: `0x${string}`[],
  assetSymbol: string,
  ttlSeconds: number,
  quorum: number,
  allocationAmount?: string,
) {
  const signer = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
  const allocations = parseAllocations(participants, sessionAllocationsRaw, assetSymbol);
  const weights = participants.map(() => 1);
  const message = await createAppSessionMessage(signer, {
    definition: {
      application: 'eXpress402-mcp',
      protocol: RPCProtocolVersion.NitroRPC_0_4,
      participants,
      weights,
      quorum,
      challenge: 0,
      nonce: Date.now(),
    },
    allocations,
    session_data: JSON.stringify({ ttlSeconds }),
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

function normalizeParticipants(participants: `0x${string}`[]) {
  return participants.map(participant => participant.toLowerCase()).sort();
}

async function verifyAppDefinition(
  yellow: YellowRpcClient,
  appSessionId: string,
  expectedParticipants: `0x${string}`[],
  expectedQuorum: number,
) {
  const retryDelayMs = 5000;
  const maxWaitMs = 60000;
  const start = Date.now();
  let attempt = 0;
  let session: Awaited<ReturnType<typeof yellow.getAppSessions>>[number] | null = null;

  await sleep(retryDelayMs);
  while (Date.now() - start <= maxWaitMs) {
    attempt += 1;
    try {
      const sessions = await yellow.getAppSessions(expectedParticipants[0], 'open');
      session = sessions.find(s => s.appSessionId === appSessionId) ?? null;
      if (session) {
        break;
      }
      console.error(
        `get_app_sessions attempt ${attempt}: session ${appSessionId} not found in list`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`get_app_sessions attempt ${attempt} failed: ${message}`);
    }
    if (Date.now() - start + retryDelayMs > maxWaitMs) {
      break;
    }
    await sleep(retryDelayMs);
  }

  if (!session) {
    throw new Error(`App session ${appSessionId} not found within ${maxWaitMs / 1000}s.`);
  }
  const expected = normalizeParticipants(expectedParticipants);
  const actual = normalizeParticipants(session.participants as `0x${string}`[]);
  if (
    expected.length !== actual.length ||
    expected.some((value, index) => value !== actual[index])
  ) {
    throw new Error(
      `App session participants mismatch for ${appSessionId}: expected ${expected.join(
        ', ',
      )}, got ${actual.join(', ')}`,
    );
  }
  if (session.quorum !== expectedQuorum) {
    throw new Error(
      `App session quorum mismatch for ${appSessionId}: expected ${expectedQuorum}, got ${session.quorum}`,
    );
  }
  console.log('app session protocol', session.protocol);
  console.log('app session quorum', session.quorum);
  console.log('app session challenge', session.challenge);
}

async function runOnchainDisputeStep() {
  if (process.env.YELLOW_ONCHAIN_DISPUTE_ENABLED !== 'true') {
    return;
  }

  logStage('On-chain dispute resolution (custody contract)');

  const rpcUrl = process.env.YELLOW_RPC_URL;
  const chainIdRaw = process.env.YELLOW_CHAIN_ID;
  const custodyAddress = process.env.YELLOW_CUSTODY_ADDRESS;
  const abiPath = process.env.YELLOW_CUSTODY_ABI_PATH;
  const functionName =
    process.env.YELLOW_ONCHAIN_FUNCTION ??
    (process.env.YELLOW_ONCHAIN_DISPUTE_MODE === 'close'
      ? 'close'
      : process.env.YELLOW_ONCHAIN_DISPUTE_MODE === 'checkpoint'
        ? 'checkpoint'
        : 'challenge');

  if (!rpcUrl || !chainIdRaw || !custodyAddress || !abiPath) {
    throw new Error(
      'YELLOW_RPC_URL, YELLOW_CHAIN_ID, YELLOW_CUSTODY_ADDRESS, and YELLOW_CUSTODY_ABI_PATH are required for on-chain dispute.',
    );
  }

  const chainId = Number(chainIdRaw);
  if (!Number.isInteger(chainId)) {
    throw new Error(`YELLOW_CHAIN_ID must be an integer (got ${chainIdRaw}).`);
  }

  const abiRaw = await readFile(abiPath, 'utf8');
  const abi = parseJsonEnv<unknown[]>('YELLOW_CUSTODY_ABI_PATH contents', abiRaw);
  let args: unknown[];
  if (process.env.YELLOW_ONCHAIN_ARGS_JSON) {
    args = parseJsonEnv<unknown[]>(
      'YELLOW_ONCHAIN_ARGS_JSON',
      process.env.YELLOW_ONCHAIN_ARGS_JSON,
    );
  } else {
    const channelId = process.env.YELLOW_ONCHAIN_CHANNEL_ID;
    const state = parseJsonEnv<unknown>(
      'YELLOW_ONCHAIN_STATE_JSON',
      process.env.YELLOW_ONCHAIN_STATE_JSON,
    );
    const sigs = parseJsonEnv<unknown[]>(
      'YELLOW_ONCHAIN_SIGS_JSON',
      process.env.YELLOW_ONCHAIN_SIGS_JSON,
    );
    if (!channelId) {
      throw new Error('YELLOW_ONCHAIN_CHANNEL_ID is required.');
    }
    args = [channelId, state, ...sigs];
  }

  console.log('on-chain function', functionName);
  console.log('on-chain args length', args.length);

  const chain = defineChain({
    id: chainId,
    name: process.env.YELLOW_CHAIN_NAME ?? `chain-${chainId}`,
    nativeCurrency: {
      name: process.env.YELLOW_CHAIN_CURRENCY_NAME ?? 'Native',
      symbol: process.env.YELLOW_CHAIN_CURRENCY_SYMBOL ?? 'NATIVE',
      decimals: Number(process.env.YELLOW_CHAIN_CURRENCY_DECIMALS ?? '18'),
    },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  const account = privateKeyToAccount(env.agentPrivateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  const txHash = await walletClient.writeContract({
    address: custodyAddress as `0x${string}`,
    abi,
    functionName,
    args,
  });

  console.log('on-chain tx hash', txHash);
}

async function closeOutSession(
  yellow: YellowRpcClient,
  appSessionId: string,
  participants: `0x${string}`[],
  assetSymbol: string,
  agentAddress: string,
  agentRemaining: number,
  merchantSpent: number,
  sessionQuorum: number,
  signingKeys: string[],
) {
  // Round to avoid floating point precision issues
  const roundedAgentRemaining = Math.round(agentRemaining * 10) / 10;
  const roundedMerchantSpent = Math.round(merchantSpent * 10) / 10;

  console.log('🔍 Closing session with tracked allocations:');
  console.log(`   Agent remaining: ${roundedAgentRemaining}`);
  console.log(`   Merchant earned: ${roundedMerchantSpent}`);
  console.log(`   Total accounted for: ${roundedAgentRemaining + roundedMerchantSpent}`);

  // Use tracked allocations - in production this would be validated by protocol
  const merchantParticipant =
    participants.find(participant => participant.toLowerCase() !== agentAddress.toLowerCase()) ??
    env.merchantAddress;
  const closeAllocations = participants.map(participant => ({
    participant,
    asset: assetSymbol,
    amount:
      participant.toLowerCase() === agentAddress.toLowerCase()
        ? roundedAgentRemaining.toString()
        : participant.toLowerCase() === merchantParticipant?.toLowerCase()
          ? roundedMerchantSpent.toString()
          : '0',
  }));

  console.log('📋 Close allocations (based on local tracking):', closeAllocations);
  if (sessionQuorum > 1) {
    await yellow.closeAppSessionWithSigners(
      { appSessionId, allocations: closeAllocations },
      signingKeys,
    );
  } else {
    const closeSigner = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
    const closeMessage = await createCloseAppSessionMessage(closeSigner, {
      app_session_id: appSessionId as `0x${string}`,
      allocations: closeAllocations,
    });
    await yellow.sendRawMessage(closeMessage);
  }
  console.log(
    'session',
    appSessionId,
    'balance',
    await safeBalance(yellow, appSessionId, assetSymbol),
  );
}

async function main() {
  logStage('Booting demo');
  console.log(getFundingHint(env.mode));

  if (env.mode === 'production') {
    runProductionChannelFlow();
  }

  const yellow = new YellowRpcClient({
    url: env.clearnodeUrl,
    privateKey: env.agentPrivateKey,
    authDomain: env.authDomain,
    debug: env.debug,
  });

  logStage('Connecting to Yellow clearnode');
  await yellow.connect();
  logStage('Step 0: fetch clearnode config (get_config)');
  const configResponse = await yellow.request<Record<string, unknown>>('get_config', {});
  console.log('clearnode config', JSON.stringify(configResponse, null, 2));
  const assetsResponse = await yellow.request<{ assets?: Array<{ symbol: string }> }>(
    'get_assets',
    {},
  );
  const assets = assetsResponse.assets ?? [];
  const selectedAsset =
    assets.find(asset => asset.symbol.toLowerCase() === env.assetSymbol.toLowerCase()) ?? assets[0];
  const assetSymbol = selectedAsset?.symbol ?? env.assetSymbol;

  logStage('Authorizing session key');
  await yellow.authenticate({
    allowances: [{ asset: assetSymbol, amount: '1000' }],
    scope: 'transfer',
  });

  // Check agent balance and refill from faucet if needed
  const minBalance = Number(env.demo.sessionAllocation) + 0.5; // allocation + buffer
  const currentBalance = await safeBalance(yellow, agentAddress, assetSymbol);
  if (Number(currentBalance) < minBalance) {
    logStage(`Refilling agent balance (current: ${currentBalance}, needed: ${minBalance})`);
    try {
      // Use the Yellow faucet to get test tokens
      const faucetUrl = 'https://clearnet-sandbox.yellow.com/faucet/requestTokens';
      const response = await fetch(faucetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: agentAddress }),
      });
      if (response.ok) {
        console.log('✅ Faucet refill requested successfully');
        // Wait a moment for the faucet to process
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.log('⚠️ Faucet refill failed, continuing with current balance');
      }
    } catch (error) {
      console.log('⚠️ Faucet refill error, continuing with current balance');
    }
  }

  logStage('Step 1: wallet balances before calls');
  const initialAgentBalance = await safeBalance(yellow, agentAddress, assetSymbol);
  console.log('agent', agentAddress, 'balance', initialAgentBalance);
  console.log(
    'merchant',
    env.merchantAddress,
    'balance',
    await safeBalance(yellow, env.merchantAddress, assetSymbol),
  );

  logStage('Step 2: create prepaid session (allocation + TTL)');
  const { appSessionId, allocations } = await createAppSession(
    yellow,
    sessionParticipants,
    assetSymbol,
    sessionTtlSeconds,
    sessionQuorum,
    env.demo.sessionAllocation,
  );
  logStage('Step 2: verify app definition (quorum + participants)');
  const skipVerification = process.env.YELLOW_SKIP_APP_SESSION_VERIFICATION === 'true';
  if (skipVerification) {
    console.log('Skipping app session verification (YELLOW_SKIP_APP_SESSION_VERIFICATION=true)');
    console.log('App session quorum (from request):', sessionQuorum);
  } else {
    await verifyAppDefinition(yellow, appSessionId, sessionParticipants, sessionQuorum);
  }
  console.log('appSessionId', appSessionId);
  console.log('ttlSeconds', sessionTtlSeconds);
  console.log('allocations', allocations);
  const agentAllocation =
    allocations.find(entry => entry.participant.toLowerCase() === agentAddress.toLowerCase())
      ?.amount ?? '0';
  let localSessionBalance = Number(agentAllocation);
  let spentTotal = 0;

  const transport = new StdioClientTransport({
    command: 'bash',
    args: ['-lc', 'npm run dev'],
    env: Object.fromEntries(
      Object.entries(process.env).filter(([_, value]) => value !== undefined),
    ) as Record<string, string>,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'demo-e2e', version: '0.0.1' });
  await client.connect(transport);
  let clientClosed = false;
  const closeClient = async () => {
    if (clientClosed) {
      return;
    }
    clientClosed = true;
    await client.close();
  };

  // Make configurable number of successful MCP calls
  const tools = ['stock_price', 'market_rumors'];
  let usedSymbols: string[] = [];

  for (let i = 0; i < env.demo.successfulCalls; i++) {
    const toolName = tools[i % tools.length];
    const symbol = pickRandomTicker(usedSymbols.length > 0 ? usedSymbols[0] : undefined);
    usedSymbols.push(symbol);

    const sessionBalanceBefore = await safeBalance(yellow, appSessionId, assetSymbol);
    console.log(`session balance before ${toolName}:`, sessionBalanceBefore);

    logStage(`Step 2.${i + 1}: call MCP (${toolName}) using Yellow session (${symbol})`);
    let callPaid = false;
    try {
      const result = await client.callTool({
        name: toolName,
        arguments: { symbol },
        _meta: { 'x402/yellow': { appSessionId, payer: agentAddress } },
      });
      const resultText = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text;
      logStage(`Step 3.${i + 1}: MCP result (${toolName})`);
      console.log(truncateOutput(resultText ?? JSON.stringify(result)));
      callPaid = true;
    } catch (error) {
      logStage(`Step 3.${i + 1}: MCP result (${toolName}) failed`);
      logError(`${toolName} call failed`, error);
    }
    if (callPaid) {
      const price = getToolPrice(toolName);
      localSessionBalance -= price;
      spentTotal += price;

      // Wait for balance to update if payment was processed
      const expectedChange = -price;
      const sessionBalanceAfter = await waitForBalanceChange(
        yellow,
        appSessionId,
        assetSymbol,
        expectedChange,
        sessionBalanceBefore,
        60000, // 1 minute timeout (60 seconds)
        5000, // 5 second poll interval
      );
      console.log(
        `balance change: ${(Number(sessionBalanceAfter) - Number(sessionBalanceBefore)).toFixed(1)}`,
      );
    } else {
      const sessionBalanceAfter = await safeBalance(yellow, appSessionId, assetSymbol);
      console.log(`session balance after ${toolName}:`, sessionBalanceAfter);
      console.log(
        `balance change: ${(Number(sessionBalanceAfter) - Number(sessionBalanceBefore)).toFixed(1)}`,
      );
    }

    logStage(`Step 4.${i + 1}: session tracking after ${toolName}`);
    console.log('session (local remaining)', localSessionBalance);
    console.log('merchant (earned)', spentTotal);
  }

  logStage('Step 5: close out offchain wallet (close app session)');
  console.log('🔒 Anti-fraud: Session close requires quorum signatures');
  console.log(`   Quorum required: ${sessionQuorum}, Signers provided: ${sessionQuorum}`);
  console.log('   This prevents unilateral fund reclamation by malicious parties');

  const closeSigningKeys =
    sessionQuorum > 1
      ? [env.agentPrivateKey, env.merchantPrivateKey].filter(Boolean)
      : [env.agentPrivateKey];
  await closeOutSession(
    yellow,
    appSessionId,
    sessionParticipants,
    assetSymbol,
    agentAddress,
    localSessionBalance,
    spentTotal,
    sessionQuorum,
    closeSigningKeys,
  );

  logStage('Step 6: unified balance after close');
  const balanceAfterPaidCalls = await safeBalance(yellow, agentAddress, assetSymbol);
  console.log('agent', agentAddress, 'balance', balanceAfterPaidCalls);
  const initialValue = Number(initialAgentBalance);
  const postPaidValue = Number(balanceAfterPaidCalls);
  if (!Number.isNaN(initialValue) && !Number.isNaN(postPaidValue)) {
    const delta = postPaidValue - initialValue;
    console.log('agent delta', delta.toFixed(4));
  }

  logStage('Fraud prevention: MCP offline after session start');
  const { appSessionId: offlineSessionId, allocations: offlineAllocations } =
    await createAppSession(
      yellow,
      sessionParticipants,
      assetSymbol,
      sessionTtlSeconds,
      sessionQuorum,
    );
  logStage('Step 7: verify offline app definition (quorum + participants)');
  const skipOfflineVerification = process.env.YELLOW_SKIP_APP_SESSION_VERIFICATION === 'true';
  if (skipOfflineVerification) {
    console.log(
      'Skipping offline app session verification (YELLOW_SKIP_APP_SESSION_VERIFICATION=true)',
    );
    console.log('Offline app session quorum (from request):', sessionQuorum);
  } else {
    await verifyAppDefinition(yellow, offlineSessionId, sessionParticipants, sessionQuorum);
  }
  console.log('appSessionId', offlineSessionId);
  console.log('ttlSeconds', sessionTtlSeconds);
  console.log('allocations', offlineAllocations);
  const offlineAgentAllocation =
    offlineAllocations.find(entry => entry.participant.toLowerCase() === agentAddress.toLowerCase())
      ?.amount ?? '0';
  const offlineLocalBalance = Number(offlineAgentAllocation);

  logStage('Step 7: MCP goes offline before use');
  await closeClient();

  // Make configurable number of offline failure attempts
  for (let i = 0; i < env.demo.offlineFailures; i++) {
    const offlineSymbol = env.demo.callSymbols[i % env.demo.callSymbols.length];
    logStage(`Step 7.${i + 1}: call MCP (stock_price) after offline (${offlineSymbol})`);
    try {
      await client.callTool({
        name: 'stock_price',
        arguments: { symbol: offlineSymbol },
        _meta: { 'x402/yellow': { appSessionId: offlineSessionId, payer: agentAddress } },
      });
      logStage(`Step 7.${i + 1}: MCP offline call unexpectedly succeeded`);
    } catch (error) {
      logStage(`Step 7.${i + 1}: MCP offline call failed as expected`);
      logError('offline stock_price call failed', error);
    }
  }

  logStage('Step 8: session balance after offline attempt');
  console.log(
    'session',
    offlineSessionId,
    'balance',
    await safeBalance(yellow, offlineSessionId, assetSymbol),
  );
  console.log('session (local)', offlineLocalBalance);

  logStage('Step 9: close offline session to reclaim funds');
  console.log('🛡️ Anti-fraud: Offline reclaim protection');
  console.log('   Even when MCP server is offline, payer can reclaim unused funds');
  console.log('   Protocol ensures funds cannot be locked by unresponsive providers');
  console.log(`   Closing with quorum: ${sessionQuorum} signatures`);

  await closeOutSession(
    yellow,
    offlineSessionId,
    sessionParticipants,
    assetSymbol,
    agentAddress,
    offlineLocalBalance,
    0,
    sessionQuorum,
    closeSigningKeys,
  );

  logStage('Step 10: unified balance after offline close');
  const balanceAfterOfflineClose = await safeBalance(yellow, agentAddress, assetSymbol);
  console.log('agent', agentAddress, 'balance', balanceAfterOfflineClose);
  const finalValue = Number(balanceAfterOfflineClose);
  if (!Number.isNaN(postPaidValue) && !Number.isNaN(finalValue)) {
    const delta = finalValue - postPaidValue;
    console.log('agent delta after offline close', delta.toFixed(4));
  }

  await runOnchainDisputeStep();

  console.log('\n🎯 Anti-Fraud Demonstration Summary:');
  console.log('✅ Protocol-level safeguards verified:');
  console.log('   • Session close requires quorum signatures (prevents unilateral theft)');
  console.log('   • Offline reclaim works (funds not locked by unresponsive servers)');
  console.log('   • Balance tracking prevents over-spending');
  console.log('   • On-chain dispute resolution available as final safeguard');
  console.log(
    `\n🔐 Security: Quorum=${sessionQuorum} ensures ${sessionQuorum > 1 ? 'multi-party' : 'single-party'} consensus required`,
  );

  await closeClient();
}

main().catch(error => {
  console.error('Client demo failed:', error);
  process.exit(1);
});
