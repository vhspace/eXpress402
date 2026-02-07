import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { YellowRpcClient } from '../src/yellow/rpc.js';
import { getYellowConfig } from '../src/yellow/config.js';

const shouldRun = process.env.RUN_YELLOW_E2E === 'true';
const describeIfEnabled = shouldRun ? describe : describe.skip;

describeIfEnabled('Merchant Funding E2E (Quorum 2)', () => {
  let yellow: YellowRpcClient;
  let mcpClient: Client;
  let mcpTransport: StdioClientTransport;
  let agentAddress: string;
  let merchantAddress: string;
  let sessionId: string;
  let initialMerchantBalance: number;
  let initialAgentBalance: number;
  const env = getYellowConfig();

  beforeAll(async () => {
    if (!env.agentPrivateKey || !env.merchantAddress || !env.merchantPrivateKey) {
      throw new Error('Missing Yellow credentials for e2e test');
    }

    merchantAddress = env.merchantAddress;

    // Derive agent address
    const { privateKeyToAccount } = await import('viem/accounts');
    agentAddress = privateKeyToAccount(env.agentPrivateKey as `0x${string}`).address;

    console.log('\n🔧 Test Setup:');
    console.log('  Agent:', agentAddress);
    console.log('  Merchant:', merchantAddress);

    // Initialize Yellow client
    yellow = new YellowRpcClient({
      url: env.clearnodeUrl,
      privateKey: env.agentPrivateKey,
      authDomain: 'clearnet-sandbox.yellow.com',
      debug: false,
    });

    await yellow.connect();
    await yellow.authenticate({
      allowances: [{ asset: env.assetSymbol, amount: '1000' }],
      scope: 'transfer',
      application: 'merchant-funding-test',
    });

    // Get initial balances BEFORE session
    const agentBalances = await yellow.getLedgerBalances(agentAddress);
    const agentAsset = agentBalances.find((b: any) => b.asset === env.assetSymbol);
    initialAgentBalance = agentAsset ? parseFloat(agentAsset.amount) : 0;

    const merchantBalances = await yellow.getLedgerBalances(merchantAddress);
    const merchantAsset = merchantBalances.find((b: any) => b.asset === env.assetSymbol);
    initialMerchantBalance = merchantAsset ? parseFloat(merchantAsset.amount) : 0;

    console.log('\n💰 Initial Off-Chain Balances:');
    console.log(`  Agent: ${initialAgentBalance.toFixed(2)} ${env.assetSymbol}`);
    console.log(`  Merchant: ${initialMerchantBalance.toFixed(2)} ${env.assetSymbol}`);

    // Ensure agent has funds
    if (initialAgentBalance < 1) {
      console.log('\n🚰 Requesting faucet funds...');
      const response = await fetch('https://clearnet-sandbox.yellow.com/faucet/requestTokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: agentAddress }),
      });

      if (response.ok) {
        console.log('  Waiting for faucet...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Refresh balance
        const newBalances = await yellow.getLedgerBalances(agentAddress);
        const newAsset = newBalances.find((b: any) => b.asset === env.assetSymbol);
        initialAgentBalance = newAsset ? parseFloat(newAsset.amount) : 0;
        console.log(`  New agent balance: ${initialAgentBalance.toFixed(2)} ${env.assetSymbol}`);
      }
    }

    // Create Yellow session with QUORUM 2
    const { createAppSessionMessage, createECDSAMessageSigner } =
      await import('@erc7824/nitrolite/dist/rpc/api.js');
    const { RPCProtocolVersion } = await import('@erc7824/nitrolite/dist/rpc/types/index.js');

    const agentSigner = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
    const merchantSigner = createECDSAMessageSigner(env.merchantPrivateKey as `0x${string}`);
    
    const participants = [agentAddress as `0x${string}`, merchantAddress as `0x${string}`];
    const allocations = [
      { participant: agentAddress as `0x${string}`, asset: env.assetSymbol, amount: '5.0' },
      { participant: merchantAddress as `0x${string}`, asset: env.assetSymbol, amount: '0.0' },
    ];
    
    console.log('\n📝 Creating session with Quorum 2...');
    console.log('  Initial allocation: 5.0 to agent, 0.0 to merchant');
    
    const sessionParams = {
      definition: {
        application: 'merchant-funding-test',
        protocol: RPCProtocolVersion.NitroRPC_0_4,
        participants,
        weights: [1, 1],
        quorum: 2, // BOTH must sign
        challenge: 0,
        nonce: Date.now(),
      },
      allocations,
      session_data: JSON.stringify({ ttlSeconds: 3600 }),
    };

    // Agent signs
    const agentSessionMessage = await createAppSessionMessage(agentSigner, sessionParams);
    const sessionParsed = JSON.parse(agentSessionMessage);
    
    // Merchant signs
    const merchantSessionSig = await merchantSigner(sessionParsed.req);
    sessionParsed.sig.push(merchantSessionSig);

    // Send signed message
    const response = (await yellow.sendRawMessage(JSON.stringify(sessionParsed))) as any;
    sessionId = (response.appSessionId ??
      response.app_session_id ??
      response.appSession?.appSessionId) as string;
    
    expect(sessionId).toBeDefined();
    console.log(`  ✓ Session created: ${sessionId.substring(0, 20)}...`);
    console.log('  ✓ Both agent and merchant signed (Quorum 2)');

    // Start MCP server
    mcpTransport = new StdioClientTransport({
      command: 'bash',
      args: ['-c', 'npm run dev'],
      env: Object.fromEntries(
        Object.entries(process.env).filter(([_, value]) => value !== undefined),
      ) as Record<string, string>,
    });

    mcpClient = new Client({ name: 'merchant-funding-test-client', version: '0.1.0' });
    await mcpClient.connect(mcpTransport);
    console.log('  ✓ MCP server started');
  }, 90000);

  afterAll(async () => {
    // Cleanup
    if (mcpTransport) {
      await mcpTransport.close();
    }
  }, 10000);

  it('should fund merchant wallet after session close', async () => {
    console.log('\n💸 Making MCP calls to spend from session...');
    
    // Make 3 MCP calls (should cost ~3.45 ytest.usd in sandbox at 1.15 per call)
    const symbols = ['ETH', 'BTC', 'SOL'];
    for (const symbol of symbols) {
      const result = await mcpClient.callTool({
        name: 'market_rumors',
        arguments: { symbol },
        _meta: { 'x402/yellow': { appSessionId: sessionId, payer: agentAddress } },
      });

      expect(result.isError).toBeFalsy();
      console.log(`  ✓ Called market_rumors(${symbol})`);
    }

    const expectedSpent = 1.15 * 3; // 3.45 ytest.usd
    console.log(`\n  Expected spent: ~${expectedSpent.toFixed(2)} ${env.assetSymbol}`);

    // Close session with QUORUM 2
    console.log('\n🔒 Closing session with Quorum 2...');
    const { createCloseAppSessionMessage, createECDSAMessageSigner } =
      await import('@erc7824/nitrolite/dist/rpc/api.js');

    const agentCloseSigner = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
    const merchantCloseSigner = createECDSAMessageSigner(env.merchantPrivateKey as `0x${string}`);

    // Calculate final allocations
    const sessionInitial = 5.0;
    const sessionRemaining = sessionInitial - expectedSpent;
    const finalAllocations = [
      { participant: agentAddress as `0x${string}`, asset: env.assetSymbol, amount: sessionRemaining.toFixed(6) },
      { participant: merchantAddress as `0x${string}`, asset: env.assetSymbol, amount: expectedSpent.toFixed(6) },
    ];

    console.log('  Final allocations:');
    console.log(`    Agent refund: ${sessionRemaining.toFixed(2)} ${env.assetSymbol}`);
    console.log(`    Merchant payment: ${expectedSpent.toFixed(2)} ${env.assetSymbol}`);

    // Agent signs close
    const agentCloseMessage = await createCloseAppSessionMessage(agentCloseSigner, {
      app_session_id: sessionId as `0x${string}`,
      allocations: finalAllocations,
    });

    const closeParsed = JSON.parse(agentCloseMessage);
    
    // Merchant signs close
    const merchantCloseSig = await merchantCloseSigner(closeParsed.req);
    closeParsed.sig.push(merchantCloseSig);

    // Send close message
    await yellow.sendRawMessage(JSON.stringify(closeParsed));
    console.log('  ✓ Session closed with Quorum 2');

    // Wait for settlement to complete
    console.log('\n⏳ Waiting for settlement (3 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check final balances
    console.log('\n💰 Checking final off-chain balances...');
    
    const finalAgentBalances = await yellow.getLedgerBalances(agentAddress);
    const finalAgentAsset = finalAgentBalances.find((b: any) => b.asset === env.assetSymbol);
    const finalAgentBalance = finalAgentAsset ? parseFloat(finalAgentAsset.amount) : 0;

    const finalMerchantBalances = await yellow.getLedgerBalances(merchantAddress);
    const finalMerchantAsset = finalMerchantBalances.find((b: any) => b.asset === env.assetSymbol);
    const finalMerchantBalance = finalMerchantAsset ? parseFloat(finalMerchantAsset.amount) : 0;

    console.log(`  Agent: ${initialAgentBalance.toFixed(2)} → ${finalAgentBalance.toFixed(2)} ${env.assetSymbol}`);
    console.log(`  Merchant: ${initialMerchantBalance.toFixed(2)} → ${finalMerchantBalance.toFixed(2)} ${env.assetSymbol}`);

    // Calculate changes
    const agentChange = finalAgentBalance - initialAgentBalance;
    const merchantChange = finalMerchantBalance - initialMerchantBalance;

    console.log('\n📊 Balance Changes:');
    console.log(`  Agent: ${agentChange >= 0 ? '+' : ''}${agentChange.toFixed(2)} ${env.assetSymbol}`);
    console.log(`  Merchant: ${merchantChange >= 0 ? '+' : ''}${merchantChange.toFixed(2)} ${env.assetSymbol}`);

    // Assertions
    // Agent should have DECREASED by sessionInitial (5.0) and INCREASED by sessionRemaining
    // Net: -expectedSpent
    const expectedAgentChange = -expectedSpent;
    expect(agentChange).toBeCloseTo(expectedAgentChange, 1);
    console.log(`  ✓ Agent change matches expected: ${expectedAgentChange.toFixed(2)}`);

    // Merchant should have INCREASED by expectedSpent
    expect(merchantChange).toBeCloseTo(expectedSpent, 1);
    console.log(`  ✓ Merchant received payment: ${expectedSpent.toFixed(2)}`);

    // Merchant balance must have increased
    expect(finalMerchantBalance).toBeGreaterThan(initialMerchantBalance);
    console.log('  ✓ Merchant balance increased');

    console.log('\n✅ Merchant funding verified!');
  }, 90000);
});
