import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  createAppSessionMessage,
  createCloseAppSessionMessage,
  createECDSAMessageSigner
} from "@erc7824/nitrolite/dist/rpc/api.js";
import { RPCProtocolVersion } from "@erc7824/nitrolite/dist/rpc/types/index.js";
import { privateKeyToAccount } from "viem/accounts";
import { getFundingHint, getYellowConfig } from "./yellow/config.js";
import { YellowRpcClient } from "./yellow/rpc.js";

const env = getYellowConfig();

if (!env.agentPrivateKey || !env.merchantAddress) {
  console.error("YELLOW_AGENT_PRIVATE_KEY and YELLOW_MERCHANT_ADDRESS are required.");
  process.exit(1);
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
    console.log(`balance unavailable (${accountId}): ${message}`);
    return "unavailable";
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

function runProductionChannelFlow() {
  logStage("Production channel flow (on-ramp/off-ramp)");
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
    console.log("Channel flow skipped; set:", missing.join(", "));
    return;
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

  if (env.mode === "production") {
    runProductionChannelFlow();
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
  console.log("merchant", env.merchantAddress, "balance", await safeBalance(yellow, env.merchantAddress, assetSymbol));

  logStage("Step 2: create prepaid session (allocation + TTL)");
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
  let spentTotal = 0;

  const transport = new StdioClientTransport({
    command: "bash",
    args: ["-lc", "cd /workspaces/eXpress402 && npm run dev"],
    env: Object.fromEntries(
      Object.entries(process.env).filter(([_, value]) => value !== undefined)
    ) as Record<string, string>,
    stderr: "pipe"
  });
  const client = new Client({ name: "demo-e2e", version: "0.0.1" });
  await client.connect(transport);

  const stockSymbol = pickRandomTicker();
  logStage(`Step 2: call MCP (stock_price) using Yellow session (${stockSymbol})`);
  let stockPaid = false;
  try {
    const stock = await client.callTool({
      name: "stock_price",
      arguments: { symbol: stockSymbol },
      _meta: { "x402/yellow": { appSessionId, payer: agentAddress } }
    });
    const stockText = (stock as { content?: Array<{ text?: string }> }).content?.[0]?.text;
    logStage("Step 3: MCP result (stock_price)");
    console.log(truncateOutput(stockText ?? JSON.stringify(stock)));
    stockPaid = true;
  } catch (error) {
    logStage("Step 3: MCP result (stock_price) failed");
    console.log(error);
  }
  if (stockPaid) {
    const price = getToolPrice("stock_price");
    localSessionBalance -= price;
    spentTotal += price;
  }
  logStage("Step 4: session balance after stock_price");
  console.log("session", appSessionId, "balance", await safeBalance(yellow, appSessionId, assetSymbol));
  console.log("session (local)", localSessionBalance);

  const rumorsSymbol = pickRandomTicker(stockSymbol);
  logStage(`Step 2: call MCP (market_rumors) using Yellow session (${rumorsSymbol})`);
  let rumorsPaid = false;
  try {
    const rumors = await client.callTool({
      name: "market_rumors",
      arguments: { symbol: rumorsSymbol },
      _meta: { "x402/yellow": { appSessionId, payer: agentAddress } }
    });
    const rumorsText = (rumors as { content?: Array<{ text?: string }> }).content?.[0]?.text;
    logStage("Step 3: MCP result (market_rumors)");
    console.log(truncateOutput(rumorsText ?? JSON.stringify(rumors)));
    rumorsPaid = true;
  } catch (error) {
    logStage("Step 3: MCP result (market_rumors) failed");
    console.log(error);
  }
  if (rumorsPaid) {
    const price = getToolPrice("market_rumors");
    localSessionBalance -= price;
    spentTotal += price;
  }
  logStage("Step 4: session balance after market_rumors");
  console.log("session", appSessionId, "balance", await safeBalance(yellow, appSessionId, assetSymbol));
  console.log("session (local)", localSessionBalance);

  logStage("Step 5: close out offchain wallet (close app session)");
  const sessionBalance = await safeBalance(yellow, appSessionId, assetSymbol);
  if (sessionBalance !== "unavailable") {
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
  } else {
    console.log("close skipped: session balance unavailable");
  }

  logStage("Step 6: unified balance after close");
  const finalAgentBalance = await safeBalance(yellow, agentAddress, assetSymbol);
  console.log("agent", agentAddress, "balance", finalAgentBalance);
  const initialValue = Number(initialAgentBalance);
  const finalValue = Number(finalAgentBalance);
  if (!Number.isNaN(initialValue) && !Number.isNaN(finalValue)) {
    const delta = finalValue - initialValue;
    console.log("agent delta", delta.toFixed(4));
  }

  await client.close();
}

main().catch((error) => {
  console.error("Client demo failed:", error);
  process.exit(1);
});
