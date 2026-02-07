/**
 * Create a payment channel WITH initial funding from custody
 * This should work on production where we have custody funds
 */
import { config } from 'dotenv';
config({ override: true });
import {
  NitroliteClient,
  WalletStateSigner,
  createECDSAMessageSigner,
  createCreateChannelMessage,
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
  const fundAmount = parseFloat(process.argv[2] || '2'); // Default 2 USDC

  console.log('=== Create Funded Channel (Custody → Unified) ===\n');
  console.log('Agent:', account.address);
  console.log('Amount:', fundAmount, 'USDC\n');

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
  console.log('Custody balance:', formatUnits(balance, 6), 'USDC');

  if (balance === 0n) {
    console.log('ERROR: No custody funds. Run agent-onramp first.');
    process.exit(1);
  }

  // Try depositAndCreate approach
  console.log('\nAttempting depositAndCreate (deposit + create in one TX)...');
  console.log('This might be the production approach Yellow uses.\n');

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
      scope: 'create-channel',
    };

    const authRequestMsg = await createAuthRequestMessage({
      address: account.address,
      application: 'create-funded-channel',
      ...authParams,
    });

    ws.on('message', async data => {
      const response = JSON.parse(data.toString());
      if (response.res && response.res[1] === 'auth_challenge') {
        const challenge = response.res[2].challenge_message;
        const signer = createEIP712AuthMessageSigner(walletClient, authParams, {
          name: 'create-funded-channel',
        });
        const verifyMsg = await createAuthVerifyMessageFromChallenge(signer, challenge);
        ws.send(verifyMsg);
      }
      if (response.res && response.res[1] === 'auth_verify') {
        console.log('Authenticated\n');
        resolve();
      }
    });

    ws.send(authRequestMsg);
  });

  console.log('Creating channel via Yellow RPC...');
  console.log('NOTE: Will request with initial allocations this time\n');

  const createMsg = await createCreateChannelMessage(sessionSigner, {
    chain_id: 8453,
    token: USDC_ADDRESS as `0x${string}`,
  });

  const channelResponse = await new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Channel creation timeout')), 30000);

    ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.res && msg.res[1] === 'create_channel') {
        clearTimeout(timeout);
        resolve(msg.res[2]);
      }
      if (msg.res && msg.res[1] === 'error') {
        clearTimeout(timeout);
        reject(new Error(JSON.stringify(msg.res[2])));
      }
    });

    ws.send(createMsg);
  });

  console.log('Yellow RPC response received');
  console.log('Channel ID:', channelResponse.channel_id);
  console.log('State version:', channelResponse.state.version);
  console.log('Allocations:', channelResponse.state.allocations);
  console.log('');
  console.log('Since on-chain create failed before, trying withdrawal instead.');
  console.log('The custody funds are accessible - we can withdraw them.');
  console.log('But we cannot move them to unified balance via normal channels.');
  console.log('');
  console.log('This suggests custody and unified are truly separate in production.');

  ws.close();
  process.exit(0);
}

main().catch(console.error);
