import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getFundingHint, getYellowConfig } from "./yellow/config.js";
import { YellowRpcClient } from "./yellow/rpc.js";

const env = getYellowConfig();

if (!env.agentPrivateKey || !env.merchantAddress) {
  console.error("YELLOW_AGENT_PRIVATE_KEY and YELLOW_MERCHANT_ADDRESS are required.");
  process.exit(1);
}

async function createPaymentPayload() {
  const yellow = new YellowRpcClient({
    url: env.clearnodeUrl,
    privateKey: env.agentPrivateKey,
    authDomain: env.authDomain,
    debug: env.debug
  });

  const assetsResponse = (await yellow.request("get_assets", {})) as {
    assets?: Array<{ symbol: string }>;
  };
  const assets = assetsResponse.assets ?? [];
  const selectedAsset =
    assets.find((asset) => asset.symbol.toLowerCase() === env.assetSymbol.toLowerCase()) ??
    assets[0];
  const assetSymbol = selectedAsset?.symbol ?? env.assetSymbol;

  await yellow.authenticate({
    allowances: [{ asset: assetSymbol, amount: "1000" }],
    scope: "transfer"
  });

  const transferResponse = (await yellow.transfer({
    destination: env.merchantAddress as `0x${string}`,
    allocations: [
      {
        asset: assetSymbol,
        amount: env.pricePerCall
      }
    ]
  })) as { transactions?: Array<Record<string, unknown>> };

  const transfer = transferResponse.transactions?.[0] ?? {};
  const transferId = String(transfer.id ?? transfer.transaction_id ?? "");
  const payer = String(transfer.from_account ?? transfer.sender ?? "");

  return {
    x402Version: 2,
    accepted: {
      scheme: "yellow-offchain",
      network: env.network,
      amount: env.pricePerCall,
      asset: assetSymbol,
      payTo: env.merchantAddress,
      maxTimeoutSeconds: 60,
      extra: {
        settlement: "yellow"
      }
    },
    payload: {
      transferId,
      payer,
      amount: env.pricePerCall,
      asset: assetSymbol,
      to: env.merchantAddress
    }
  };
}

async function main() {
  console.error(getFundingHint(env.mode));

  const transport = new StdioClientTransport({
    command: "bash",
    args: ["-lc", "cd /workspaces/eXpress402 && npm run dev"],
    env: Object.fromEntries(
      Object.entries(process.env).filter(([_, value]) => value !== undefined)
    ) as Record<string, string>,
    stderr: "pipe"
  });

  const client = new Client({ name: "paid-tool-e2e", version: "0.0.1" });
  await client.connect(transport);

  const stockPayment = await createPaymentPayload();
  const stock = await client.callTool({
    name: "stock_price",
    arguments: { symbol: "AAPL" },
    _meta: { "x402/payment": stockPayment }
  });
  console.log("stock_price:", Array.isArray(stock.content) ? stock.content[0]?.text : JSON.stringify(stock));

  const rumorsPayment = await createPaymentPayload();
  const rumors = await client.callTool({
    name: "market_rumors",
    arguments: { symbol: "AAPL" },
    _meta: { "x402/payment": rumorsPayment }
  });
  console.log("market_rumors:", Array.isArray(rumors.content) ? rumors.content[0]?.text : JSON.stringify(rumors));

  await client.close();
}

main().catch((error) => {
  console.error("E2E paid tool test failed:", error);
  process.exit(1);
});
