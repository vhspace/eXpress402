import { YellowRpcClient } from '../src/yellow/rpc.js';
import { config } from 'dotenv';

config();

const env = {
  clearnodeUrl: process.env.YELLOW_CLEARNODE_URL || 'wss://clearnet-sandbox.yellow.com/ws',
  agentPrivateKey: process.env.YELLOW_AGENT_PRIVATE_KEY,
  assetSymbol: 'ytest.usd',
};

const merchantAddress = '0x9126d073e0a5e45D907feA0b4f4857F5b7191430';

console.log('Checking balance for merchant:', merchantAddress);

const yellow = new YellowRpcClient({
  url: env.clearnodeUrl,
  privateKey: env.agentPrivateKey,
  authDomain: 'clearnet-sandbox.yellow.com',
  debug: false,
});

await yellow.connect();
await yellow.authenticate({
  allowances: [{ asset: env.assetSymbol, amount: '1000' }],
  scope: 'transfer',
  application: 'balance-check',
});

const balances = await yellow.getLedgerBalances(merchantAddress);
console.log('\nMerchant off-chain wallet balances:');
console.log(JSON.stringify(balances, null, 2));

const testUsdBalance = balances.find((b: any) => b.asset === 'ytest.usd');
if (testUsdBalance) {
  console.log(`\n✓ ytest.usd balance: ${testUsdBalance.amount}`);
  
  const amount = parseFloat(testUsdBalance.amount);
  if (amount > 1000) {
    console.log(`  That's ${(amount / 1000).toFixed(2)}K ytest.usd!`);
  }
} else {
  console.log('\n⚠️  No ytest.usd balance found (truly 0.00)');
}

process.exit(0);
