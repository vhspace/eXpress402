import { YellowRpcClient } from "./yellow/rpc.js";
import { buildPaymentRequired } from "./x402/payment.js";

const env = {
  clearnodeUrl: process.env.YELLOW_CLEARNODE_URL ?? "wss://clearnet-sandbox.yellow.com/ws",
  merchantAddress: process.env.YELLOW_MERCHANT_ADDRESS ?? "",
  assetSymbol: process.env.YELLOW_ASSET_SYMBOL ?? "usdc",
  pricePerCall: process.env.YELLOW_PRICE_PER_CALL ?? "0.1",
  network: process.env.YELLOW_NETWORK ?? "yellow:sandbox",
  privateKey: process.env.YELLOW_AGENT_PRIVATE_KEY ?? "",
  authDomain: process.env.YELLOW_AUTH_DOMAIN
};

if (!env.privateKey || !env.merchantAddress) {
  console.error("YELLOW_AGENT_PRIVATE_KEY and YELLOW_MERCHANT_ADDRESS are required.");
  process.exit(1);
}

async function main() {
  const yellow = new YellowRpcClient({
    url: env.clearnodeUrl,
    privateKey: env.privateKey,
    authDomain: env.authDomain,
    debug: process.env.YELLOW_DEBUG === "true"
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
    destination: env.merchantAddress,
    allocations: [
      {
        asset: assetSymbol,
        amount: env.pricePerCall
      }
    ]
  })) as { transactions?: Array<Record<string, unknown>> };

  const transfer = transferResponse.transactions?.[0] ?? {};
  const transferId = String(transfer.id ?? transfer.transaction_id ?? "");
  const payer = String(transfer.sender ?? "");

  const receipt = {
    transferId,
    payer,
    amount: env.pricePerCall,
    asset: assetSymbol,
    to: env.merchantAddress
  };

  const paymentPayload = {
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
    payload: receipt,
    extensions: {
      yellow: {
        info: {
          clearnodeUrl: env.clearnodeUrl,
          protocolVersion: "NitroRPC/0.4",
          asset: assetSymbol,
          pricePerCall: env.pricePerCall,
          transferId: receipt.transferId,
          payer: receipt.payer
        },
        schema: buildPaymentRequired(
          {
            clearnodeUrl: env.clearnodeUrl,
            merchantAddress: env.merchantAddress,
            assetSymbol: assetSymbol,
            pricePerCall: env.pricePerCall,
            network: env.network,
            maxTimeoutSeconds: 60
          },
          "mcp://tool/stock_price",
          "Paid tool"
        ).extensions?.yellow?.schema
      }
    }
  };

  console.error("Payment payload to include in _meta[x402/payment]:");
  console.error(JSON.stringify(paymentPayload, null, 2));
}

main().catch((error) => {
  console.error("Client demo failed:", error);
  process.exit(1);
});
