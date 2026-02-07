import { config } from 'dotenv';
config({ override: true });
import { NitroliteClient, WalletStateSigner } from '@erc7824/nitrolite';
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem';
import { sepolia, base, polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { getYellowConfig } from './yellow/config.js';

// Contract addresses from Yellow Network
const CONTRACTS = {
  sepolia: {
    custody: '0x019B65A265EB3363822f2752141b3dF16131b262',
    adjudicator: '0x7c7ccbc98469190849BCC6c926307794fDfB11F2',
    token: '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb',
    symbol: 'ytest.usd',
    chainId: 11155111,
    clearnode: 'wss://clearnet-sandbox.yellow.com/ws',
  },
  base: {
    custody: '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6',
    adjudicator: '0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C',
    token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Real USDC on Base
    symbol: 'usdc',
    chainId: 8453,
    clearnode: 'wss://clearnet.yellow.com/ws', // PRODUCTION
  },
  polygon: {
    custody: '0x6F71a38d919ad713D0AfE0eB712b95064Fc2616f',
    adjudicator: '0x14980dF216722f14c42CA7357b06dEa7eB408b10',
    token: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // Real USDC on Polygon
    symbol: 'usdc',
    chainId: 137,
    clearnode: 'wss://clearnet.yellow.com/ws', // PRODUCTION
  },
};

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;

export async function onrampAgent(
  amount: number,
  network: 'sepolia' | 'base' | 'polygon' = 'base',
) {
  const cfg = getYellowConfig();

  if (!cfg.agentPrivateKey) {
    throw new Error('YELLOW_AGENT_PRIVATE_KEY is required');
  }

  const account = privateKeyToAccount(cfg.agentPrivateKey as `0x${string}`);
  const contracts = CONTRACTS[network];
  const chain = network === 'base' ? base : network === 'polygon' ? polygon : sepolia;

  console.log('=== Agent Onramp to Yellow Network ===\n');
  console.log(`Agent: ${account.address}`);
  console.log(`Network: ${chain.name} (chain ${chain.id})`);
  console.log(`Amount: ${amount} ${contracts.symbol}`);
  console.log(`Clearnode: ${contracts.clearnode}\n`);

  const transactions: Array<{ step: string; hash: string }> = [];

  try {
    // Initialize clients
    const publicClient = createPublicClient({
      chain,
      transport: http(),
    }) as any; // Type workaround for viem version conflict

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(),
    }) as any;

    const nitroliteClient = new NitroliteClient({
      publicClient,
      walletClient,
      stateSigner: new WalletStateSigner(walletClient),
      addresses: {
        custody: contracts.custody as `0x${string}`,
        adjudicator: contracts.adjudicator as `0x${string}`,
      },
      chainId: chain.id,
      challengeDuration: 3600n,
    });

    // STEP 1: Check wallet token balance
    console.log(`Step 1/4: Checking wallet ${contracts.symbol} balance...`);
    const walletBalance = (await publicClient.readContract({
      address: contracts.token as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    })) as bigint;

    const decimals = contracts.symbol === 'usdc' ? 6 : 6; // Both use 6 decimals
    const walletBalanceFormatted = Number(formatUnits(walletBalance, decimals));
    console.log(`SUCCESS: Wallet balance: ${walletBalanceFormatted} ${contracts.symbol}`);

    const requiredAmount = parseUnits(amount.toString(), decimals);
    if (walletBalance < requiredAmount) {
      console.log(`\nERROR: Insufficient balance. Need ${amount}, have ${walletBalanceFormatted}`);
      if (network === 'sepolia') {
        console.log(`\nFor Sepolia testnet, get test tokens from Yellow faucet:`);
        console.log(`  curl -X POST https://clearnet-sandbox.yellow.com/faucet/requestTokens \\`);
        console.log(`    -H "Content-Type: application/json" \\`);
        console.log(`    -d '{"userAddress":"${account.address}"}'`);
        console.log(`Note: Faucet sends to unified balance, not wallet.`);
      } else {
        console.log(`\nFor ${chain.name}, you need to:`);
        console.log(`  1. Buy ${contracts.symbol} on an exchange (Coinbase, Binance)`);
        console.log(`  2. Send to your agent wallet: ${account.address}`);
        console.log(`  3. Wait for confirmation`);
        console.log(`  4. Run this script again`);
      }
      throw new Error(
        `Insufficient ${contracts.symbol}. Need ${amount}, have ${walletBalanceFormatted}`,
      );
    }
    console.log('');

    // STEP 2: Approve Custody contract
    console.log('Step 2/4: Approving Custody contract...');
    const amountBigInt = parseUnits(amount.toString(), 6);

    const approveTx = await walletClient.writeContract({
      address: contracts.token as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [contracts.custody as `0x${string}`, amountBigInt],
    });

    console.log('   Waiting for approval confirmation...');
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
    transactions.push({ step: 'Approve USDC', hash: approveTx });

    console.log(`SUCCESS: Approval confirmed`);
    console.log(`   TX Hash: ${approveTx}`);
    const explorerUrl =
      network === 'sepolia'
        ? 'sepolia.etherscan.io'
        : network === 'base'
          ? 'basescan.org'
          : 'polygonscan.com';
    console.log(`   Etherscan: https://${explorerUrl}/tx/${approveTx}\n`);

    // STEP 3: Deposit to Custody contract
    console.log('Step 3/4: Depositing to Custody contract...');
    const depositTx = await nitroliteClient.deposit(contracts.token as `0x${string}`, amountBigInt);

    transactions.push({ step: 'Deposit to Custody', hash: depositTx });
    console.log(`SUCCESS: Deposited to custody ledger`);
    console.log(`   Amount: ${amount} ${contracts.symbol}`);
    console.log(`   TX Hash: ${depositTx}`);
    console.log(`   Explorer: https://${explorerUrl}/tx/${depositTx}\n`);

    // STEP 4: Verify custody ledger balance
    console.log('Step 4/4: Verifying custody ledger balance...');
    await new Promise(r => setTimeout(r, 5000)); // Wait for indexing

    const custodyBalance = await publicClient.readContract({
      address: contracts.custody as `0x${string}`,
      abi: [
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
      ] as const,
      functionName: 'getAccountsBalances',
      args: [[account.address], [contracts.token as `0x${string}`]],
    });

    const ledgerBalance = (custodyBalance as bigint[][])[0]?.[0] ?? 0n;
    const ledgerBalanceFormatted = Number(formatUnits(ledgerBalance, decimals));

    console.log(`SUCCESS: Custody ledger balance: ${ledgerBalanceFormatted} ${contracts.symbol}`);
    console.log(`   Agent can now use funds for app sessions\n`);

    // Summary
    console.log('=== Onramp Summary ===');
    console.log(`Amount onramped: ${amount} ${contracts.symbol}`);
    console.log(`From: Agent wallet (${network})`);
    console.log(`To: Custody ledger (ready for Yellow Network)`);
    console.log('');
    console.log('TRANSACTIONS:');
    transactions.forEach((tx, i) => {
      console.log(`  ${i + 1}. ${tx.step}: https://${explorerUrl}/tx/${tx.hash}`);
    });
    console.log('\nSUCCESS: Agent onramp complete!');
    console.log('Agent can now create channels and use app sessions.\n');

    return {
      amountOnramped: amount,
      custodyBalance: ledgerBalanceFormatted,
      transactions,
      network,
      tokenSymbol: contracts.symbol,
    };
  } catch (error) {
    console.error('\nERROR: Onramp failed:', error);
    throw error;
  }
}

async function main() {
  const amount = process.argv[2] ? parseFloat(process.argv[2]) : 2;
  const network = (process.argv[3] || 'base') as 'sepolia' | 'base' | 'polygon';

  console.log(`\nℹ️  Note: Using ${network === 'sepolia' ? 'SANDBOX' : 'PRODUCTION'} network`);
  if (network !== 'sepolia') {
    console.log(
      `⚠️  WARNING: This will use REAL ${network === 'base' ? 'USDC on Base' : 'USDC on Polygon'}`,
    );
    console.log(`   Make sure you have ~${amount + 0.5} USDC in wallet for amount + gas fees\n`);
  }

  await onrampAgent(amount, network);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Agent onramp failed:', error);
    process.exit(1);
  });
}
