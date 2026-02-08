/**
 * Deposit onchain USDC into Circle Gateway unified balance (Arc Testnet).
 *
 * This uses GatewayWallet.deposit(token, value).
 * DO NOT send a plain ERC-20 transfer to the GatewayWallet contract.
 *
 * Usage:
 *   npx tsx scripts/arc-gateway-deposit.ts 10
 *
 * Env:
 *   YELLOW_AGENT_PRIVATE_KEY (preferred) or EVM_PRIVATE_KEY
 *   ARC_RPC_URL (optional)
 */
import { config } from 'dotenv';
config({ override: true });

import { createPublicClient, createWalletClient, erc20Abi, formatUnits, getContract, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ARC_TESTNET, arcTestnetChain, getArcConfig } from '../src/arc/config.js';

const gatewayWalletAbi = [
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

async function main() {
  const privateKey = (process.env.YELLOW_AGENT_PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY ?? '').trim();
  if (!privateKey) {
    throw new Error('Missing private key. Set YELLOW_AGENT_PRIVATE_KEY (or EVM_PRIVATE_KEY) in .env');
  }

  const amountStr = (process.argv[2] ?? process.env.GATEWAY_DEPOSIT_USDC ?? '10').trim();
  const amountNum = Number(amountStr);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new Error('Invalid amount. Provide USDC amount like: tsx scripts/arc-gateway-deposit.ts 10');
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const arcRuntime = getArcConfig();
  const rpcUrl = arcRuntime.rpcUrl;
  const usdcAddress = arcRuntime.usdcAddress;

  const publicClient = createPublicClient({
    chain: arcTestnetChain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: arcTestnetChain,
    transport: http(rpcUrl),
  });

  const usdc = getContract({
    address: usdcAddress,
    abi: erc20Abi,
    client: walletClient,
  });

  const gatewayWallet = getContract({
    address: ARC_TESTNET.gatewayWallet as `0x${string}`,
    abi: gatewayWalletAbi,
    client: walletClient,
  });

  const amount = parseUnits(amountStr, 6);

  console.log('\n=== Circle Gateway Deposit (Arc Testnet) ===\n');
  console.log('RPC:', rpcUrl);
  console.log('Agent:', account.address);
  console.log('USDC:', usdcAddress);
  console.log('GatewayWallet:', ARC_TESTNET.gatewayWallet);
  console.log('Deposit:', `${amountStr} USDC`);

  const balance = await publicClient.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log('Onchain USDC balance:', formatUnits(balance, 6), 'USDC');

  if (balance < amount) {
    throw new Error(`Insufficient onchain USDC. Need ${amountStr}, have ${formatUnits(balance, 6)}`);
  }

  const allowance = await publicClient.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, ARC_TESTNET.gatewayWallet as `0x${string}`],
  });
  console.log('Allowance to GatewayWallet:', formatUnits(allowance, 6), 'USDC');

  if (allowance < amount) {
    console.log('\nApproving GatewayWallet...');
    const approveHash = await walletClient.writeContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [ARC_TESTNET.gatewayWallet as `0x${string}`, amount],
    });
    console.log('Approve tx:', approveHash);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('Approve confirmed.');
  } else {
    console.log('Approve skipped (allowance sufficient).');
  }

  console.log('\nDepositing into GatewayWallet...');
  const depositHash = await gatewayWallet.write.deposit([usdcAddress, amount], {
    account,
  });
  console.log('Deposit tx:', depositHash);
  await publicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log('Deposit confirmed.');

  console.log('\nChecking unified balance via Gateway API...');
  const res = await fetch(`${ARC_TESTNET.gatewayApiBaseUrl}/v1/balances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'USDC',
      sources: [{ depositor: account.address, domain: ARC_TESTNET.gatewayDomain }],
    }),
  });
  const text = await res.text();
  console.log(text);

  console.log('\nDone.\n');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

