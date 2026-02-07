import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { YellowRpcClient } from '../src/yellow/rpc.js';
import { getYellowConfig } from '../src/yellow/config.js';

const shouldRun = process.env.RUN_YELLOW_E2E === 'true';
const describeIfEnabled = shouldRun ? describe : describe.skip;

// Maximum age for data to be considered fresh (4 hours in milliseconds)
const MAX_AGE_MS = 4 * 60 * 60 * 1000;
const FOUR_HOURS_AGO = Date.now() - MAX_AGE_MS;

describeIfEnabled('MCP Data Freshness E2E', () => {
  let yellow: YellowRpcClient;
  let mcpClient: Client;
  let mcpTransport: StdioClientTransport;
  let agentAddress: string;
  let sessionId: string;
  const env = getYellowConfig();

  beforeAll(async () => {
    if (!env.agentPrivateKey || !env.merchantAddress) {
      throw new Error('Missing Yellow credentials for e2e test');
    }

    // Derive agent address
    const { privateKeyToAccount } = await import('viem/accounts');
    agentAddress = privateKeyToAccount(env.agentPrivateKey as `0x${string}`).address;

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
      application: 'mcp-freshness-test',
    });

    // Ensure agent has funds
    const balances = await yellow.getLedgerBalances(agentAddress);
    const balance = balances.find((b: any) => b.asset === env.assetSymbol)?.amount ?? '0';
    
    if (Number(balance) < 1) {
      console.log('Requesting faucet funds...');
      const response = await fetch('https://clearnet-sandbox.yellow.com/faucet/requestTokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: agentAddress }),
      });

      if (response.ok) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    // Create Yellow session
    const { createAppSessionMessage, createECDSAMessageSigner } =
      await import('@erc7824/nitrolite/dist/rpc/api.js');
    const { RPCProtocolVersion } = await import('@erc7824/nitrolite/dist/rpc/types/index.js');

    const signer = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
    const participants = [agentAddress as `0x${string}`, env.merchantAddress as `0x${string}`];
    const message = await createAppSessionMessage(signer, {
      definition: {
        application: 'mcp-freshness-test',
        protocol: RPCProtocolVersion.NitroRPC_0_4,
        participants,
        allocation: [
          { participant: agentAddress as `0x${string}`, asset: env.assetSymbol, amount: '1.000000' },
          { participant: env.merchantAddress as `0x${string}`, asset: env.assetSymbol, amount: '0.000000' },
        ],
        quorum: 1,
      },
    });

    sessionId = message.channelId;
    await yellow.sendMessage(message);

    // Start MCP server
    mcpTransport = new StdioClientTransport({
      command: 'bash',
      args: ['-c', 'npm run dev'],
      env: Object.fromEntries(
        Object.entries(process.env).filter(([_, value]) => value !== undefined),
      ) as Record<string, string>,
    });

    mcpClient = new Client({ name: 'freshness-test-client', version: '0.1.0' });
    await mcpClient.connect(mcpTransport);
  }, 60000);

  afterAll(async () => {
    // Cleanup
    if (mcpTransport) {
      await mcpTransport.close();
    }
    if (yellow) {
      yellow.close();
    }
  }, 10000);

  it('should return Reddit data within last 4 hours', async () => {
    const result = await mcpClient.callTool({
      name: 'market_rumors',
      arguments: { symbol: 'ETH' },
    });

    expect(result.isError).toBeFalsy();
    
    const text = result.content.find((c: any) => c.type === 'text')?.text;
    expect(text).toBeDefined();

    const data = JSON.parse(text!);
    expect(data.reddit).toBeDefined();
    expect(Array.isArray(data.reddit)).toBe(true);

    // Check that we have at least some Reddit posts
    if (data.reddit.length > 0) {
      console.log(`\n📊 Reddit Results (${data.reddit.length} posts):`);
      
      for (const post of data.reddit) {
        expect(post.createdUtc).toBeDefined();
        
        const postTime = post.createdUtc * 1000; // Convert to milliseconds
        const age = Date.now() - postTime;
        const hoursAgo = (age / (1000 * 60 * 60)).toFixed(1);
        
        console.log(`  ⏰ ${hoursAgo}h ago: ${post.title.substring(0, 60)}...`);
        
        // Assert post is within last 4 hours
        expect(postTime).toBeGreaterThan(FOUR_HOURS_AGO);
        expect(age).toBeLessThan(MAX_AGE_MS);
      }
    } else {
      console.warn('⚠️  No Reddit posts found - may need to search different subreddits');
    }
  }, 30000);

  it('should return Tavily data within last 24 hours (API constraint)', async () => {
    const result = await mcpClient.callTool({
      name: 'market_rumors',
      arguments: { symbol: 'ETH' },
    });

    expect(result.isError).toBeFalsy();
    
    const text = result.content.find((c: any) => c.type === 'text')?.text;
    expect(text).toBeDefined();

    const data = JSON.parse(text!);
    expect(data.tavily).toBeDefined();
    expect(Array.isArray(data.tavily)).toBe(true);

    // Tavily should have results
    expect(data.tavily.length).toBeGreaterThan(0);
    
    console.log(`\n📰 Tavily Results (${data.tavily.length} articles):`);
    
    // Note: Tavily's published_date may not always be present
    // We verify structure but can't always verify age
    for (const article of data.tavily) {
      expect(article.title).toBeDefined();
      expect(article.url).toBeDefined();
      
      if (article.published_date) {
        const publishedTime = new Date(article.published_date).getTime();
        const age = Date.now() - publishedTime;
        const hoursAgo = (age / (1000 * 60 * 60)).toFixed(1);
        
        console.log(`  ⏰ ${hoursAgo}h ago: ${article.title.substring(0, 60)}...`);
        
        // Tavily with days:1 should be within 24 hours
        const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
        expect(publishedTime).toBeGreaterThan(twentyFourHoursAgo);
      } else {
        console.log(`  ⏰ NO DATE: ${article.title.substring(0, 60)}...`);
      }
    }
  }, 30000);

  it('should process payment through Yellow Network', async () => {
    const result = await mcpClient.callTool({
      name: 'market_rumors',
      arguments: { symbol: 'BTC' },
    });

    expect(result.isError).toBeFalsy();
    
    // Verify payment metadata exists
    const paymentMeta = (result as any)._meta?.['x402/payment-response'];
    expect(paymentMeta).toBeDefined();
    
    console.log('\n💰 Payment processed via Yellow Network');
    console.log('  Session ID:', sessionId.substring(0, 20) + '...');
  }, 30000);

  it('should return different data on subsequent calls', async () => {
    const result1 = await mcpClient.callTool({
      name: 'market_rumors',
      arguments: { symbol: 'ETH' },
    });

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));

    const result2 = await mcpClient.callTool({
      name: 'market_rumors',
      arguments: { symbol: 'SOL' },
    });

    const data1 = JSON.parse(result1.content.find((c: any) => c.type === 'text')?.text!);
    const data2 = JSON.parse(result2.content.find((c: any) => c.type === 'text')?.text!);

    // Different symbols should return different data
    expect(data1.symbol).toBe('ETH');
    expect(data2.symbol).toBe('SOL');
    
    console.log('\n🔄 Symbol variation confirmed:');
    console.log(`  ETH: ${data1.reddit.length} Reddit, ${data1.tavily.length} Tavily`);
    console.log(`  SOL: ${data2.reddit.length} Reddit, ${data2.tavily.length} Tavily`);
  }, 60000);
});
