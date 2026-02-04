import { getYellowConfig } from './yellow/config.js';
import { YellowRpcClient } from './yellow/rpc.js';

const env = getYellowConfig();

const destination = process.argv[2];
const amount = process.argv[3];

if (!env.merchantPrivateKey) {
  console.error('YELLOW_MERCHANT_PRIVATE_KEY is required.');
  process.exit(1);
}

if (!destination || !amount) {
  console.error('Usage: npm run merchant-spend -- <destination> <amount>');
  process.exit(1);
}

async function main() {
  const yellow = new YellowRpcClient({
    url: env.clearnodeUrl,
    privateKey: env.merchantPrivateKey,
    authDomain: env.authDomain,
    debug: env.debug,
  });

  const transferResponse = (await yellow.transfer({
    destination: destination as `0x${string}`,
    allocations: [
      {
        asset: env.assetSymbol,
        amount,
      },
    ],
  })) as { transactions?: Array<Record<string, unknown>> };

  console.error('Merchant transfer result:');
  console.error(JSON.stringify(transferResponse, null, 2));
}

main().catch(error => {
  console.error('Merchant spend failed:', error);
  process.exit(1);
});
