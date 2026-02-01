import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  createAppSessionMessage,
  createCloseAppSessionMessage,
  createECDSAMessageSigner,
} from '@erc7824/nitrolite/dist/rpc/api.js';
import { RPCProtocolVersion } from '@erc7824/nitrolite/dist/rpc/types/index.js';
import { privateKeyToAccount } from 'viem/accounts';
import { getFundingHint, getYellowConfig } from './yellow/config.js';
import { YellowRpcClient } from './yellow/rpc.js';

const SANDBOX_FAUCET_URL = 'https://clearnet-sandbox.yellow.com/faucet/requestTokens';

type SessionAllocation = { participant: `0x${string}`; asset: string; amount: string };

function logStage(label: string) {
  console.log(label);
}

function truncateOutput(value: string, maxLength = 120) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function parseNumber(value: string, label: string) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function isInsufficientFunds(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('insufficient funds');
}

async function requestSandboxFunds(address: string) {
  const faucetUrl = process.env.YELLOW_FAUCET_URL ?? SANDBOX_FAUCET_URL;
  console.error(`Requesting sandbox funds from ${faucetUrl} for ${address}`);
  const response = await fetch(faucetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userAddress: address }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Faucet request failed (${response.status}): ${body}`);
  }
  console.error(`Faucet response: ${body}`);
}

async function waitForFunding(
  yellow: YellowRpcClient,
  accountId: string,
  asset: string,
  minAmount: number,
  maxAttempts = 10,
  delayMs = 2000,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const balances = await yellow.getLedgerBalances(accountId);
    const match = balances.find(entry => entry.asset === asset);
    const amount = Number(match?.amount ?? 0);
    console.error(
      `Funding check ${attempt}/${maxAttempts}: ${amount} ${asset} (target ${minAmount})`,
    );
    if (!Number.isNaN(amount) && amount >= minAmount) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  throw new Error(`Sandbox funding did not arrive for ${accountId} (${asset})`);
}

async function ensureSandboxBalance(
  yellow: YellowRpcClient,
  env: ReturnType<typeof getYellowConfig>,
  accountId: string,
  asset: string,
  minAmount: number,
  label: string,
) {
  if (env.mode !== 'development') {
    return;
  }
  if (process.env.YELLOW_AUTO_FAUCET === 'false') {
    return;
  }

  const balances = await yellow.getLedgerBalances(accountId);
  const match = balances.find(entry => entry.asset === asset);
  const amount = Number(match?.amount ?? 0);
  if (!Number.isNaN(amount) && amount >= minAmount) {
    return;
  }

  console.error(
    `${label}: insufficient sandbox balance (${amount} ${asset}). Requesting faucet funding.`,
  );
  await requestSandboxFunds(accountId);
  await waitForFunding(yellow, accountId, asset, minAmount);
}

async function resolveAssetSymbol(
  yellow: YellowRpcClient,
  env: ReturnType<typeof getYellowConfig>,
) {
  const assetsResponse = (await yellow.request('get_assets', {})) as {
    assets?: Array<{ symbol: string }>;
  };
  const assets = assetsResponse.assets ?? [];
  const selectedAsset =
    assets.find(asset => asset.symbol.toLowerCase() === env.assetSymbol.toLowerCase()) ?? assets[0];
  const assetSymbol = selectedAsset?.symbol ?? env.assetSymbol;
  if (!assetSymbol) {
    throw new Error('No asset symbol available from Yellow clearnode.');
  }
  return assetSymbol;
}

function getToolPrice(env: ReturnType<typeof getYellowConfig>, toolName: string) {
  const toolPrice = env.toolPrices?.[toolName] ?? env.pricePerCall;
  return parseNumber(toolPrice, `tool price for ${toolName}`);
}

function parseSessionConfig(
  env: ReturnType<typeof getYellowConfig>,
  agentAddress: string,
  assetSymbol: string,
) {
  const participantsRaw = process.env.YELLOW_APP_SESSION_PARTICIPANTS;
  const allocationsRaw = process.env.YELLOW_APP_SESSION_ALLOCATIONS;
  const ttlRaw = process.env.YELLOW_APP_SESSION_TTL_SECONDS;

  if (!participantsRaw || !allocationsRaw || !ttlRaw) {
    throw new Error(
      'YELLOW_APP_SESSION_PARTICIPANTS, YELLOW_APP_SESSION_ALLOCATIONS, and YELLOW_APP_SESSION_TTL_SECONDS are required for the demo flow.',
    );
  }

  const participants = participantsRaw
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean) as `0x${string}`[];

  if (participants.length < 2) {
    throw new Error('YELLOW_APP_SESSION_PARTICIPANTS must include at least two addresses.');
  }

  if (!participants.some(participant => participant.toLowerCase() === agentAddress.toLowerCase())) {
    throw new Error('YELLOW_APP_SESSION_PARTICIPANTS must include the agent address.');
  }

  const ttlSeconds = parseNumber(ttlRaw, 'YELLOW_APP_SESSION_TTL_SECONDS');

  let allocationMap: Record<string, string>;
  try {
    allocationMap = JSON.parse(allocationsRaw) as Record<string, string>;
  } catch (error) {
    throw new Error(`YELLOW_APP_SESSION_ALLOCATIONS must be JSON: ${String(error)}`);
  }

  if (typeof allocationMap !== 'object' || allocationMap === null) {
    throw new Error('YELLOW_APP_SESSION_ALLOCATIONS must be a JSON object mapping addresses.');
  }

  const normalized = new Map<string, string>();
  for (const [key, value] of Object.entries(allocationMap)) {
    if (typeof value !== 'string') {
      throw new Error(`Allocation for ${key} must be a string amount.`);
    }
    normalized.set(key.toLowerCase(), value);
  }

  const allocations = participants.map(participant => {
    const amount = normalized.get(participant.toLowerCase());
    if (!amount) {
      throw new Error(`Missing allocation for participant ${participant}.`);
    }
    return { participant, asset: assetSymbol, amount };
  });

  const requiredAmount = allocations.reduce(
    (total, allocation) =>
      total + parseNumber(allocation.amount, `allocation for ${allocation.participant}`),
    0,
  );

  return { participants, allocations, ttlSeconds, requiredAmount };
}

async function createAppSession(
  yellow: YellowRpcClient,
  agentPrivateKey: string,
  participants: `0x${string}`[],
  allocations: SessionAllocation[],
  ttlSeconds: number,
) {
  const signer = createECDSAMessageSigner(agentPrivateKey as `0x${string}`);
  const weights = participants.map(() => 1);
  const message = await createAppSessionMessage(signer, {
    definition: {
      application: 'eXpress402-mcp',
      protocol: RPCProtocolVersion.NitroRPC_0_4,
      participants,
      weights,
      quorum: 1,
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

  return appSessionId;
}

async function createPaymentPayload(options: {
  env: ReturnType<typeof getYellowConfig>;
  yellow: YellowRpcClient;
  assetSymbol: string;
  agentAddress: string;
}) {
  const { env, yellow, assetSymbol, agentAddress } = options;

  await yellow.authenticate({
    allowances: [{ asset: assetSymbol, amount: '1000' }],
    scope: 'transfer',
  });

  const pricePerCall = parseNumber(env.pricePerCall, 'YELLOW_PRICE_PER_CALL');
  await ensureSandboxBalance(
    yellow,
    env,
    agentAddress,
    assetSymbol,
    pricePerCall,
    'Per-call payment funding',
  );

  const transferRequest = {
    destination: env.merchantAddress as `0x${string}`,
    allocations: [
      {
        asset: assetSymbol,
        amount: env.pricePerCall,
      },
    ],
  };

  const autoFaucet = env.mode === 'development' && process.env.YELLOW_AUTO_FAUCET !== 'false';
  let transferResponse: { transactions?: Array<Record<string, unknown>> };

  try {
    transferResponse = (await yellow.transfer(transferRequest)) as {
      transactions?: Array<Record<string, unknown>>;
    };
  } catch (error) {
    if (!autoFaucet || !isInsufficientFunds(error)) {
      throw error;
    }
    console.error('Insufficient funds detected; requesting sandbox faucet funding.');
    await requestSandboxFunds(agentAddress);
    await waitForFunding(yellow, agentAddress, assetSymbol, pricePerCall);
    transferResponse = (await yellow.transfer(transferRequest)) as {
      transactions?: Array<Record<string, unknown>>;
    };
  }

  const transfer = transferResponse.transactions?.[0] ?? {};
  const transferId = String(transfer.id ?? transfer.transaction_id ?? '');
  const payer = String(transfer.from_account ?? transfer.sender ?? '');

  return {
    x402Version: 2,
    accepted: {
      scheme: 'yellow-offchain',
      network: env.network,
      amount: env.pricePerCall,
      asset: assetSymbol,
      payTo: env.merchantAddress,
      maxTimeoutSeconds: 60,
      extra: {
        settlement: 'yellow',
      },
    },
    payload: {
      transferId,
      payer,
      amount: env.pricePerCall,
      asset: assetSymbol,
      to: env.merchantAddress,
    },
  };
}

async function runPerCallFlow(
  client: Client,
  env: ReturnType<typeof getYellowConfig>,
  yellow: YellowRpcClient,
  assetSymbol: string,
  agentAddress: string,
) {
  logStage('Per-call payment flow');

  const stockPayment = await createPaymentPayload({ env, yellow, assetSymbol, agentAddress });
  const stock = await client.callTool({
    name: 'stock_price',
    arguments: { symbol: 'AAPL' },
    _meta: { 'x402/payment': stockPayment },
  });
  console.log(
    'stock_price:',
    Array.isArray(stock.content) ? stock.content[0]?.text : JSON.stringify(stock),
  );

  const rumorsPayment = await createPaymentPayload({ env, yellow, assetSymbol, agentAddress });
  const rumors = await client.callTool({
    name: 'market_rumors',
    arguments: { symbol: 'AAPL' },
    _meta: { 'x402/payment': rumorsPayment },
  });
  console.log(
    'market_rumors:',
    Array.isArray(rumors.content) ? rumors.content[0]?.text : JSON.stringify(rumors),
  );
}

async function runAppSessionFlow(
  client: Client,
  env: ReturnType<typeof getYellowConfig>,
  yellow: YellowRpcClient,
  agentAddress: string,
  assetSymbol: string,
) {
  logStage('Demo flow: app session');

  const { participants, allocations, ttlSeconds, requiredAmount } = parseSessionConfig(
    env,
    agentAddress,
    assetSymbol,
  );

  await ensureSandboxBalance(
    yellow,
    env,
    agentAddress,
    assetSymbol,
    requiredAmount,
    'App session funding',
  );

  const appSessionId = await createAppSession(
    yellow,
    env.agentPrivateKey,
    participants,
    allocations,
    ttlSeconds,
  );
  console.log('appSessionId', appSessionId);
  console.log('ttlSeconds', ttlSeconds);
  console.log('allocations', allocations);

  const agentAllocation =
    allocations.find(entry => entry.participant.toLowerCase() === agentAddress.toLowerCase())
      ?.amount ?? '0';
  let localSessionBalance = parseNumber(agentAllocation, `allocation for ${agentAddress}`);
  let spentTotal = 0;

  const stockSymbol = 'AAPL';
  logStage(`Demo: call MCP (stock_price) using Yellow session (${stockSymbol})`);
  const stock = await client.callTool({
    name: 'stock_price',
    arguments: { symbol: stockSymbol },
    _meta: { 'x402/yellow': { appSessionId, payer: agentAddress } },
  });
  const stockText = (stock as { content?: Array<{ text?: string }> }).content?.[0]?.text;
  console.log(truncateOutput(stockText ?? JSON.stringify(stock)));

  const stockPrice = getToolPrice(env, 'stock_price');
  localSessionBalance -= stockPrice;
  spentTotal += stockPrice;

  const rumorsSymbol = 'AAPL';
  logStage(`Demo: call MCP (market_rumors) using Yellow session (${rumorsSymbol})`);
  const rumors = await client.callTool({
    name: 'market_rumors',
    arguments: { symbol: rumorsSymbol },
    _meta: { 'x402/yellow': { appSessionId, payer: agentAddress } },
  });
  const rumorsText = (rumors as { content?: Array<{ text?: string }> }).content?.[0]?.text;
  console.log(truncateOutput(rumorsText ?? JSON.stringify(rumors)));

  const rumorsPrice = getToolPrice(env, 'market_rumors');
  localSessionBalance -= rumorsPrice;
  spentTotal += rumorsPrice;

  logStage('Demo: close app session');
  const merchantParticipant =
    participants.find(participant => participant.toLowerCase() !== agentAddress.toLowerCase()) ??
    env.merchantAddress;
  const closeAllocations = participants.map(participant => ({
    participant: participant as `0x${string}`,
    asset: assetSymbol,
    amount:
      participant.toLowerCase() === agentAddress.toLowerCase()
        ? localSessionBalance.toString()
        : participant.toLowerCase() === merchantParticipant?.toLowerCase()
          ? spentTotal.toString()
          : '0',
  }));
  const closeSigner = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
  const closeMessage = await createCloseAppSessionMessage(closeSigner, {
    app_session_id: appSessionId as `0x${string}`,
    allocations: closeAllocations,
  });
  await yellow.sendRawMessage(closeMessage);
}

async function main() {
  // Load environment at runtime (not module load time)
  // This ensures CI-generated environment variables are available
  const env = getYellowConfig();

  if (!env.agentPrivateKey || !env.merchantAddress) {
    console.error('YELLOW_AGENT_PRIVATE_KEY and YELLOW_MERCHANT_ADDRESS are required.');
    process.exit(1);
  }

  if (!process.env.TAVILY_API_KEY) {
    console.error('TAVILY_API_KEY is required to run market_rumors in e2e.');
    process.exit(1);
  }

  if (env.mode !== 'development') {
    console.error('E2E paid tools require sandbox (development) mode.');
    process.exit(1);
  }

  console.error(getFundingHint(env.mode));

  const agentAddress =
    env.agentAddress ?? privateKeyToAccount(env.agentPrivateKey as `0x${string}`).address;

  const yellow = new YellowRpcClient({
    url: env.clearnodeUrl,
    privateKey: env.agentPrivateKey,
    authDomain: env.authDomain,
    debug: env.debug,
  });

  const assetSymbol = await resolveAssetSymbol(yellow, env);

  await yellow.authenticate({
    allowances: [{ asset: assetSymbol, amount: '1000' }],
    scope: 'transfer',
  });

  const transport = new StdioClientTransport({
    command: 'bash',
    args: ['-lc', 'npm run dev'],
    env: Object.fromEntries(
      Object.entries(process.env).filter(([_, value]) => value !== undefined),
    ) as Record<string, string>,
    stderr: 'pipe',
  });

  const client = new Client({ name: 'paid-tool-e2e', version: '0.0.1' });
  await client.connect(transport);

  try {
    await runPerCallFlow(client, env, yellow, assetSymbol, agentAddress);
    await runAppSessionFlow(client, env, yellow, agentAddress, assetSymbol);
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error('E2E paid tool test failed:', error);
  process.exit(1);
});
