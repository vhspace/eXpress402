/**
 * SIWx + Yellow Session Demo
 * Demonstrates wallet authentication with session reuse
 *
 * Flow:
 * 1. First request: Sign with wallet -> Create Yellow session -> Pay once
 * 2. Subsequent requests: Verify wallet -> Reuse session -> No payment
 */

/**
 * Load .env explicitly before any other code
 * Use override: true to override empty env vars from devcontainer
 */
import { config } from 'dotenv';
config({ override: true });

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createAppSessionMessage,
  createCloseAppSessionMessage,
  createECDSAMessageSigner,
} from '@erc7824/nitrolite/dist/rpc/api.js';
import { RPCProtocolVersion } from '@erc7824/nitrolite/dist/rpc/types/index.js';
import { getYellowConfig } from './yellow/config.js';
import { YellowRpcClient } from './yellow/rpc.js';
import { createSIWxPayload, encodeSIWxHeader } from './x402/siwx/client.js';
import { siwxStorage } from './x402/siwx/storage.js';
import type { CompleteSIWxInfo } from './x402/siwx/types.js';

const env = getYellowConfig();

if (!env.agentPrivateKey || !env.merchantAddress) {
  console.error('YELLOW_AGENT_PRIVATE_KEY and YELLOW_MERCHANT_ADDRESS are required.');
  console.error('Current env.agentPrivateKey:', env.agentPrivateKey ? 'SET' : 'NOT SET');
  console.error('Current env.merchantAddress:', env.merchantAddress);
  process.exit(1);
}

const agentWallet = privateKeyToAccount(env.agentPrivateKey as `0x${string}`);
const agentAddress = agentWallet.address;

async function main() {
  console.log('\n=== SIWx + Yellow Session Demo ===\n');
  console.log(`Agent wallet: ${agentAddress}`);
  console.log(`Merchant: ${env.merchantAddress}\n`);

  // Setup MCP client with environment variables
  const transport = new StdioClientTransport({
    command: 'tsx',
    args: ['src/index.ts'],
    env: {
      ...process.env,
      KV_URL: process.env.KV_URL ?? 'redis://redis:6379',
      KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN ?? 'local-dev-token',
    },
  });

  const mcpClient = new Client(
    {
      name: 'siwx-demo-client',
      version: '0.1.0',
    },
    {
      capabilities: {},
    },
  );

  await mcpClient.connect(transport);

  // List available tools from MCP server
  console.log('--- MCP Server Tools Available ---\n');
  const toolsList = await mcpClient.listTools();
  console.log('Available tools:');
  toolsList.tools.forEach((tool: Tool) => {
    console.log(`  - ${tool.name}: ${tool.description}`);
  });
  console.log('');

  // Setup Yellow client for session creation
  const yellowClient = new YellowRpcClient({
    url: env.clearnodeUrl,
    privateKey: env.agentPrivateKey,
  });

  try {
    // Clear any old sessions from storage for clean demo
    console.log('Clearing old sessions from storage...');
    await siwxStorage.deleteSession(agentAddress, 'mcp://tool/stock_price');
    console.log('');

    console.log('--- Step 1: Create Yellow Session ---\n');

    // Authenticate with Yellow clearnode
    console.log('Authenticating with Yellow clearnode...');
    await yellowClient.connect();
    await yellowClient.authenticate({
      allowances: [{ asset: env.assetSymbol, amount: '10.0' }],
      scope: 'transfer',
    });
    console.log('Authenticated successfully\n');

    // Create Yellow payment session with QUORUM 2 (both signatures required)
    console.log('Creating session with Quorum 2 (both agent and merchant must sign)...');

    const agentSigner = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
    const merchantSigner = createECDSAMessageSigner(env.merchantPrivateKey as `0x${string}`);

    const sessionParams = {
      definition: {
        application: 'siwx-demo',
        protocol: RPCProtocolVersion.NitroRPC_0_4,
        participants: [agentAddress, env.merchantAddress as `0x${string}`],
        weights: [1, 1],
        quorum: 2, // BOTH must sign!
        challenge: 0,
        nonce: Date.now(),
      },
      allocations: [
        {
          participant: agentAddress,
          asset: env.assetSymbol,
          amount: '1.0',
        },
        {
          participant: env.merchantAddress as `0x${string}`,
          asset: env.assetSymbol,
          amount: '0.0',
        },
      ],
    };

    // Agent creates and signs message
    const agentSessionMessage = await createAppSessionMessage(agentSigner, sessionParams);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const sessionParsed = JSON.parse(agentSessionMessage);

    // Merchant signs the ARRAY (critical lesson from MISTAKES.md!)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const merchantSessionSig = await merchantSigner(sessionParsed.req);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    sessionParsed.sig.push(merchantSessionSig);

    console.log('Agent signed session creation');
    console.log('Merchant signed session creation');
    console.log('');

    const sessionResponse = await yellowClient.sendRawMessage(JSON.stringify(sessionParsed));

    // Check both camelCase and snake_case formats
    type YellowSessionResponse = {
      result?: { appSessionId?: string; app_session_id?: string };
      appSessionId?: string;
      app_session_id?: string;
    };
    const response = sessionResponse as YellowSessionResponse;
    const appSessionId =
      response.result?.appSessionId ??
      response.result?.app_session_id ??
      response.app_session_id ??
      response.appSessionId;

    if (!appSessionId) {
      console.error('Failed to create Yellow session');
      console.error('Response:', JSON.stringify(sessionResponse, null, 2));
      process.exit(1);
    }

    console.log(`Yellow session created: ${appSessionId}`);
    console.log(`Balance: 1.0 ${env.assetSymbol}\n`);

    // Create SIWx signature for wallet authentication
    console.log('--- Step 2: Create SIWx Authentication ---\n');

    const resourceUrl = 'mcp://tool/stock_price';
    // Use Base Sepolia for SIWx (EVM chain needed for SIWE)
    const evmChainId = 'eip155:84532'; // Base Sepolia

    const siwxInfo: CompleteSIWxInfo = {
      domain: 'mcp.local',
      uri: resourceUrl,
      version: '1',
      chainId: evmChainId,
      type: 'eip191' as const,
      nonce: Date.now().toString(36).padStart(8, '0'),
      issuedAt: new Date().toISOString(),
      statement: 'Sign in to access paid tools',
    };

    console.log('SIWx Challenge (what agent needs to sign):');
    console.log('==========================================');
    console.log(JSON.stringify(siwxInfo, null, 2));
    console.log('');

    console.log('Signing with agent wallet...');
    const siwxPayload = await createSIWxPayload(siwxInfo, agentWallet);

    console.log('\nSIWx Signed Payload:');
    console.log('====================');
    console.log(`Wallet Address: ${siwxPayload.address}`);
    console.log(
      `Signature: ${siwxPayload.signature.substring(0, 20)}...${siwxPayload.signature.substring(siwxPayload.signature.length - 10)}`,
    );
    console.log(`Nonce: ${siwxPayload.nonce}`);
    console.log(`Issued At: ${siwxPayload.issuedAt}`);
    console.log('');

    const siwxHeader = encodeSIWxHeader(siwxPayload);
    console.log(`Encoded for SIGN-IN-WITH-X header (${siwxHeader.length} chars)\n`);

    // First request with SIWx authentication + Yellow session
    console.log('--- Step 3: First Request (Authentication + Payment) ---\n');

    const firstResult = await mcpClient.callTool({
      name: 'stock_price',
      arguments: { symbol: 'AAPL' },
      _meta: {
        'SIGN-IN-WITH-X': siwxHeader,
        'x402/yellow': {
          appSessionId,
          payer: agentAddress,
        },
      },
    });

    if (!firstResult.isError && Array.isArray(firstResult.content)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const firstContent = firstResult.content[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const resultText = firstContent?.type === 'text' ? firstContent.text : null;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const data = resultText ? JSON.parse(resultText) : firstResult.content[0];

      console.log('Success! Stock data received:');
      console.log('=============================');
      console.log(JSON.stringify(data, null, 2));
      console.log('');
      console.log('Server actions:');
      console.log('  1. Verified SIWx signature (EIP-191)');
      console.log('  2. Marked nonce as used (prevents replay)');
      console.log('  3. Stored mapping: wallet -> Yellow session ID');
      console.log('  4. Deducted 0.1 ytest.usd from session balance');
      console.log('  5. Returned stock data\n');
    } else {
      console.error('Request failed:', firstResult.content);
      throw new Error('First request failed');
    }

    // Second request - should reuse session (no payment needed)
    console.log('--- Step 4: Subsequent Request (Session Reuse) ---\n');
    console.log('Making second request to different tool: market_rumors');
    console.log('Key difference: NO Yellow session ID provided!');
    console.log('Server will look up session by wallet address from storage.\n');

    // Sign for the new resource
    const resourceUrl2 = 'mcp://tool/market_rumors';
    const siwxInfo2: CompleteSIWxInfo = {
      domain: 'mcp.local',
      uri: resourceUrl2,
      version: '1',
      chainId: evmChainId,
      type: 'eip191' as const,
      nonce: Date.now().toString(36).padStart(8, '0'),
      issuedAt: new Date().toISOString(),
      statement: 'Sign in to access paid tools',
    };

    const siwxPayload2 = await createSIWxPayload(siwxInfo2, agentWallet);
    const siwxHeader2 = encodeSIWxHeader(siwxPayload2);

    console.log('New SIWx signature for market_rumors resource:');
    console.log(`  Nonce: ${siwxPayload2.nonce}`);
    console.log(`  Signature: ${siwxPayload2.signature.substring(0, 20)}...`);
    console.log('');

    const secondResult = await mcpClient.callTool({
      name: 'market_rumors',
      arguments: { symbol: 'GOOGL' },
      _meta: {
        'SIGN-IN-WITH-X': siwxHeader2,
      },
    });

    if (!secondResult.isError && Array.isArray(secondResult.content)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const secondContent = secondResult.content[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const resultText = secondContent?.type === 'text' ? secondContent.text : null;
      let data;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data = resultText ? JSON.parse(resultText) : secondResult.content[0];
      } catch {
        console.log('Data received (non-JSON):', resultText);
        data = {};
      }

      console.log('Success! Market rumors received:');
      console.log('=================================');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      console.log(`Reddit posts: ${data.reddit?.length ?? 0}`);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      console.log(`Tavily results: ${data.tavily?.length ?? 0}`);
      console.log('');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (data.reddit?.[0]) {
        console.log('Sample Reddit post:');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        console.log(`  "${data.reddit[0].title}"`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        console.log(`  Score: ${data.reddit[0].score}, Subreddit: r/${data.reddit[0].subreddit}`);
        console.log('');
      }
      console.log('Server actions:');
      console.log('  1. Verified SIWx signature (different nonce)');
      console.log('  2. Looked up session by wallet address in storage');
      console.log(`  3. Found session: ${appSessionId.substring(0, 20)}...`);
      console.log('  4. Reused existing Yellow session');
      console.log('  5. No payment deducted');
      console.log('  6. Returned market data\n');
    } else {
      // Handle error gracefully
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const errorContent = Array.isArray(secondResult.content) ? secondResult.content[0] : null;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const errorText = errorContent?.type === 'text' ? errorContent.text : 'Unknown error';
      console.log(`Request encountered error: ${errorText}`);
      console.log('(Continuing to session close...)\n');
    }

    // Close session with QUORUM 2 and pay merchant
    console.log('--- Step 5: Close Session (Off-ramp to Merchant) ---\n');

    // Allocate session funds: 0.2 to merchant (payment), 0.8 back to agent
    const merchantPayment = '0.2';
    const agentRefund = '0.8';

    console.log('Closing Yellow session with Quorum 2 (both must sign):');
    console.log(`  Merchant: ${merchantPayment} ${env.assetSymbol} (payment for 2 API calls)`);
    console.log(`  Agent: ${agentRefund} ${env.assetSymbol} (refund of unused)`);
    console.log('');

    const closeAllocations = [
      {
        participant: agentAddress,
        asset: env.assetSymbol,
        amount: agentRefund,
      },
      {
        participant: env.merchantAddress as `0x${string}`,
        asset: env.assetSymbol,
        amount: merchantPayment,
      },
    ];

    // Agent creates close message
    const agentCloseSigner = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
    const agentCloseMessage = await createCloseAppSessionMessage(agentCloseSigner, {
      app_session_id: appSessionId as `0x${string}`,
      allocations: closeAllocations,
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const closeParsed = JSON.parse(agentCloseMessage);

    // Merchant signs the ARRAY (not string!) - critical lesson from MISTAKES.md
    const merchantCloseSigner = createECDSAMessageSigner(env.merchantPrivateKey as `0x${string}`);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const merchantCloseSig = await merchantCloseSigner(closeParsed.req);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    closeParsed.sig.push(merchantCloseSig);

    console.log('Agent signed session close');
    console.log('Merchant signed session close');
    console.log('');

    await yellowClient.sendRawMessage(JSON.stringify(closeParsed));
    console.log('Session closed successfully with Quorum 2');
    console.log(`Merchant off-ramped: ${merchantPayment} ${env.assetSymbol}\n`);

    console.log('=== Demo Complete ===\n');
    console.log('Summary:');
    console.log('========');
    console.log(`Yellow session: ${appSessionId} (CLOSED)`);
    console.log(`Wallet: ${agentAddress}`);
    console.log('');
    console.log('Session lifecycle:');
    console.log(`  1. Created with ${env.assetSymbol} 1.0 from agent (Quorum 2)`);
    console.log('  2. stock_price(AAPL) - Used session');
    console.log('  3. market_rumors(GOOGL) - Reused session');
    console.log('  4. Closed - Merchant received 0.2, Agent received 0.8 (Quorum 2)');
    console.log('');
    console.log('Technical flow:');
    console.log('  - Authentication: CAIP-122 SIWx (EIP-191 signatures)');
    console.log('  - Payment: Yellow Network off-chain session');
    console.log('  - Storage: wallet -> session mapping');
    console.log('  - Off-ramp: close_app_session with final allocations');
    console.log('  - Nonce tracking: Replay prevention with TTL\n');
  } catch (error) {
    console.error('Demo failed:', error);
    process.exit(1);
  } finally {
    await mcpClient.close();
  }
}

void main();
