import { YellowRpcClient } from "./yellow/rpc.js";

const env = {
  clearnodeUrl: process.env.YELLOW_CLEARNODE_URL ?? "wss://clearnet-sandbox.yellow.com/ws",
  merchantPrivateKey: process.env.YELLOW_MERCHANT_PRIVATE_KEY ?? "",
  assetSymbol: process.env.YELLOW_ASSET_SYMBOL ?? "usdc",
  authDomain: process.env.YELLOW_AUTH_DOMAIN
};

const destination = process.argv[2];
const amount = process.argv[3];

if (!env.merchantPrivateKey) {
  console.error("YELLOW_MERCHANT_PRIVATE_KEY is required.");
  process.exit(1);
}

if (!destination || !amount) {
  console.error("Usage: npm run merchant-spend -- <destination> <amount>");
  process.exit(1);
}

async function main() {
  const yellow = new YellowRpcClient({
    url: env.clearnodeUrl,
    privateKey: env.merchantPrivateKey,
    authDomain: env.authDomain,
    debug: process.env.YELLOW_DEBUG === "true"
  });

  const transferResponse = (await yellow.transfer({
    destination,
    allocations: [
      {
        asset: env.assetSymbol,
        amount
      }
    ]
  })) as { transactions?: Array<Record<string, unknown>> };

  console.error("Merchant transfer result:");
  console.error(JSON.stringify(transferResponse, null, 2));
}

main().catch((error) => {
  console.error("Merchant spend failed:", error);
  process.exit(1);
});
