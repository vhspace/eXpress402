import { YellowRpcClient } from './build/src/yellow/rpc.js';

const yellow = new YellowRpcClient({
  url: 'wss://clearnet-sandbox.yellow.com/ws',
  privateKey: '0x323007595978d45a651e61ba6248b65c1bba7e1bc69867cfd42a05202db6cd56',
  authDomain: 'clearnet-sandbox.yellow.com',
  debug: false,
});

try {
  await yellow.connect();
  await yellow.authenticate({
    allowances: [{ asset: 'ytest.usd', amount: '1000' }],
    scope: 'transfer',
    application: 'balance-check',
  });

  const balances = await yellow.getLedgerBalances('0x9126d073e0a5e45D907feA0b4f4857F5b7191430');
  const amount = balances.find(b => b.asset === 'ytest.usd')?.amount || '0';
  console.log('Merchant wallet balance:', amount, 'ytest.usd');

  await yellow.disconnect();
} catch (error) {
  console.error('Error:', error.message);
}
