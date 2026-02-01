import {
  AgentKit,
  CdpEvmWalletProvider,
  onrampActionProvider,
  walletActionProvider,
  type Action
} from "@coinbase/agentkit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  createAppSessionMessage,
  createCloseAppSessionMessage,
  createECDSAMessageSigner
} from "@erc7824/nitrolite/dist/rpc/api.js";
import { RPCProtocolVersion } from "@erc7824/nitrolite/dist/rpc/types/index.js";
import { privateKeyToAccount } from "viem/accounts";
import { getFundingHint, getYellowConfig, type YellowMode } from "./yellow/config.js";
import type { PaymentRequired } from "./x402/types.js";
import { YellowRpcClient } from "./yellow/rpc.js";

const env = getYellowConfig();

if (!env.agentPrivateKey || !env.merchantAddress) {
  console.error("YELLOW_AGENT_PRIVATE_KEY and YELLOW_MERCHANT_ADDRESS are required.");
  process.exit(1);
}

type CdpConfig = {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
  networkId: string;
  walletAddress?: `0x${string}`;
  idempotencyKey?: string;
  rpcUrl?: string;
  onrampProjectId?: string;
};

function getCdpConfig(mode: YellowMode): CdpConfig {
  const required = {
    CDP_API_KEY_ID: process.env.CDP_API_KEY_ID,
    CDP_API_KEY_SECRET: process.env.CDP_API_KEY_SECRET,
    CDP_WALLET_SECRET: process.env.CDP_WALLET_SECRET
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`Missing required CDP credentials: ${missing.join(", ")}`);
  }

  const networkId =
    process.env.CDP_NETWORK_ID ?? (mode === "production" ? "base-mainnet" : "base-sepolia");

  return {
    apiKeyId: required.CDP_API_KEY_ID as string,
    apiKeySecret: required.CDP_API_KEY_SECRET as string,
    walletSecret: required.CDP_WALLET_SECRET as string,
    networkId,
    walletAddress: process.env.CDP_WALLET_ADDRESS as `0x${string}` | undefined,
    idempotencyKey: process.env.CDP_IDEMPOTENCY_KEY,
    rpcUrl: process.env.CDP_RPC_URL,
    onrampProjectId: process.env.CDP_ONRAMP_PROJECT_ID
  };
}

const agentAddress =
  env.agentAddress ?? privateKeyToAccount(env.agentPrivateKey as `0x${string}`).address;
const sessionParticipants = (process.env.YELLOW_APP_SESSION_PARTICIPANTS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean) as `0x${string}`[];
const sessionAllocationsRaw = process.env.YELLOW_APP_SESSION_ALLOCATIONS ?? "";
const sessionTtlSeconds = Number(process.env.YELLOW_APP_SESSION_TTL_SECONDS ?? "");

if (sessionParticipants.length < 2 || !sessionAllocationsRaw || Number.isNaN(sessionTtlSeconds)) {
  console.error(
    "YELLOW_APP_SESSION_PARTICIPANTS (at least 2), YELLOW_APP_SESSION_ALLOCATIONS, and YELLOW_APP_SESSION_TTL_SECONDS are required."
  );
  process.exit(1);
}

if (!sessionParticipants.some((participant) => participant.toLowerCase() === agentAddress.toLowerCase())) {
  console.error("YELLOW_APP_SESSION_PARTICIPANTS must include the agent address.");
  process.exit(1);
}

async function getBalance(client: YellowRpcClient, accountId: string, asset: string) {
  const balances = await client.getLedgerBalances(accountId);
  const match = balances.find((entry) => entry.asset === asset);
  return match?.amount ?? "0";
}

async function safeBalance(client: YellowRpcClient, accountId: string, asset: string) {
  try {
    return await getBalance(client, accountId, asset);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Balance lookup failed (${accountId}): ${message}`);
    throw error;
  }
}

function logStage(label: string) {
  console.log(label);
}

function truncateOutput(value: string, maxLength = 80) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

async function createCdpAgentKit(config: CdpConfig) {
  logStage("Initializing Coinbase AgentKit");
  const walletProvider = await CdpEvmWalletProvider.configureWithWallet({
    apiKeyId: config.apiKeyId,
    apiKeySecret: config.apiKeySecret,
    walletSecret: config.walletSecret,
    networkId: config.networkId,
    ...(config.walletAddress ? { address: config.walletAddress } : {}),
    ...(config.idempotencyKey ? { idempotencyKey: config.idempotencyKey } : {}),
    ...(config.rpcUrl ? { rpcUrl: config.rpcUrl } : {})
  });
  const actionProviders = [walletActionProvider()];
  if (config.onrampProjectId) {
    actionProviders.push(onrampActionProvider({ projectId: config.onrampProjectId }));
  }
  const agentKit = await AgentKit.from({ walletProvider, actionProviders });
  return { agentKit, walletProvider };
}

async function logCdpWalletSummary(walletProvider: CdpEvmWalletProvider) {
  const address = walletProvider.getAddress();
  const network = walletProvider.getNetwork();
  const balance = await walletProvider.getBalance();
  console.log("cdp wallet", address);
  console.log("cdp network", network.networkId ?? "unknown", "chain", network.chainId ?? "unknown");
  console.log("cdp balance (wei)", balance.toString());
}

function getActionBySuffix(actions: Action[], suffix: string) {
  const action = actions.find((candidate) => candidate.name.endsWith(`_${suffix}`));
  if (!action) {
    const available = actions.map((candidate) => candidate.name).join(", ");
    throw new Error(`AgentKit action unavailable: ${suffix}. Available: ${available}`);
  }
  return action;
}

async function runProductionOnrampOfframp(
  agentKit: AgentKit,
  walletProvider: CdpEvmWalletProvider,
  config: CdpConfig
) {
  logStage("Production onramp/offramp (Coinbase CDP)");
  if (!config.onrampProjectId) {
    throw new Error("CDP_ONRAMP_PROJECT_ID is required for production onramp flow.");
  }

  const networkId = walletProvider.getNetwork().networkId;
  if (!networkId || !networkId.includes("mainnet")) {
    throw new Error(
      `Production onramp requires a mainnet CDP network. Current network: ${networkId ?? "unset"}`
    );
  }

  const actions = agentKit.getActions();
  const onrampAction = getActionBySuffix(actions, "get_onramp_buy_url");
  const onrampUrl = await onrampAction.invoke({});
  console.log("onramp url", onrampUrl);
  console.log("onramp wallet", walletProvider.getAddress());
  console.log("offramp reminder: close Yellow session, then withdraw from the CDP wallet.");
}

async function listMcpTools(client: Client) {
  const response = await client.listTools();
  const toolNames = response.tools.map((tool) => tool.name);
  console.log("mcp tools", toolNames.join(", "));
  return response.tools;
}

function requireYellowExtension(paymentRequired: PaymentRequired) {
  const acceptsYellow = paymentRequired.accepts.some((entry) => entry.scheme === "yellow-offchain");
  if (!acceptsYellow) {
    throw new Error("MCP server did not advertise yellow-offchain payment scheme.");
  }
  const yellowExtension = paymentRequired.extensions?.yellow;
  if (!yellowExtension) {
    throw new Error("MCP server did not advertise the yellow payment extension.");
  }
  return yellowExtension;
}

async function detectYellowProtocol(client: Client, toolName: string, symbol: string) {
  try {
    await client.callTool({ name: toolName, arguments: { symbol } });
    throw new Error(`Unexpected tool success without payment for ${toolName}.`);
  } catch (error) {
    if (error instanceof McpError && error.code === 402) {
      const paymentRequired = error.data as PaymentRequired | undefined;
      if (!paymentRequired) {
        throw new Error("Payment required response missing payload.");
      }
      const yellowExtension = requireYellowExtension(paymentRequired);
      console.log("yellow extension", JSON.stringify(yellowExtension, null, 2));
      return yellowExtension;
    }
    console.error("Unexpected MCP error while probing payment requirements:", error);
    throw error;
  }
}

const SAMPLE_SP500_TICKERS = [
  "AAPL",
  "MSFT",
  "AMZN",
  "GOOGL",
  "META",
  "NVDA",
  "TSLA",
  "JPM",
  "V",
  "UNH",
  "HD",
  "PG",
  "MA",
  "XOM",
  "LLY",
  "AVGO",
  "COST",
  "PEP",
  "KO",
  "MRK"
];

function pickRandomTicker(exclude?: string) {
  const options = exclude
    ? SAMPLE_SP500_TICKERS.filter((ticker) => ticker !== exclude)
    : SAMPLE_SP500_TICKERS;
  return options[Math.floor(Math.random() * options.length)];
}

function runProductionChannelFlow(cdpWalletAddress?: string) {
  logStage("Production channel flow (Yellow custody)");
  const required = {
    YELLOW_CHAIN_ID: process.env.YELLOW_CHAIN_ID,
    YELLOW_RPC_URL: process.env.YELLOW_RPC_URL,
    YELLOW_CUSTODY_ADDRESS: process.env.YELLOW_CUSTODY_ADDRESS,
    YELLOW_ADJUDICATOR_ADDRESS: process.env.YELLOW_ADJUDICATOR_ADDRESS,
    YELLOW_TOKEN_ADDRESS: process.env.YELLOW_TOKEN_ADDRESS
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`Missing Yellow production channel config: ${missing.join(", ")}`);
  }

  if (cdpWalletAddress) {
    console.log("cdp wallet", cdpWalletAddress);
  }
  console.log("1) Deposit on-chain to custody");
  console.log("2) Open channel (wallet ↔ broker)");
  console.log("3) Resize channel (wallet signature + on-chain confirmation)");
  console.log("4) Close/withdraw to on-chain wallet");
}

function parseAllocations(
  participants: `0x${string}`[],
  allocationsRaw: string,
  assetSymbol: string
): Array<{ participant: `0x${string}`; asset: string; amount: string }> {
  const allocationMap = JSON.parse(allocationsRaw) as Record<string, string>;
  return participants.map((participant) => ({
    participant,
    asset: assetSymbol,
    amount: allocationMap[participant] ?? "0"
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
  ttlSeconds: number
) {
  const signer = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
  const allocations = parseAllocations(participants, sessionAllocationsRaw, assetSymbol);
  const weights = participants.map(() => 1);
  const message = await createAppSessionMessage(signer, {
    definition: {
      application: "eXpress402-mcp",
      protocol: RPCProtocolVersion.NitroRPC_0_4,
      participants,
      weights,
      quorum: 1,
      challenge: 0,
      nonce: Date.now()
    },
    allocations,
    session_data: JSON.stringify({ ttlSeconds })
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

async function main() {
  logStage("Booting demo");
  console.log(getFundingHint(env.mode));

  const cdpConfig = getCdpConfig(env.mode);
  const { agentKit, walletProvider } = await createCdpAgentKit(cdpConfig);

  logStage("CDP AgentKit wallet ready");
  await logCdpWalletSummary(walletProvider);
  const agentKitActions = agentKit.getActions().map((action) => action.name);
  console.log("agentkit actions", agentKitActions.join(", "));

  if (env.mode === "production") {
    await runProductionOnrampOfframp(agentKit, walletProvider, cdpConfig);
    runProductionChannelFlow(walletProvider.getAddress());
  }

  const yellow = new YellowRpcClient({
    url: env.clearnodeUrl,
    privateKey: env.agentPrivateKey,
    authDomain: env.authDomain,
    debug: env.debug
  });

  logStage("Connecting to Yellow clearnode");
  await yellow.connect();
  const assetsResponse = (await yellow.request("get_assets", {})) as {
    assets?: Array<{ symbol: string }>;
  };
  const assets = assetsResponse.assets ?? [];
  const selectedAsset =
    assets.find((asset) => asset.symbol.toLowerCase() === env.assetSymbol.toLowerCase()) ??
    assets[0];
  const assetSymbol = selectedAsset?.symbol ?? env.assetSymbol;

  logStage("Authorizing session key");
  await yellow.authenticate({
    allowances: [{ asset: assetSymbol, amount: "1000" }],
    scope: "transfer"
  });

  logStage("Step 1: wallet balances before calls");
  const initialAgentBalance = await safeBalance(yellow, agentAddress, assetSymbol);
  console.log("agent", agentAddress, "balance", initialAgentBalance);
  console.log(
    "merchant",
    env.merchantAddress,
    "balance",
    await safeBalance(yellow, env.merchantAddress, assetSymbol)
  );

  const transport = new StdioClientTransport({
    command: "npm",
    args: ["run", "dev"],
    env: Object.fromEntries(
      Object.entries(process.env).filter(([_, value]) => value !== undefined)
    ) as Record<string, string>,
    stderr: "pipe"
  });
  const client = new Client({ name: "demo-e2e", version: "0.0.1" });
  await client.connect(transport);

  try {
    logStage("Step 2: list MCP tools");
    const tools = await listMcpTools(client);
    const toolNames = new Set(tools.map((tool) => tool.name));
    if (!toolNames.has("stock_price") || !toolNames.has("market_rumors")) {
      throw new Error(`MCP server missing tools: ${[...toolNames].join(", ")}`);
    }

    const stockSymbol = pickRandomTicker();
    logStage("Step 3: verify yellow protocol via payment required");
    await detectYellowProtocol(client, "stock_price", stockSymbol);

    logStage("Step 4: create prepaid session (allocation + TTL)");
    const { appSessionId, allocations } = await createAppSession(
      yellow,
      sessionParticipants,
      assetSymbol,
      sessionTtlSeconds
    );
    console.log("appSessionId", appSessionId);
    console.log("ttlSeconds", sessionTtlSeconds);
    console.log("allocations", allocations);
    const agentAllocation =
      allocations.find((entry) => entry.participant.toLowerCase() === agentAddress.toLowerCase())
        ?.amount ?? "0";
    let localSessionBalance = Number(agentAllocation);
    if (Number.isNaN(localSessionBalance)) {
      throw new Error(`Invalid session allocation for agent: ${agentAllocation}`);
    }
    let spentTotal = 0;

    logStage(`Step 5: call MCP (stock_price) using Yellow session (${stockSymbol})`);
    try {
      const stock = await client.callTool({
        name: "stock_price",
        arguments: { symbol: stockSymbol },
        _meta: { "x402/yellow": { appSessionId, payer: agentAddress } }
      });
      const stockText = (stock as { content?: Array<{ text?: string }> }).content?.[0]?.text;
      logStage("Step 6: MCP result (stock_price)");
      console.log(truncateOutput(stockText ?? JSON.stringify(stock)));
    } catch (error) {
      logStage("Step 6: MCP result (stock_price) failed");
      console.error(error);
      throw error;
    }
    const stockPrice = getToolPrice("stock_price");
    localSessionBalance -= stockPrice;
    spentTotal += stockPrice;

    logStage("Step 7: session balance after stock_price");
    console.log(
      "session",
      appSessionId,
      "balance",
      await safeBalance(yellow, appSessionId, assetSymbol)
    );
    console.log("session (local)", localSessionBalance);

    const rumorsSymbol = pickRandomTicker(stockSymbol);
    logStage(`Step 8: call MCP (market_rumors) using Yellow session (${rumorsSymbol})`);
    try {
      const rumors = await client.callTool({
        name: "market_rumors",
        arguments: { symbol: rumorsSymbol },
        _meta: { "x402/yellow": { appSessionId, payer: agentAddress } }
      });
      const rumorsText = (rumors as { content?: Array<{ text?: string }> }).content?.[0]?.text;
      logStage("Step 9: MCP result (market_rumors)");
      console.log(truncateOutput(rumorsText ?? JSON.stringify(rumors)));
    } catch (error) {
      logStage("Step 9: MCP result (market_rumors) failed");
      console.error(error);
      throw error;
    }
    const rumorsPrice = getToolPrice("market_rumors");
    localSessionBalance -= rumorsPrice;
    spentTotal += rumorsPrice;

    logStage("Step 10: session balance after market_rumors");
    console.log(
      "session",
      appSessionId,
      "balance",
      await safeBalance(yellow, appSessionId, assetSymbol)
    );
    console.log("session (local)", localSessionBalance);

    logStage("Step 11: close out offchain wallet (close app session)");
    const sessionBalance = await safeBalance(yellow, appSessionId, assetSymbol);
    const merchantParticipant =
      sessionParticipants.find(
        (participant) => participant.toLowerCase() !== agentAddress.toLowerCase()
      ) ?? env.merchantAddress;
    const closeAllocations = sessionParticipants.map((participant) => ({
      participant: participant as `0x${string}`,
      asset: assetSymbol,
      amount:
        participant.toLowerCase() === agentAddress.toLowerCase()
          ? localSessionBalance.toString()
          : participant.toLowerCase() === merchantParticipant?.toLowerCase()
            ? spentTotal.toString()
            : "0"
    }));
    const closeSigner = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
    const closeMessage = await createCloseAppSessionMessage(closeSigner, {
      app_session_id: appSessionId as `0x${string}`,
      allocations: closeAllocations
    });
    await yellow.sendRawMessage(closeMessage);
    console.log("session", appSessionId, "balance", await safeBalance(yellow, appSessionId, assetSymbol));

    logStage("Step 12: unified balance after close");
    const finalAgentBalance = await safeBalance(yellow, agentAddress, assetSymbol);
    console.log("agent", agentAddress, "balance", finalAgentBalance);
    const initialValue = Number(initialAgentBalance);
    const finalValue = Number(finalAgentBalance);
    if (!Number.isNaN(initialValue) && !Number.isNaN(finalValue)) {
      const delta = finalValue - initialValue;
      console.log("agent delta", delta.toFixed(4));
    }
    console.log("session final balance", sessionBalance);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("Client demo failed:", error);
  process.exit(1);
});
