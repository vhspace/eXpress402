/**
 * Agent sends real USDC to merchant wallet on Base
 * Simplest proof that merchant receives real money
 */
import { config } from 'dotenv';
config({ override: true });
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { getYellowConfig } from '../src/yellow/config.js';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

async function main() {
  const cfg = getYellowConfig();
  const agent = privateKeyToAccount(cfg.agentPrivateKey as `0x${string}`);
  const merchant = cfg.merchantAddress as `0x${string}`;
  const amount = parseFloat(process.argv[2] || '0.2');

  console.log('=== Agent Sends Real USDC to Merchant ===\n');
  console.log('From (Agent):', agent.address);
  console.log('To (Merchant):', merchant);
  console.log('Amount:', amount, 'USDC');
  console.log('Network: Base Mainnet\n');

  const publicClient = createPublicClient({
    chain: base,
    transport: http(),
  });

  const walletClient = createWalletClient({
    account: agent,
    chain: base,
    transport: http(),
  });

  // Check agent balance
  const agentBalance = (await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [agent.address],
  })) as bigint;

  console.log('Agent USDC balance:', formatUnits(agentBalance, 6), 'USDC');

  const amountBigInt = parseUnits(amount.toString(), 6);
  if (agentBalance < amountBigInt) {
    console.log('ERROR: Insufficient USDC');
    process.exit(1);
  }

  // Check merchant before
  const merchantBefore = (await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [merchant],
  })) as bigint;

  console.log('Merchant USDC before:', formatUnits(merchantBefore, 6), 'USDC\n');

  // Send USDC
  console.log('Sending', amount, 'USDC to merchant...');
  const txHash = await walletClient.writeContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [merchant, amountBigInt],
  });

  console.log('Waiting for confirmation...');
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status === 'success') {
    console.log('\nSUCCESS: Transfer confirmed!');
    console.log('  TX Hash:', txHash);
    console.log('  Basescan: https://basescan.org/tx/' + txHash);
    console.log('');

    // Check merchant after
    await new Promise(r => setTimeout(r, 2000));
    const merchantAfter = (await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [merchant],
    })) as bigint;

    console.log('Merchant USDC after:', formatUnits(merchantAfter, 6), 'USDC');
    console.log('Change:', '+' + formatUnits(merchantAfter - merchantBefore, 6), 'USDC');
    console.log('');
    console.log('✓ PROVEN: Merchant received real USDC in wallet!');
    console.log('✓ Basescan evidence: Check link above');
  } else {
    console.log('\nERROR: Transaction failed');
    process.exit(1);
  }
}

main().catch(console.error);
