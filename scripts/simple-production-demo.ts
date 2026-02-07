/**
 * Simple Production Demo - Real USDC on Base
 *
 * Complete automated flow showing agent → merchant payment with real money.
 * All steps run automatically with blockchain evidence.
 */
import { execSync } from 'child_process';
import { config } from 'dotenv';
config({ override: true });

const AGENT = process.env.YELLOW_AGENT_ADDRESS!;
const MERCHANT = process.env.YELLOW_MERCHANT_ADDRESS!;

function runCommand(cmd: string, description: string) {
  console.log(`\n⚙️  ${description}...`);
  try {
    execSync(cmd, { stdio: 'inherit', env: { ...process.env } });
    console.log(`✅ ${description} - Complete\n`);
  } catch (error) {
    console.error(`❌ ${description} - Failed`);
    throw error;
  }
}

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║     PRODUCTION DEMO - Real USDC on Base Mainnet              ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  console.log('🎯 OBJECTIVE: Agent pays merchant 0.2 USDC for MCP tools\n');
  console.log('Participants:');
  console.log(`  Agent:    ${AGENT}`);
  console.log(`  Merchant: ${MERCHANT}`);
  console.log('  Network:  Base Mainnet (real USDC!)');
  console.log('  Asset:    usdc (ERC-20)\n');

  console.log('⚠️  WARNING: This uses real money! Make sure:');
  console.log('  1. Agent has ~1 USDC on Base (for session)');
  console.log('  2. Agent has ~0.001 ETH on Base (for gas)');
  console.log('  3. You understand the flow before proceeding\n');

  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>(resolve => {
    readline.question('Continue with production demo? (yes/no): ', (ans: string) => {
      readline.close();
      resolve(ans);
    });
  });

  if (answer.toLowerCase() !== 'yes') {
    console.log('Demo cancelled.');
    return;
  }

  console.log('\n📋 PRODUCTION FLOW:');
  console.log('  1. Check starting balances');
  console.log('  2. Run agentkit demo (creates session, pays merchant)');
  console.log('  3. Merchant offramp (withdraws to wallet)');
  console.log('  4. Verify final balances\n');

  try {
    // Step 1: Check starting state
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('STEP 1: Starting Balances');
    console.log('═══════════════════════════════════════════════════════════════');

    runCommand('npx tsx scripts/check-base-balance.ts', 'Checking agent wallet balance on Base');

    // Step 2: Run agentkit demo with production config
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('STEP 2: Agent Uses MCP Tools (Pays Merchant)');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('\n📝 This step will:');
    console.log('  - Agent creates Yellow Network app session (1 USDC)');
    console.log('  - Agent authenticates with SIWx');
    console.log('  - Agent queries stock_price (0.1 USDC)');
    console.log('  - Agent queries market_rumors (0.1 USDC)');
    console.log('  - Session closes with quorum 2 settlement');
    console.log('  - Merchant receives 0.2 USDC (in unified balance)');
    console.log('  - Agent gets 0.8 USDC refund\n');

    runCommand(
      'YELLOW_CLEARNODE_URL=wss://clearnet.yellow.com/ws YELLOW_ENV=production npm run demo:agentkit',
      'Running agentkit demo on production',
    );

    // Step 3: Merchant offramp
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('STEP 3: Merchant Withdraws to Wallet');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('\n📝 This step will:');
    console.log('  - Create payment channel');
    console.log('  - Move unified balance to channel');
    console.log('  - Close channel (settles to custody)');
    console.log('  - Withdraw from custody to wallet');
    console.log('  - Generate Basescan transaction links\n');

    runCommand(`npx tsx src/merchant-offramp.ts ${MERCHANT} base`, 'Merchant offramp to wallet');

    // Step 4: Verify final state
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('STEP 4: Final Verification');
    console.log('═══════════════════════════════════════════════════════════════');

    runCommand('npx tsx scripts/check-base-balance.ts', 'Checking final balances');

    // Success summary
    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                    🎉 DEMO COMPLETE! 🎉                       ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');

    console.log('✅ PROVEN:');
    console.log('  ✓ Agent paid 0.2 USDC for MCP tools');
    console.log('  ✓ Merchant received payment in unified balance');
    console.log('  ✓ Merchant withdrew to wallet (real USDC)');
    console.log('  ✓ All transactions recorded on Base blockchain\n');

    console.log('🔍 EVIDENCE:');
    console.log('  - Yellow Network transaction logs (see output above)');
    console.log('  - Basescan withdrawal transactions (see links above)');
    console.log('  - Updated wallet balances (Base explorer)\n');

    console.log('📊 ARCHITECTURE VALIDATED:');
    console.log('  ✓ SIWx authentication (wallet-based auth)');
    console.log('  ✓ Yellow Network app sessions (off-chain payments)');
    console.log('  ✓ Quorum 2 settlement (merchant + agent signatures)');
    console.log('  ✓ Unified balance → wallet offramp');
    console.log('  ✓ Real blockchain integration\n');
  } catch (error) {
    console.error('\n❌ Demo failed:', error);
    console.log('\n💡 TROUBLESHOOTING:');
    console.log('  1. Check agent has USDC on Base');
    console.log('  2. Check agent has ETH for gas on Base');
    console.log('  3. Verify .env has all required keys');
    console.log('  4. Check Yellow Network status');
    console.log('  5. Try running steps individually\n');
    process.exit(1);
  }
}

main();
