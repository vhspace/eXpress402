import { YellowRpcClient } from '../src/yellow/rpc.js';
import { describe, it, expect, beforeAll } from 'vitest';

const shouldRun = process.env.RUN_YELLOW_E2E === 'true';
const describeIfEnabled = shouldRun ? describe : describe.skip;

// Test constants
const AGENT_PRIVATE_KEY = '0x323007595978d45a651e61ba6248b65c1bba7e1bc69867cfd42a05202db6cd56';
const MERCHANT_ADDRESS = '0x9126d073e0a5e45D907feA0b4f4857F5b7191430';
const CONFIG = {
  clearnodeUrl: 'wss://clearnet-sandbox.yellow.com/ws',
  assetSymbol: 'ytest.usd',
  sessionAllocation: '0.3',
  spendAmount: '0.1',
};

describeIfEnabled('Yellow Network Session Payment E2E', () => {
  let yellow: YellowRpcClient;
  let agentAddress: string;
  let sessionId: any;
  let notifications: Array<{ type: string; data: any; timestamp: number }> = [];
  let initialAgentBalance: string;
  let finalAgentBalance: string;

  beforeAll(async () => {
    // Initialize Yellow client
    yellow = new YellowRpcClient({
      url: CONFIG.clearnodeUrl,
      privateKey: AGENT_PRIVATE_KEY,
      authDomain: 'clearnet-sandbox.yellow.com',
      debug: false,
    });

    // Set up notification listeners
    yellow.on('balanceUpdate', (data: any) => {
      notifications.push({ type: 'balanceUpdate', data, timestamp: Date.now() });
    });

    yellow.on('transfer', (data: any) => {
      notifications.push({ type: 'transfer', data, timestamp: Date.now() });
    });

    // Derive agent address
    const { privateKeyToAccount } = await import('viem/accounts');
    agentAddress = privateKeyToAccount(AGENT_PRIVATE_KEY as `0x${string}`).address;

    // Connect and authenticate
    await yellow.connect();
    await yellow.authenticate({
      allowances: [{ asset: CONFIG.assetSymbol, amount: '1000' }],
      scope: 'transfer',
      application: 'session-payment-test',
    });

    // Check initial balance and refill if needed
    const balances = await yellow.getLedgerBalances(agentAddress);
    initialAgentBalance = balances.find((b: any) => b.asset === CONFIG.assetSymbol)?.amount ?? '0';

    const minBalance = Number(CONFIG.sessionAllocation) + 0.5;
    if (Number(initialAgentBalance) < minBalance) {
      const response = await fetch('https://clearnet-sandbox.yellow.com/faucet/requestTokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: agentAddress }),
      });

      if (response.ok) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for faucet
        const newBalances = await yellow.getLedgerBalances(agentAddress);
        initialAgentBalance =
          newBalances.find((b: any) => b.asset === CONFIG.assetSymbol)?.amount ?? '0';
      }
    }
  }, 30000);

  it('1. Agent can fund the offchain wallet (session)', async () => {
    // Create session
    const participants = [agentAddress as `0x${string}`, MERCHANT_ADDRESS as `0x${string}`];
    const allocationsRaw = {
      [agentAddress]: CONFIG.sessionAllocation,
      [MERCHANT_ADDRESS]: '0',
    };

    const allocations = participants.map(participant => ({
      participant,
      asset: CONFIG.assetSymbol,
      amount: allocationsRaw[participant] ?? '0',
    }));

    const { createAppSessionMessage, createECDSAMessageSigner } =
      await import('@erc7824/nitrolite/dist/rpc/api.js');
    const { RPCProtocolVersion } = await import('@erc7824/nitrolite/dist/rpc/types/index.js');

    const signer = createECDSAMessageSigner(AGENT_PRIVATE_KEY as `0x${string}`);
    const weights = participants.map(() => 1);
    const message = await createAppSessionMessage(signer, {
      definition: {
        application: 'session-payment-test',
        protocol: RPCProtocolVersion.NitroRPC_0_4,
        participants,
        weights,
        quorum: 1,
        challenge: 0,
        nonce: Date.now(),
      },
      allocations,
      session_data: JSON.stringify({ ttlSeconds: 3600 }),
    });

    const response = (await yellow.sendRawMessage(message)) as any;
    sessionId = (response.appSessionId ??
      response.app_session_id ??
      response.appSession?.appSessionId) as string;

    expect(sessionId).toBeDefined();

    // Verify session was funded
    const sessionBalances = await yellow.getLedgerBalances(sessionId);
    const sessionAmount =
      sessionBalances.find((b: any) => b.asset === CONFIG.assetSymbol)?.amount ?? '0';
    expect(sessionAmount).toBe(CONFIG.sessionAllocation);
  }, 15000);

  it('2. 0.1 was removed from the offchain wallet through session close', async () => {
    // Clear previous notifications
    notifications = [];

    // Close session with payment distribution: merchant gets 0.1, agent gets 0.2
    await yellow.closeAppSession({
      appSessionId: sessionId,
      allocations: [
        {
          participant: agentAddress as `0x${string}`,
          asset: CONFIG.assetSymbol,
          amount: (Number(CONFIG.sessionAllocation) - Number(CONFIG.spendAmount)).toFixed(1),
        },
        {
          participant: MERCHANT_ADDRESS as `0x${string}`,
          asset: CONFIG.assetSymbol,
          amount: CONFIG.spendAmount,
        },
      ],
    });

    // Check that session is now empty (funds distributed)
    const sessionBalancesAfter = await yellow.getLedgerBalances(sessionId);
    const sessionAmountAfter =
      sessionBalancesAfter.find((b: any) => b.asset === CONFIG.assetSymbol)?.amount ?? '0';
    expect(sessionAmountAfter).toBe('0');

    // Verify balance update notifications were received
    const balanceNotifications = notifications.filter(n => n.type === 'balanceUpdate');
    expect(balanceNotifications.length).toBeGreaterThan(0);
  }, 10000);

  it('3. Final balances show payment distribution worked', async () => {
    // Get final balances after session close
    const finalAgentBalances = await yellow.getLedgerBalances(agentAddress);
    const finalMerchantBalances = await yellow.getLedgerBalances(MERCHANT_ADDRESS);

    finalAgentBalance =
      finalAgentBalances.find((b: any) => b.asset === CONFIG.assetSymbol)?.amount ?? '0';
    const finalMerchantBalance =
      finalMerchantBalances.find((b: any) => b.asset === CONFIG.assetSymbol)?.amount ?? '0';

    // Agent should have initial balance minus the payment allocated to merchant
    const expectedAgentBalance = (Number(initialAgentBalance) - Number(CONFIG.spendAmount)).toFixed(
      1,
    );
    expect(finalAgentBalance).toBe(expectedAgentBalance);

    // Session close allocated 0.1 to merchant and 0.2 to agent
    console.log(
      `Payment distribution: Merchant allocated ${CONFIG.spendAmount}, Agent gets ${(Number(CONFIG.sessionAllocation) - Number(CONFIG.spendAmount)).toFixed(1)}`,
    );
    console.log(`Final agent balance: ${finalAgentBalance} (net: -${CONFIG.spendAmount})`);
    console.log(`Final merchant balance: ${finalMerchantBalance}`);

    // The key verification: agent balance changed by exactly the payment amount
    const balanceChange = (Number(initialAgentBalance) - Number(finalAgentBalance)).toFixed(1);
    expect(balanceChange).toBe(CONFIG.spendAmount);
  }, 10000);
});
