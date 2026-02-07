import { YellowRpcClient } from '../src/yellow/rpc.js';
import { config } from 'dotenv';

config();

const env = {
  clearnodeUrl: process.env.YELLOW_CLEARNODE_URL || 'wss://clearnet-sandbox.yellow.com/ws',
  agentPrivateKey: process.env.YELLOW_AGENT_PRIVATE_KEY,
  assetSymbol: 'ytest.usd',
};

const agentAddress = '0xe74298ea70069822eB490cb4Fb4694302e94Dbe1';

console.log('Checking balance for:', agentAddress);

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

const balances = await yellow.getLedgerBalances(agentAddress);
console.log('\nOff-chain wallet balances:');
console.log(JSON.stringify(balances, null, 2));

const testUsdBalance = balances.find((b: any) => b.asset === 'ytest.usd');
if (testUsdBalance) {
  console.log(`\n✓ ytest.usd balance: ${testUsdBalance.amount}`);
  console.log(`  That's ${(parseFloat(testUsdBalance.amount) / 1000000).toFixed(2)} million ytest.usd!`);
} else {
  console.log('\nNo ytest.usd balance found');
}

process.exit(0);
