/**
 * Withdraw funds from Custody ledger back to wallet
 * Since we can't create channel, let's get the USDC back
 */
import { config } from 'dotenv';
config({ override: true });
import { NitroliteClient, WalletStateSigner } from '@erc7824/nitrolite';
import { createPublicClient, createWalletClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { getYellowConfig } from '../src/yellow/config.js';

const CUSTODY_ADDRESS = '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6';
const ADJUDICATOR_ADDRESS = '0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

async function main() {
  const cfg = getYellowConfig();
  const account = privateKeyToAccount(cfg.agentPrivateKey as `0x${string}`);

  console.log('=== Withdraw from Custody to Wallet ===\n');
  console.log('Agent:', account.address);
  console.log('Network: Base Production\n');

  const publicClient = createPublicClient({
    chain: base,
    transport: http(),
  }) as any;

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(),
  }) as any;

  const nitroliteClient = new NitroliteClient({
    publicClient,
    walletClient,
    stateSigner: new WalletStateSigner(walletClient),
    addresses: {
      custody: CUSTODY_ADDRESS as `0x${string}`,
      adjudicator: ADJUDICATOR_ADDRESS as `0x${string}`,
    },
    chainId: base.id,
    challengeDuration: 3600n,
  });

  // Check custody balance
  console.log('Step 1: Checking custody balance...');
  const custodyBalance = (await publicClient.readContract({
    address: CUSTODY_ADDRESS,
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
    ],
    functionName: 'getAccountsBalances',
    args: [[account.address], [USDC_ADDRESS]],
  })) as bigint[][];

  const balance = custodyBalance[0]?.[0] ?? 0n;
  console.log('SUCCESS:', formatUnits(balance, 6), 'USDC in custody\n');

  if (balance === 0n) {
    console.log('ERROR: No custody balance to withdraw');
    process.exit(1);
  }

  // Withdraw
  console.log('Step 2: Withdrawing to wallet...');
  const txHash = await nitroliteClient.withdrawal(USDC_ADDRESS as `0x${string}`, balance);

  console.log('SUCCESS: Withdrawal submitted!');
  console.log('   Amount:', formatUnits(balance, 6), 'USDC');
  console.log('   TX Hash:', txHash);
  console.log('   Basescan: https://basescan.org/tx/' + txHash);
  console.log('');
  console.log('Funds will return to agent wallet on Base.');

  process.exit(0);
}

main().catch(error => {
  console.error('Withdrawal failed:', error);
  process.exit(1);
});
