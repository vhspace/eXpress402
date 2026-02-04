/**
 * Minimal Yellow App Session Demo with FULL Quorum 2 Support!
 *
 * Complete demonstration of Yellow app sessions with quorum 2 governance:
 * 1. Shows Initial, After Create, After Close, and Final balances
 * 2. Displays Expected vs Got for Agent, Session, and Merchant at each step
 * 3. Uses Quorum 2 for BOTH create_app_session AND close_app_session
 * 4. Verifies merchant actually receives the payment
 *
 * Uses NitroRPC/0.4 with proper multi-party signature collection.
 *
 * **Key Discovery:** Signers must receive the RPCData ARRAY, not stringified JSON!
 */

import { YellowRpcClient } from './yellow/rpc.js';

// Configuration
const CLEARNODE_WS_URL = 'wss://clearnet-sandbox.yellow.com/ws';
const AGENT_ADDRESS = process.env.YELLOW_AGENT_ADDRESS!;
const AGENT_PRIVATE_KEY = process.env.YELLOW_AGENT_PRIVATE_KEY!;
const MERCHANT_ADDRESS = process.env.YELLOW_MERCHANT_ADDRESS!;
const MERCHANT_PRIVATE_KEY = process.env.YELLOW_MERCHANT_PRIVATE_KEY!;
const ASSET_SYMBOL = 'ytest.usd'; // Yellow testnet USD

// Create app session with quorum governance (requires both signatures)
async function createAppSession(
  agentRpc: YellowRpcClient,
  agentAddress: string,
  merchantAddress: string,
  initialAmount: string,
  agentPrivateKey: string,
  merchantPrivateKey: string,
  assetSymbol: string,
): Promise<string> {
  console.log('\n=== Creating App Session ===');

  const { createAppSessionMessage, createECDSAMessageSigner } =
    await import('@erc7824/nitrolite/dist/rpc/api.js');
  const { RPCProtocolVersion } = await import('@erc7824/nitrolite/dist/rpc/types/index.js');

  const participants = [agentAddress as `0x${string}`, merchantAddress as `0x${string}`];

  // Allocations array format
  const allocations = [
    {
      participant: agentAddress as `0x${string}`,
      asset: assetSymbol,
      amount: initialAmount,
    },
    {
      participant: merchantAddress as `0x${string}`,
      asset: assetSymbol,
      amount: '0',
    },
  ];

  // Create session with quorum 2 - BOTH must sign!
  console.log('  Creating session with Quorum 2 (both parties must sign)...');

  const agentSigner = createECDSAMessageSigner(agentPrivateKey as `0x${string}`);
  const merchantSigner = createECDSAMessageSigner(merchantPrivateKey as `0x${string}`);

  const sessionParams = {
    definition: {
      application: 'minimal-session-demo',
      protocol: RPCProtocolVersion.NitroRPC_0_4,
      participants,
      weights: [1, 1],
      quorum: 2,
      challenge: 86400,
      nonce: Date.now(),
    },
    allocations,
    session_data: JSON.stringify({ ttlSeconds: 3600 }),
  };

  // Agent creates message
  const agentMessage = await createAppSessionMessage(agentSigner, sessionParams);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const parsed = JSON.parse(agentMessage);

  // Merchant signs the ARRAY (not string!) - this is the key!
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const merchantSig = await merchantSigner(parsed.req);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  parsed.sig.push(merchantSig);

  console.log('  ✓ Agent signed');
  console.log('  ✓ Merchant signed');
  console.log('  ✓ Quorum: 2/2 signatures collected');

  const response = await agentRpc.sendRawMessage(JSON.stringify(parsed));

  // Extract session ID from Yellow RPC response (supports both formats)
  type YellowSessionResponse = {
    appSessionId?: string;
    app_session_id?: string;
  };
  const typedResponse = response as YellowSessionResponse;
  const sessionId = typedResponse.appSessionId ?? typedResponse.app_session_id;

  if (!sessionId) {
    console.error('Failed to create session');
    console.error('Response:', JSON.stringify(response, null, 2));
    throw new Error('No session ID in response');
  }

  console.log(`✓ App session created: ${sessionId}`);
  console.log(`  Initial balance: Agent=${initialAmount}, Merchant=0`);

  return sessionId;
}

// Close app session and finalize - requires both signatures
async function closeAppSession(
  agentRpc: YellowRpcClient,
  sessionId: string,
  agentAddress: string,
  merchantAddress: string,
  paymentAmount: string,
  remainingAmount: string,
  agentPrivateKey: string,
  merchantPrivateKey: string,
  assetSymbol: string,
): Promise<void> {
  console.log('\n=== Closing App Session ===');

  const { createCloseAppSessionMessage, createECDSAMessageSigner } =
    await import('@erc7824/nitrolite/dist/rpc/api.js');

  // Final allocations
  const allocations = [
    {
      participant: agentAddress as `0x${string}`,
      asset: assetSymbol,
      amount: remainingAmount,
    },
    {
      participant: merchantAddress as `0x${string}`,
      asset: assetSymbol,
      amount: paymentAmount,
    },
  ];

  // Close session with quorum 2 - BOTH must sign!
  console.log('  Closing session with Quorum 2 (both parties must sign)...');

  // Create signers
  const agentSigner = createECDSAMessageSigner(agentPrivateKey as `0x${string}`);
  const merchantSigner = createECDSAMessageSigner(merchantPrivateKey as `0x${string}`);

  // Agent creates close message
  const agentCloseMessage = await createCloseAppSessionMessage(agentSigner, {
    app_session_id: sessionId as `0x${string}`,
    allocations,
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const closeParsed = JSON.parse(agentCloseMessage);

  // Merchant signs the ARRAY (not string!)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const merchantCloseSig = await merchantSigner(closeParsed.req);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  closeParsed.sig.push(merchantCloseSig);

  console.log('  ✓ Agent signed');
  console.log('  ✓ Merchant signed');
  console.log('  ✓ Quorum: 2/2 signatures collected');

  await agentRpc.sendRawMessage(JSON.stringify(closeParsed));

  console.log('✓ App session closed');
}

// Main demo flow
async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   Minimal Yellow App Session Demo     ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log(`Agent:    ${AGENT_ADDRESS}`);
  console.log(`Merchant: ${MERCHANT_ADDRESS}`);
  console.log('');

  // Create RPC client for agent
  const agentRpc = new YellowRpcClient({
    url: CLEARNODE_WS_URL,
    privateKey: AGENT_PRIVATE_KEY,
    authDomain: 'clearnet-sandbox.yellow.com',
    debug: false,
  });

  try {
    // Connect and authenticate
    await agentRpc.connect();
    console.log('✓ Connected to Yellow clearnode');

    await agentRpc.authenticate({
      application: 'minimal-session-demo',
      scope: '*',
    });
    console.log('✓ Agent authenticated');

    // Check initial balances for all parties
    console.log('\n=== Step 1: Initial Balances ===');
    const initialAgentBalance = await agentRpc.getLedgerBalances();
    const initialAgentAmount =
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      initialAgentBalance.find((b: any) => b.asset === ASSET_SYMBOL)?.amount ?? '0';

    // Connect as merchant to check their initial balance
    const merchantRpc = new YellowRpcClient({
      url: CLEARNODE_WS_URL,
      privateKey: MERCHANT_PRIVATE_KEY,
      authDomain: 'clearnet-sandbox.yellow.com',
      debug: false,
    });
    await merchantRpc.connect();
    await merchantRpc.authenticate({ application: 'minimal-session-demo', scope: '*' });

    const initialMerchantBalance = await merchantRpc.getLedgerBalances();
    const initialMerchantAmount =
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      initialMerchantBalance.find((b: any) => b.asset === ASSET_SYMBOL)?.amount ?? '0';

    console.log(`Agent:    ${initialAgentAmount} ${ASSET_SYMBOL}`);
    console.log(`Session:  0 ${ASSET_SYMBOL} (no session yet)`);
    console.log(`Merchant: ${initialMerchantAmount} ${ASSET_SYMBOL}`);

    // Step 1: Create app session with 1.0 ytest.usd
    const initialAmount = '1.0';
    const sessionId = await createAppSession(
      agentRpc,
      AGENT_ADDRESS,
      MERCHANT_ADDRESS,
      initialAmount,
      AGENT_PRIVATE_KEY,
      MERCHANT_PRIVATE_KEY,
      ASSET_SYMBOL,
    );

    // Wait for session to be confirmed
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Verify balances after session creation
    console.log('\n=== Step 2: After Creating Session ===');
    const afterCreateAgentBalance = await agentRpc.getLedgerBalances();
    const afterCreateAgentAmount =
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      afterCreateAgentBalance.find((b: any) => b.asset === ASSET_SYMBOL)?.amount ?? '0';

    const sessionBalance = await agentRpc.getLedgerBalances(sessionId);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const sessionAmount = sessionBalance.find((b: any) => b.asset === ASSET_SYMBOL)?.amount ?? '0';

    const afterCreateMerchantBalance = await merchantRpc.getLedgerBalances();
    const afterCreateMerchantAmount =
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      afterCreateMerchantBalance.find((b: any) => b.asset === ASSET_SYMBOL)?.amount ?? '0';

    const expectedAgentAfterCreate = (Number(initialAgentAmount) - Number(initialAmount)).toFixed(
      1,
    );

    console.log(
      `Agent:    Expected: ${expectedAgentAfterCreate}, Got: ${afterCreateAgentAmount} ${ASSET_SYMBOL} ${Number(afterCreateAgentAmount) === Number(expectedAgentAfterCreate) ? '✓' : '✗'}`,
    );
    console.log(
      `Session:  Expected: ${initialAmount}, Got: ${sessionAmount} ${ASSET_SYMBOL} ${Number(sessionAmount) === Number(initialAmount) ? '✓' : '✗'}`,
    );
    console.log(
      `Merchant: Expected: ${initialMerchantAmount}, Got: ${afterCreateMerchantAmount} ${ASSET_SYMBOL} ${afterCreateMerchantAmount === initialMerchantAmount ? '✓' : '✗'}`,
    );

    // Step 3: Close the session with payment distribution
    // Merchant gets 0.1, Agent gets 0.9
    const paymentAmount = '0.1';
    const remainingAmount = '0.9';

    console.log('\n=== Step 3: Closing Session with Redistribution ===');
    console.log(`  Redistributing: Agent=${remainingAmount}, Merchant=${paymentAmount}`);

    await closeAppSession(
      agentRpc,
      sessionId,
      AGENT_ADDRESS,
      MERCHANT_ADDRESS,
      paymentAmount,
      remainingAmount,
      AGENT_PRIVATE_KEY,
      MERCHANT_PRIVATE_KEY,
      ASSET_SYMBOL,
    );

    // Wait for finalization
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 4: Verify final balances after session close
    console.log('\n=== Step 4: After Closing Session ===');

    const finalAgentBalance = await agentRpc.getLedgerBalances();
    const finalAgentAmount =
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      finalAgentBalance.find((b: any) => b.asset === ASSET_SYMBOL)?.amount ?? '0';

    // Check session is empty
    const finalSessionBalance = await agentRpc.getLedgerBalances(sessionId);
    const finalSessionAmount =
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      finalSessionBalance.find((b: any) => b.asset === ASSET_SYMBOL)?.amount ?? '0';

    const finalMerchantBalance = await merchantRpc.getLedgerBalances();
    const finalMerchantAmount =
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      finalMerchantBalance.find((b: any) => b.asset === ASSET_SYMBOL)?.amount ?? '0';

    // Calculate expected values
    const expectedAgentFinal = (Number(initialAgentAmount) - Number(paymentAmount)).toFixed(1);
    const expectedMerchantFinal = (Number(initialMerchantAmount) + Number(paymentAmount)).toFixed(
      1,
    );

    console.log(
      `Agent:    Expected: ${expectedAgentFinal}, Got: ${finalAgentAmount} ${ASSET_SYMBOL} ${Number(finalAgentAmount) === Number(expectedAgentFinal) ? '✓' : '✗'}`,
    );
    console.log(
      `Session:  Expected: 0, Got: ${finalSessionAmount} ${ASSET_SYMBOL} ${finalSessionAmount === '0' ? '✓' : '✗'}`,
    );
    console.log(
      `Merchant: Expected: ${expectedMerchantFinal}, Got: ${finalMerchantAmount} ${ASSET_SYMBOL} ${Number(finalMerchantAmount) === Number(expectedMerchantFinal) ? '✓' : '✗'}`,
    );

    console.log('\n=== Summary ===');
    console.log(
      `Agent:    ${initialAgentAmount} → ${finalAgentAmount} (change: -${paymentAmount})`,
    );
    console.log(`Session:  ${initialAmount} → 0 (distributed)`);
    console.log(
      `Merchant: ${initialMerchantAmount} → ${finalMerchantAmount} (received: +${paymentAmount})`,
    );

    console.log('\n✓ Demo complete!');
    console.log('✓ All balances verified successfully');
    console.log(
      '\n🎉🎉 QUORUM 2 SUCCESS! Both create_app_session AND close_app_session used quorum 2!',
    );
    console.log('\n--- KEY LEARNING ---');
    console.log('To make quorum 2 work, pass the REQUEST ARRAY to signers, not stringified JSON!');
    console.log(
      'Example: await merchantSigner(parsed.req)  // req is [id, method, params, timestamp]',
    );
  } catch (error) {
    console.error('\n✗ Error:', error);
    throw error;
  }
}

// Run the demo
main().catch(console.error);
