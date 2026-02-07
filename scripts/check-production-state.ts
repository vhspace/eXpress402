/**
 * Check Production State - Comprehensive diagnostic
 *
 * Checks all aspects of production readiness:
 * - Wallet balances (on-chain)
 * - Custody balances (on-chain)
 * - Unified balances (off-chain)
 * - Yellow Network connectivity
 */
import { config } from 'dotenv';
config({ override: true });
import { createPublicClient, http, formatEther, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { YellowRpcClient } from '../src/yellow/rpc.js';
import { getYellowConfig } from '../src/yellow/config.js';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const CUSTODY_ADDRESS = '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6';

const CUSTODY_ABI = [
  {
    name: 'getAccountsBalances',
    type: 'function',
    inputs: [
      { name: 'accounts', type: 'address[]' },
      { name: 'tokens', type: 'address[]' },
    ],
    outputs: [{ type: 'uint256[][]' }],
    stateMutability: 'view',
  },
] as const;

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

async function checkWalletBalances(address: string, label: string) {
  console.log(`\n=== ${label} - Wallet (On-Chain) ===`);

  const client = createPublicClient({
    chain: base,
    transport: http(),
  });

  // ETH balance
  const ethBalance = await client.getBalance({ address: address as `0x${string}` });
  console.log(`ETH: ${formatEther(ethBalance)} ETH`);

  if (ethBalance < 1000000000000000n) {
    console.log('  ⚠️  Low ETH for gas');
  } else {
    console.log('  ✓ Sufficient gas');
  }

  // USDC balance
  const usdcBalance = (await client.readContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
  })) as bigint;

  console.log(`USDC: ${formatUnits(usdcBalance, 6)} USDC`);

  if (usdcBalance === 0n) {
    console.log('  ⚠️  No USDC in wallet');
  } else {
    console.log('  ✓ Has USDC');
  }

  return { ethBalance, usdcBalance };
}

async function checkCustodyBalance(address: string, label: string) {
  console.log(`\n=== ${label} - Custody (On-Chain Ledger) ===`);

  const client = createPublicClient({
    chain: base,
    transport: http(),
  });

  const balances = await client.readContract({
    address: CUSTODY_ADDRESS as `0x${string}`,
    abi: CUSTODY_ABI,
    functionName: 'getAccountsBalances',
    args: [[address as `0x${string}`], [USDC_ADDRESS as `0x${string}`]],
  });

  const custodyBalance = (balances as bigint[][])[0]?.[0] ?? 0n;
  console.log(`USDC in Custody: ${formatUnits(custodyBalance, 6)} USDC`);

  if (custodyBalance === 0n) {
    console.log('  ℹ️  No custody balance (run: npm run agent-onramp -- 1 base)');
  } else {
    console.log('  ✓ Has custody balance');
  }

  return custodyBalance;
}

async function checkUnifiedBalance(privateKey: string, label: string) {
  console.log(`\n=== ${label} - Unified Balance (Off-Chain Ledger) ===`);

  try {
    const yellowClient = new YellowRpcClient({
      url: 'wss://clearnet.yellow.com/ws',
      privateKey,
    });

    await yellowClient.connect();

    const balances = await yellowClient.getLedgerBalances();

    if (balances.length === 0) {
      console.log('  ℹ️  No unified balance');
      console.log('  Need to bridge: custody → unified (via Yellow apps UI)');
      return 0;
    }

    balances.forEach((b: { asset: string; amount: string }) => {
      console.log(`  ${b.asset}: ${b.amount}`);
    });

    const usdcBalance = balances.find((b: { asset: string }) => b.asset === 'usdc');
    if (usdcBalance) {
      const amount = Number(usdcBalance.amount);
      if (amount >= 1) {
        console.log('  ✓ Sufficient for app session (need 1 USDC)');
      } else {
        console.log('  ⚠️  Need at least 1 USDC for app session');
      }
      return amount;
    }

    console.log('  ℹ️  No USDC in unified balance');
    return 0;
  } catch (error: any) {
    console.log('  ❌ Failed to check unified balance:', error.message);
    return 0;
  }
}

async function checkYellowNetworkConnectivity() {
  console.log('\n=== Yellow Network Connectivity ===');

  try {
    const yellowClient = new YellowRpcClient({
      url: 'wss://clearnet.yellow.com/ws',
    });

    await yellowClient.connect();
    console.log('  ✓ Connected to production clearnode');

    return true;
  } catch (error: any) {
    console.log('  ❌ Cannot connect to clearnode:', error.message);
    return false;
  }
}

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║          Production State Check - Base Mainnet               ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  const cfg = getYellowConfig();

  if (!cfg.agentAddress || !cfg.agentPrivateKey) {
    console.error('\n❌ Missing agent configuration in .env');
    console.error('Run: npm run setup');
    process.exit(1);
  }

  if (!cfg.merchantAddress || !cfg.merchantPrivateKey) {
    console.error('\n❌ Missing merchant configuration in .env');
    console.error('Run: npm run setup');
    process.exit(1);
  }

  console.log('\nNetwork: Base Mainnet (Chain 8453)');
  console.log('Clearnode: wss://clearnet.yellow.com/ws');
  console.log('Asset: usdc (real USDC)\n');

  // Check Yellow Network first
  const yellowConnected = await checkYellowNetworkConnectivity();

  // Check agent
  console.log('\n' + '='.repeat(65));
  console.log('AGENT: ' + cfg.agentAddress);
  console.log('='.repeat(65));

  const agentWallet = await checkWalletBalances(cfg.agentAddress, 'Agent');
  const agentCustody = await checkCustodyBalance(cfg.agentAddress, 'Agent');
  const agentUnified = yellowConnected
    ? await checkUnifiedBalance(cfg.agentPrivateKey, 'Agent')
    : 0;

  // Check merchant
  console.log('\n' + '='.repeat(65));
  console.log('MERCHANT: ' + cfg.merchantAddress);
  console.log('='.repeat(65));

  const merchantWallet = await checkWalletBalances(cfg.merchantAddress, 'Merchant');
  const merchantCustody = await checkCustodyBalance(cfg.merchantAddress, 'Merchant');
  const merchantUnified = yellowConnected
    ? await checkUnifiedBalance(cfg.merchantPrivateKey, 'Merchant')
    : 0;

  // Summary
  console.log('\n' + '='.repeat(65));
  console.log('PRODUCTION READINESS SUMMARY');
  console.log('='.repeat(65) + '\n');

  let ready = true;
  let warnings = [];

  // Agent checks
  if (agentWallet.ethBalance < 1000000000000000n) {
    ready = false;
    warnings.push('❌ Agent needs ETH for gas (minimum 0.001 ETH)');
  }

  if (agentUnified < 1) {
    ready = false;
    warnings.push('❌ Agent needs unified balance (minimum 1 USDC for session)');

    if (agentCustody > 0n) {
      warnings.push('   ℹ️  Agent has custody balance - bridge to unified via:');
      warnings.push('      https://apps.yellow.com');
    } else if (Number(formatUnits(agentWallet.usdcBalance, 6)) >= 1) {
      warnings.push('   ℹ️  Agent has wallet USDC - deposit to custody:');
      warnings.push('      npm run agent-onramp -- 1 base');
    } else {
      warnings.push('   ℹ️  Agent needs USDC - buy on Coinbase and send to Base');
    }
  }

  // Merchant checks
  if (merchantWallet.ethBalance < 1000000000000000n) {
    warnings.push('⚠️  Merchant needs ETH for gas (for offramp)');
  }

  if (warnings.length === 0) {
    console.log('✅ READY FOR PRODUCTION DEMO!\n');
    console.log('Run: npm run demo:production\n');
    console.log('Or step by step:');
    console.log('  1. YELLOW_ENV=production npm run demo:agentkit');
    console.log('  2. npm run merchant-offramp -- base');
  } else {
    console.log('⚠️  NOT READY - Fix these issues:\n');
    warnings.forEach(w => console.log(w));
    console.log('\nSee PRODUCTION-ONBOARDING.md for detailed guide.');
  }

  console.log('\n' + '='.repeat(65));
  console.log('BALANCES OVERVIEW');
  console.log('='.repeat(65) + '\n');

  console.log('Agent:');
  console.log(`  Wallet:  ${formatUnits(agentWallet.usdcBalance, 6)} USDC`);
  console.log(`  Custody: ${formatUnits(agentCustody, 6)} USDC`);
  console.log(`  Unified: ${agentUnified} USDC`);
  console.log('');

  console.log('Merchant:');
  console.log(`  Wallet:  ${formatUnits(merchantWallet.usdcBalance, 6)} USDC`);
  console.log(`  Custody: ${formatUnits(merchantCustody, 6)} USDC`);
  console.log(`  Unified: ${merchantUnified} USDC`);
  console.log('');

  console.log('Links:');
  console.log(`  Agent: https://basescan.org/address/${cfg.agentAddress}`);
  console.log(`  Merchant: https://basescan.org/address/${cfg.merchantAddress}`);
  console.log('');
}

main().catch(console.error);
