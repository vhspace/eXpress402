import { YellowRpcClient } from '../src/yellow/rpc.js';

async function main() {
  const client = new YellowRpcClient({
    url: 'wss://clearnet-sandbox.yellow.com/ws',
  });

  const config = await client.request('get_config', {});
  console.log('Supported networks:');
  (config as any).networks?.forEach((n: any) => {
    console.log(`  Chain ${n.chain_id}: ${n.name}`);
    console.log(`    Custody: ${n.custody_address}`);
    console.log(`    Adjudicator: ${n.adjudicator_address}`);
  });

  const assets = await client.request('get_assets', {});
  console.log('\nUSDC (real) availability:');
  (assets as any).assets
    ?.filter((a: any) => a.symbol === 'usdc')
    .forEach((a: any) => {
      console.log(`  Chain ${a.chain_id}: ${a.token}`);
    });

  console.log('\nytest.usd (sandbox) availability:');
  (assets as any).assets
    ?.filter((a: any) => a.symbol === 'ytest.usd')
    .forEach((a: any) => {
      console.log(`  Chain ${a.chain_id}: ${a.token}`);
    });

  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
