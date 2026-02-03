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
import { privateKeyToAccount } from 'viem/accounts';
import {
  createAppSessionMessage,
  createECDSAMessageSigner,
} from '@erc7824/nitrolite/dist/rpc/api.js';
import { RPCProtocolVersion } from '@erc7824/nitrolite/dist/rpc/types/index.js';
import { getYellowConfig } from './yellow/config.js';
import { YellowRpcClient } from './yellow/rpc.js';
import { createSIWxPayload, encodeSIWxHeader } from './x402/siwx/client.js';
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

// SIWx auth cache - store signed challenges for reuse
const siwxAuthCache = new Map<string, string>();

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
      KV_URL: process.env.KV_URL || 'redis://redis:6379',
      KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN || 'local-dev-token',
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

  // Setup Yellow client for session creation
  const yellowClient = new YellowRpcClient({
    url: env.clearnodeUrl,
    privateKey: env.agentPrivateKey,
  });

  try {
    console.log('--- Step 1: Create Yellow Session ---\n');
    
    // Authenticate with Yellow clearnode
    console.log('Authenticating with Yellow clearnode...');
    await yellowClient.connect();
    await yellowClient.authenticate({
      allowances: [{ asset: env.assetSymbol, amount: '10.0' }],
      scope: 'transfer',
    });
    console.log('Authenticated successfully\n');
    
    // Create Yellow payment session
    const signer = createECDSAMessageSigner(env.agentPrivateKey as `0x${string}`);
    const sessionMessage = await createAppSessionMessage(signer, {
      definition: {
        application: 'siwx-demo',
        protocol: RPCProtocolVersion.NitroRPC_0_4,
        participants: [agentAddress, env.merchantAddress as `0x${string}`],
        weights: [1, 1],
        quorum: 1,
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
    });

    const sessionResponse = await yellowClient.sendRawMessage(sessionMessage);
    
    // Check both camelCase and snake_case formats
    const appSessionId = 
      (sessionResponse as any).result?.appSessionId ??
      (sessionResponse as any).result?.app_session_id ??
      (sessionResponse as any).app_session_id ??
      (sessionResponse as any).appSessionId;

    if (!appSessionId) {
      console.error('Failed to create Yellow session');
      console.error('Response:', JSON.stringify(sessionResponse, null, 2));
      process.exit(1);
    }

    console.log(`Yellow session created: ${appSessionId}`);
    console.log(`Balance: 1.0 ${env.assetSymbol}\n`);

    // Create SIWx signature for wallet authentication
    console.log('--- Step 2: Sign SIWx Challenge ---\n');
    
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

    console.log('Signing SIWx challenge with agent wallet...');
    const siwxPayload = await createSIWxPayload(siwxInfo, agentWallet);
    const siwxHeader = encodeSIWxHeader(siwxPayload);
    console.log('SIWx signature created\n');

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
    } as any);

    if (!firstResult.isError && Array.isArray(firstResult.content)) {
      console.log('Success! Data received:');
      const resultText = (firstResult.content[0] as any)?.text;
      console.log(resultText ? JSON.parse(resultText) : firstResult.content[0]);
      console.log('\nServer stored: wallet -> Yellow session mapping in Redis\n');
    } else {
      console.error('Request failed:', firstResult.content);
      throw new Error('First request failed');
    }

    // Second request - should reuse session (no payment needed)
    console.log('--- Step 4: Subsequent Request (Session Reuse) ---\n');
    console.log('Making second request to different tool...');
    console.log('(No Yellow session ID needed - server looks it up via wallet address)\n');

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

    const secondResult = await mcpClient.callTool({
      name: 'market_rumors',
      arguments: { symbol: 'GOOGL' },
      _meta: {
        'SIGN-IN-WITH-X': siwxHeader2,
      },
    } as any);

    if (!secondResult.isError && Array.isArray(secondResult.content)) {
      console.log('Success! Session reused - NO PAYMENT NEEDED!');
      const resultText = (secondResult.content[0] as any)?.text;
      console.log(resultText ? JSON.parse(resultText) : secondResult.content[0]);
      console.log('\nServer found existing session in Redis (~1ms lookup)\n');
    } else {
      console.error('Request failed:', secondResult.content);
      throw new Error('Second request failed');
    }

    console.log('=== Demo Complete ===\n');
    console.log('Summary:');
    console.log('- First request: Authenticated with wallet + Used Yellow session');
    console.log('- Second request: Reused session via wallet signature (no payment!)');
    console.log('- Result: Pay once, call many times\n');
  } catch (error) {
    console.error('Demo failed:', error);
    process.exit(1);
  } finally {
    await mcpClient.close();
  }
}

void main();
