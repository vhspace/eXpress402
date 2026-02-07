/**
 * Move funds from Custody Ledger to Unified Balance
 *
 * This is the missing link between onramp and app sessions!
 */
import { config } from 'dotenv';
config({ override: true });
import {
  NitroliteClient,
  WalletStateSigner,
  createECDSAMessageSigner,
  createCreateChannelMessage,
  createResizeChannelMessage,
  createGetChannelsMessage,
} from '@erc7824/nitrolite';
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import WebSocket from 'ws';
import { getYellowConfig } from '../src/yellow/config.js';

const CUSTODY_ADDRESS = '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6'; // Base
const ADJUDICATOR_ADDRESS = '0x7de4A0736Cf5740fD3Ca2F2e9cc85c9AC223eF0C'; // Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base USDC

async function main() {
  const cfg = getYellowConfig();
  const account = privateKeyToAccount(cfg.agentPrivateKey as `0x${string}`);

  console.log('=== Moving Custody Funds to Unified Balance ===\n');
  console.log('Agent:', account.address);
  console.log('Network: Base Production\n');

  // Setup clients
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
  console.log('Step 1: Checking custody ledger balance...');
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
  console.log('SUCCESS: Custody balance:', formatUnits(balance, 6), 'USDC\n');

  if (balance === 0n) {
    console.log('ERROR: No custody balance. Run agent-onramp first.');
    process.exit(1);
  }

  // Connect to production clearnode
  console.log('Step 2: Creating payment channel...');
  const ws = new WebSocket('wss://clearnet.yellow.com/ws');
  const sessionSigner = createECDSAMessageSigner(cfg.agentPrivateKey as `0x${string}`);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 10000);
  });

  // Authenticate
  await new Promise<void>(async (resolve, reject) => {
    const {
      createAuthRequestMessage,
      createAuthVerifyMessageFromChallenge,
      createEIP712AuthMessageSigner,
    } = await import('@erc7824/nitrolite');

    const sessionPrivateKey = generatePrivateKey();
    const sessionAccount = privateKeyToAccount(sessionPrivateKey);

    const authParams = {
      session_key: sessionAccount.address as `0x${string}`,
      allowances: [{ asset: 'usdc', amount: '1000000' }],
      expires_at: BigInt(Math.floor(Date.now() / 1000) + 3600),
      scope: 'custody-to-unified',
    };

    const authRequestMsg = await createAuthRequestMessage({
      address: account.address,
      application: 'custody-to-unified',
      ...authParams,
    });

    ws.on('message', async data => {
      const response = JSON.parse(data.toString());
      if (response.res && response.res[1] === 'auth_challenge') {
        const challenge = response.res[2].challenge_message;
        const signer = createEIP712AuthMessageSigner(walletClient, authParams, {
          name: 'custody-to-unified',
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

  // Create channel
  console.log('Step 3: Creating channel from custody...');
  const channelId = await new Promise<string>((resolve, reject) => {
    ws.on('message', async data => {
      const msg = JSON.parse(data.toString());
      const type = msg.res ? msg.res[1] : '';

      if (type === 'create_channel') {
        const { channel_id, channel, state, server_signature } = msg.res[2];
        console.log('   Yellow RPC prepared:', channel_id);
        console.log('   Submitting to blockchain...');

        const unsignedInitialState = {
          intent: state.intent,
          version: BigInt(state.version),
          data: state.state_data,
          allocations: state.allocations.map((a: any) => ({
            destination: a.destination,
            token: a.token,
            amount: BigInt(a.amount),
          })),
        };

        const createResult = await nitroliteClient.createChannel({
          channel,
          unsignedInitialState,
          serverSignature: server_signature,
        });

        console.log('   SUCCESS: Channel created!');
        console.log('   TX:', createResult.txHash);
        console.log('   Basescan: https://basescan.org/tx/' + createResult.txHash + '\n');
        resolve(channel_id);
      }

      if (type === 'error') {
        reject(new Error(JSON.stringify(msg.res[2])));
      }
    });

    createCreateChannelMessage(sessionSigner, {
      chain_id: 8453, // Base
      token: USDC_ADDRESS as `0x${string}`,
    }).then(m => ws.send(m));
  });

  console.log('Step 4: Checking unified balance...');
  console.log('   (Funds should auto-transfer from custody to unified)\n');

  // Check unified balance
  await new Promise(r => setTimeout(r, 5000));

  const { YellowRpcClient } = await import('../src/yellow/rpc.js');
  const yellowClient = new YellowRpcClient({
    url: 'wss://clearnet.yellow.com/ws',
    privateKey: cfg.agentPrivateKey,
  });

  const balances = await yellowClient.getLedgerBalances();
  const unifiedBalance = balances.find((b: any) => b.asset === 'usdc');

  console.log('SUCCESS: Unified balance:', unifiedBalance?.amount || '0', 'USDC');
  console.log('');
  console.log('Channel created:', channelId);
  console.log('Ready for app sessions!');

  ws.close();
  process.exit(0);
}

main().catch(error => {
  console.error('Failed:', error);
  process.exit(1);
});
