/**
 * Bridge Custody Ledger → Unified Balance
 * Creates funded channel from custody deposits
 */
import { config } from 'dotenv';
config({ override: true });
import {
  NitroliteClient,
  WalletStateSigner,
  createECDSAMessageSigner,
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
  createEIP712AuthMessageSigner,
} from '@erc7824/nitrolite';
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import WebSocket from 'ws';
import { getYellowConfig } from '../src/yellow/config.js';

const CUSTODY_ADDRESS = '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6';
const ADJUDICATOR_ADDRESS = '0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

async function main() {
  const cfg = getYellowConfig();
  const account = privateKeyToAccount(cfg.agentPrivateKey as `0x${string}`);
  const amountToFund = parseFloat(process.argv[2] || '2'); // How much to move to unified

  console.log('=== Bridge: Custody → Unified Balance ===\n');
  console.log('Agent:', account.address);
  console.log('Network: Base Production');
  console.log('Amount:', amountToFund, 'USDC\n');

  // Setup blockchain clients
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

  const custodyBal = custodyBalance[0]?.[0] ?? 0n;
  console.log('   Custody:', formatUnits(custodyBal, 6), 'USDC');

  if (custodyBal === 0n) {
    console.log('ERROR: No custody funds. Run: npm run agent-onramp -- 2 base');
    process.exit(1);
  }

  const amountBigInt = parseUnits(amountToFund.toString(), 6);
  if (custodyBal < amountBigInt) {
    console.log(
      'ERROR: Insufficient custody. Have',
      formatUnits(custodyBal, 6),
      'need',
      amountToFund,
    );
    process.exit(1);
  }

  // Connect to production
  console.log('\nStep 2: Connecting to production clearnode...');
  const ws = new WebSocket('wss://clearnet.yellow.com/ws');

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 10000);
  });

  // Authenticate
  const sessionPrivateKey = generatePrivateKey();
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);
  const sessionSigner = createECDSAMessageSigner(sessionPrivateKey);

  await new Promise<void>(async (resolve, reject) => {
    const authParams = {
      session_key: sessionAccount.address as `0x${string}`,
      allowances: [{ asset: 'usdc', amount: '1000000' }],
      expires_at: BigInt(Math.floor(Date.now() / 1000) + 3600),
      scope: 'bridge',
    };

    const authRequestMsg = await createAuthRequestMessage({
      address: account.address,
      application: 'custody-bridge',
      ...authParams,
    });

    ws.on('message', async data => {
      const response = JSON.parse(data.toString());
      if (response.res && response.res[1] === 'auth_challenge') {
        const challenge = response.res[2].challenge_message;
        const signer = createEIP712AuthMessageSigner(walletClient, authParams, {
          name: 'custody-bridge',
        });
        const verifyMsg = await createAuthVerifyMessageFromChallenge(signer, challenge);
        ws.send(verifyMsg);
      }
      if (response.res && response.res[1] === 'auth_verify') {
        console.log('   Authenticated\n');
        resolve();
      }
    });

    ws.send(authRequestMsg);
  });

  // Create empty channel, then fund via resize
  console.log('Step 3: Creating empty channel...');
  console.log('   NOTE: Must create with [0,0], then fund via resize\n');

  const { createCreateChannelMessage } = await import('@erc7824/nitrolite');

  const channelId = await new Promise<string>((resolve, reject) => {
    let resolved = false;

    ws.on('message', async data => {
      if (resolved) return;
      const msg = JSON.parse(data.toString());
      const type = msg.res ? msg.res[1] : '';

      if (type === 'create_channel') {
        const { channel_id, channel, state, server_signature } = msg.res[2];
        console.log('   Yellow RPC prepared channel:', channel_id);
        console.log('   Creating empty channel on blockchain...');

        const emptyState = {
          intent: state.intent,
          version: BigInt(state.version),
          data: state.state_data || '0x',
          allocations: state.allocations.map((a: any) => ({
            destination: a.destination as `0x${string}`,
            token: a.token as `0x${string}`,
            amount: BigInt(a.amount),
          })),
        };

        try {
          const result = await nitroliteClient.createChannel({
            channel,
            unsignedInitialState: emptyState,
            serverSignature: server_signature,
          });

          console.log('   SUCCESS: Empty channel created!');
          console.log('   TX Hash:', result.txHash);
          console.log('   Basescan: https://basescan.org/tx/' + result.txHash);
          console.log('');

          resolved = true;
          resolve(channel_id);
        } catch (error: any) {
          console.error('   ERROR:', error.message || error);
          reject(error);
        }
      }

      if (type === 'error') {
        console.error('RPC Error:', msg.res[2]);
        reject(new Error(JSON.stringify(msg.res[2])));
      }
    });

    // Request channel creation
    createCreateChannelMessage(sessionSigner, {
      chain_id: 8453,
      token: USDC_ADDRESS as `0x${string}`,
    }).then(m => ws.send(m));

    setTimeout(() => {
      if (!resolved) reject(new Error('Timeout waiting for channel'));
    }, 30000);
  });

  // Step 4: Fund channel via resize (custody → channel)
  console.log('\nStep 4: Funding channel from custody via resize...');
  console.log('   Waiting 25s for channel indexing...');
  await new Promise(r => setTimeout(r, 25000));

  const { createResizeChannelMessage } = await import('@erc7824/nitrolite');

  await new Promise<void>((resolve, reject) => {
    ws.on('message', async data => {
      const msg = JSON.parse(data.toString());
      const type = msg.res ? msg.res[1] : '';

      if (type === 'resize_channel') {
        console.log('   Yellow RPC resize prepared');
        console.log('   NOTE: Using resize_amount to fund from custody');
        console.log('   This moves: Custody → Channel → Unified\n');
        resolve();
      }

      if (type === 'error') {
        console.error('   Resize error:', msg.res[2]);
        reject(new Error(JSON.stringify(msg.res[2])));
      }
    });

    console.log('   Requesting resize with resize_amount (custody funding)...');
    createResizeChannelMessage(sessionSigner, {
      channel_id: channelId as `0x${string}`,
      resize_amount: amountBigInt, // Positive = deposit FROM CUSTODY to channel
      allocate_amount: 0n, // Don't touch unified
      funds_destination: account.address,
    }).then(m => ws.send(m));

    setTimeout(() => reject(new Error('Resize timeout')), 30000);
  });

  console.log('   Resize prepared by clearnode');
  console.log('   (Clearnode will coordinate custody → channel transfer)');
  console.log('');

  // Check unified balance
  console.log('Step 5: Verifying unified balance...');
  await new Promise(r => setTimeout(r, 5000));

  const { YellowRpcClient } = await import('../src/yellow/rpc.js');
  const yellowClient = new YellowRpcClient({
    url: 'wss://clearnet.yellow.com/ws',
    privateKey: cfg.agentPrivateKey,
  });

  const balances = await yellowClient.getLedgerBalances();
  const unified = balances.find(b => b.asset === 'usdc');

  console.log('   Unified balance:', unified?.amount || '0', 'USDC');
  console.log('');

  if (Number(unified?.amount || 0) > 0) {
    console.log('✓ SUCCESS: Custody funds bridged to unified balance!');
    console.log('✓ Ready for app sessions on production clearnode!');
  } else {
    console.log('⚠️  Unified balance still empty');
    console.log('   Resize may need on-chain submission or clearnode processing');
  }

  ws.close();
  process.exit(0);
}

main().catch(console.error);
