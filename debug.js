import { YellowRpcClient } from './build/src/yellow/rpc.js';
import { getYellowConfig } from './build/src/yellow/config.js';

async function debugBalanceTransfers() {
  console.log('🔍 Starting balance transfer debug...');

  const config = getYellowConfig();
  const yellow = new YellowRpcClient({ url: config.clearnodeUrl });

  try {
    // Connect and authenticate as agent
    await yellow.connect();
    console.log('✅ Connected to Yellow clearnode');

    await yellow.authenticate({
      allowances: [{ asset: config.assetSymbol, amount: '1000' }],
      scope: 'transfer',
    });
    console.log('✅ Authenticated as agent');

    // Check initial balances
    const agentBalanceBefore = await safeBalance(yellow, config.agentAddress, config.assetSymbol);
    const merchantBalanceBefore = await safeBalance(yellow, config.merchantAddress, config.assetSymbol);

    console.log(`\n📊 Initial balances:`);
    console.log(`   Agent: ${agentBalanceBefore} ${config.assetSymbol}`);
    console.log(`   Merchant: ${merchantBalanceBefore} ${config.assetSymbol}`);

    // Perform transfer: agent → merchant (0.1)
    console.log(`\n💸 Transferring 0.1 ${config.assetSymbol} from agent to merchant...`);
    await yellow.transfer({
      to: config.merchantAddress,
      allocations: [{
        asset: config.assetSymbol,
        amount: '0.1'
      }]
    });
    console.log('✅ Transfer initiated');

    // Wait a moment for processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check balances after transfer
    const agentBalanceAfter = await safeBalance(yellow, config.agentAddress, config.assetSymbol);
    const merchantBalanceAfter = await safeBalance(yellow, config.merchantAddress, config.assetSymbol);

    console.log(`\n📊 Balances after transfer:`);
    console.log(`   Agent: ${agentBalanceAfter} ${config.assetSymbol}`);
    console.log(`   Merchant: ${merchantBalanceAfter} ${config.assetSymbol}`);

    const agentChange = (Number(agentBalanceAfter) - Number(agentBalanceBefore)).toFixed(1);
    const merchantChange = (Number(merchantBalanceAfter) - Number(merchantBalanceBefore)).toFixed(1);

    console.log(`\n📈 Changes:`);
    console.log(`   Agent: ${agentChange} (expected: -0.1)`);
    console.log(`   Merchant: ${merchantChange} (expected: +0.1)`);

    if (agentChange === '-0.1' && merchantChange === '0.1') {
      console.log('✅ Transfer successful - balances updated correctly');
    } else {
      console.log('❌ Transfer may have issues - balances not updated as expected');
    }

  } catch (error) {
    console.error('❌ Debug failed:', error);
  } finally {
    await yellow.disconnect();
  }
}

async function safeBalance(client, accountId, asset) {
  try {
    return await getBalance(client, accountId, asset);
  } catch (error) {
    console.error(`Balance check failed (${accountId}):`, error);
    return 'unavailable';
  }
}

async function getBalance(client, accountId, asset) {
  const balances = await client.getLedgerBalances(accountId);
  const match = balances.find(entry => entry.asset === asset);
  return match?.amount ?? '0';
}

// Run the debug
debugBalanceTransfers().catch(console.error);