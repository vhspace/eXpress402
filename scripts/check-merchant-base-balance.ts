import { createPublicClient, http, formatEther, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';
config({ override: true });

const address = process.env.YELLOW_MERCHANT_ADDRESS as `0x${string}`;
const usdcAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

async function main() {
  const client = createPublicClient({
    chain: base,
    transport: http(),
  });

  console.log('Checking Merchant Base wallet balances...\n');
  console.log('Address:', address);
  console.log('Network: Base Mainnet (Chain 8453)\n');

  // Check ETH balance
  const ethBalance = await client.getBalance({ address });
  console.log('ETH Balance:', formatEther(ethBalance), 'ETH');
  console.log('  (~$' + (Number(formatEther(ethBalance)) * 2135).toFixed(2) + ' USD)');

  if (ethBalance === 0n) {
    console.log('  ✗ No ETH for gas');
  } else if (ethBalance < 50000000000000n) {
    console.log('  ⚠️  Low but should work for 1-2 transactions');
  } else {
    console.log('  ✓ Sufficient for gas fees');
  }
  console.log('');

  // Check USDC balance
  const usdcBalance = (await client.readContract({
    address: usdcAddress,
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
    args: [address],
  })) as bigint;

  console.log('USDC Balance:', formatUnits(usdcBalance, 6), 'USDC');

  if (usdcBalance > 0n) {
    console.log('  ✓ Merchant already has USDC!');
  } else {
    console.log('  (Will receive USDC after demo)');
  }
  console.log('');

  console.log('Basescan:', 'https://basescan.org/address/' + address);
  console.log('');

  if (ethBalance > 0n) {
    console.log('STATUS: ✓ Ready for merchant offramp test!');
  } else {
    console.log('STATUS: Waiting for ETH...');
  }
}

main().catch(console.error);
