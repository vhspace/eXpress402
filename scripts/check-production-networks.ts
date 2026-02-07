import { YellowRpcClient } from '../src/yellow/rpc.js';

async function main() {
  console.log('Checking PRODUCTION clearnode...\n');

  const client = new YellowRpcClient({
    url: 'wss://clearnet.yellow.com/ws', // PRODUCTION
  });

  try {
    const config = await client.request('get_config', {});
    console.log('✓ Production clearnode is ONLINE\n');
    console.log('Supported networks:');
    (config as any).networks?.forEach((n: any) => {
      console.log(`  Chain ${n.chain_id}: ${n.name}`);
      console.log(`    Custody: ${n.custody_address}`);
      console.log(`    Adjudicator: ${n.adjudicator_address}`);
    });

    const assets = await client.request('get_assets', {});
    console.log('\nUSDC availability:');
    (assets as any).assets
      ?.filter((a: any) => a.symbol === 'usdc')
      .forEach((a: any) => {
        console.log(`  Chain ${a.chain_id}: ${a.token} (${a.decimals} decimals)`);
      });

    console.log('\nAll assets:');
    const assetsBySymbol = new Map();
    (assets as any).assets?.forEach((a: any) => {
      if (!assetsBySymbol.has(a.symbol)) {
        assetsBySymbol.set(a.symbol, []);
      }
      assetsBySymbol.get(a.symbol).push(a.chain_id);
    });

    assetsBySymbol.forEach((chains, symbol) => {
      console.log(`  ${symbol}: chains [${chains.join(', ')}]`);
    });
  } catch (e) {
    console.error('✗ Production clearnode error:', e);
    console.log('\nFalling back to SANDBOX...\n');

    const sandboxClient = new YellowRpcClient({
      url: 'wss://clearnet-sandbox.yellow.com/ws',
    });

    const config = await sandboxClient.request('get_config', {});
    console.log('Sandbox networks:');
    (config as any).networks?.forEach((n: any) => {
      console.log(`  Chain ${n.chain_id}: ${n.name}`);
    });
  }

  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
