import { config } from 'dotenv';
config({ override: true });
import { createPublicClient, http, formatEther, formatUnits } from 'viem';
import { base } from 'viem/chains';

const address = process.env.YELLOW_AGENT_ADDRESS;
const merchantAddress = process.env.YELLOW_MERCHANT_ADDRESS;
const usdcAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

if (!address) {
  console.error('ERROR: YELLOW_AGENT_ADDRESS not set in .env');
  process.exit(1);
}

async function checkBalance(addr: string, label: string) {
  const client = createPublicClient({
    chain: base,
    transport: http(),
  });

  console.log(`\n=== ${label} ===`);
  console.log('Address:', addr);
  console.log('Network: Base Mainnet (Chain 8453)\n');

  // Check ETH balance
  const ethBalance = await client.getBalance({ address: addr as `0x${string}` });
  console.log('ETH Balance:', formatEther(ethBalance), 'ETH');

  if (ethBalance === 0n) {
    console.log('  ⚠️  WARNING: Need ~0.001 ETH for gas fees');
  } else if (ethBalance < 1000000000000000n) {
    console.log('  ⚠️  Low ETH, may not be enough for gas');
  } else {
    console.log('  ✓ Sufficient for gas fees');
  }
  console.log('');

  // Check USDC balance
  const usdcBalance = (await client.readContract({
    address: usdcAddress as `0x${string}`,
    abi: [
      {
        name: 'balanceOf',
        type: 'function',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ type: 'uint256' }],
        stateMutability: 'view',
      },
    ],
    functionName: 'balanceOf',
    args: [addr as `0x${string}`],
  })) as bigint;

  console.log('USDC Balance:', formatUnits(usdcBalance, 6), 'USDC');

  if (usdcBalance === 0n) {
    console.log('  ⚠️  WARNING: Need USDC for testing');
  } else if (usdcBalance < 1000000n) {
    console.log('  ⚠️  Low USDC');
  } else {
    console.log('  ✓ Sufficient USDC');
  }
  console.log('');

  console.log('Basescan:', 'https://basescan.org/address/' + addr);

  return { ethBalance, usdcBalance };
}

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║     Base Mainnet Balance Check                        ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  // Check agent balance
  const agentBalances = await checkBalance(address!, 'Agent Wallet');

  // Check merchant balance if set
  if (merchantAddress) {
    const merchantBalances = await checkBalance(merchantAddress, 'Merchant Wallet');
  }

  // Overall status
  console.log('\n=== Overall Status ===\n');

  if (agentBalances.ethBalance === 0n && agentBalances.usdcBalance === 0n) {
    console.log('❌ Agent wallet is empty - needs funding');
    console.log('');
    console.log('To fund:');
    console.log('  1. Buy USDC on Coinbase');
    console.log('  2. Withdraw to Base network');
    console.log('  3. Send to agent address above');
    console.log('  4. Also send 0.001 ETH for gas\n');
  } else if (agentBalances.ethBalance < 1000000000000000n) {
    console.log('⚠️  Agent needs more ETH for gas fees\n');
  } else if (agentBalances.usdcBalance < 1000000n) {
    console.log('⚠️  Agent needs more USDC for testing\n');
  } else {
    console.log('✅ Ready for production demo!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Run full demo: npx tsx scripts/simple-production-demo.ts');
    console.log('  2. Or step by step:');
    console.log('     - npm run agent-onramp -- 1 base');
    console.log('     - YELLOW_ENV=production npm run demo:agentkit');
    console.log('     - npm run merchant-offramp -- base\n');
  }
}

main().catch(console.error);
