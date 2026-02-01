import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { privateKeyToAccount } from 'viem/accounts';
import { getFundingHint, getYellowConfig } from './yellow/config.js';
import { YellowRpcClient } from './yellow/rpc.js';

const SANDBOX_FAUCET_URL = 'https://clearnet-sandbox.yellow.com/faucet/requestTokens';

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
  minAmount: string,
  maxAttempts = 10,
  delayMs = 2000,
) {
  const target = Number(minAmount);
  if (Number.isNaN(target)) {
    throw new Error(`Invalid pricePerCall: ${minAmount}`);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const balances = await yellow.getLedgerBalances(accountId);
    const match = balances.find(entry => entry.asset === asset);
    const amount = Number(match?.amount ?? 0);
    console.error(`Funding check ${attempt}/${maxAttempts}: ${amount} ${asset} (target ${target})`);
    if (!Number.isNaN(amount) && amount >= target) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  throw new Error(`Sandbox funding did not arrive for ${accountId} (${asset})`);
}

async function createPaymentPayload(env: ReturnType<typeof getYellowConfig>) {
  const yellow = new YellowRpcClient({
    url: env.clearnodeUrl,
    privateKey: env.agentPrivateKey,
    authDomain: env.authDomain,
    debug: env.debug,
  });

  const assetsResponse = (await yellow.request('get_assets', {})) as {
    assets?: Array<{ symbol: string }>;
  };
  const assets = assetsResponse.assets ?? [];
  const selectedAsset =
    assets.find(asset => asset.symbol.toLowerCase() === env.assetSymbol.toLowerCase()) ?? assets[0];
  const assetSymbol = selectedAsset?.symbol ?? env.assetSymbol;

  const agentAddress =
    env.agentAddress ?? privateKeyToAccount(env.agentPrivateKey as `0x${string}`).address;

  await yellow.authenticate({
    allowances: [{ asset: assetSymbol, amount: '1000' }],
    scope: 'transfer',
  });

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
    await waitForFunding(yellow, agentAddress, assetSymbol, env.pricePerCall);
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

async function main() {
  // Load environment at runtime (not module load time)
  // This ensures CI-generated environment variables are available
  const env = getYellowConfig();

  if (!env.agentPrivateKey || !env.merchantAddress) {
    console.error('YELLOW_AGENT_PRIVATE_KEY and YELLOW_MERCHANT_ADDRESS are required.');
    process.exit(1);
  }

  console.error(getFundingHint(env.mode));

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

  const stockPayment = await createPaymentPayload(env);
  const stock = await client.callTool({
    name: 'stock_price',
    arguments: { symbol: 'AAPL' },
    _meta: { 'x402/payment': stockPayment },
  });
  console.log(
    'stock_price:',
    Array.isArray(stock.content) ? stock.content[0]?.text : JSON.stringify(stock),
  );

  // Skip TAVILY-dependent tests in CI to avoid API costs
  if (process.env.SKIP_TAVILY_TESTS !== 'true') {
    const rumorsPayment = await createPaymentPayload(env);
    const rumors = await client.callTool({
      name: 'market_rumors',
      arguments: { symbol: 'AAPL' },
      _meta: { 'x402/payment': rumorsPayment },
    });
    console.log(
      'market_rumors:',
      Array.isArray(rumors.content) ? rumors.content[0]?.text : JSON.stringify(rumors),
    );
  } else {
    console.log('market_rumors: SKIPPED (TAVILY tests disabled in CI)');
  }

  await client.close();
}

main().catch(error => {
  console.error('E2E paid tool test failed:', error);
  process.exit(1);
});
