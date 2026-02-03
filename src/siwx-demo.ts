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

  // Setup MCP client
  const transport = new StdioClientTransport({
    command: 'tsx',
    args: ['src/index.ts'],
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
    console.log('--- First Request: Authentication + Payment ---\n');

    // First call without authentication - expect 402 error with payment data
    const firstResult = await mcpClient.callTool({
      name: 'stock_price',
      arguments: { symbol: 'AAPL' },
    });

    // Check if we got a 402 response (isError with payment data)
    if (!firstResult.isError) {
      console.error('Unexpected: Tool succeeded without payment');
      console.log(firstResult.content);
      console.log('\n=== Demo Complete (No payment required) ===\n');
      return;
    }

    // Extract payment required data from MCP error
    // The MCP SDK includes it in the result even when isError=true
    const paymentRequired = (firstResult as any)._meta?.['x402/payment-required'] ?? 
                           (firstResult as any).data;

    if (!paymentRequired) {
      console.error('No payment data in 402 response');
      throw new Error('Invalid 402 response format');
    }

    console.log('Received 402 Payment Required');
    console.log(`Resource: ${paymentRequired.resource.url}`);
    console.log(
      `Price: ${paymentRequired.accepts[0].amount} ${paymentRequired.accepts[0].asset}\n`,
    );

    // Check for SIWx extension
    const siwxExt = paymentRequired.extensions?.['sign-in-with-x'];
    if (siwxExt) {
      console.log('SIWx authentication available!');
      console.log(`Domain: ${siwxExt.info.domain}`);
      console.log(`Nonce: ${siwxExt.info.nonce}\n`);

      // Sign SIWx message
      const siwxInfo: CompleteSIWxInfo = {
        ...siwxExt.info,
        chainId: siwxExt.supportedChains[0].chainId,
        type: 'eip191' as const,
      };

      console.log('Signing SIWx challenge with wallet...');
      const siwxPayload = await createSIWxPayload(siwxInfo, agentWallet);
      const siwxHeader = encodeSIWxHeader(siwxPayload);

      // Cache for subsequent requests
      siwxAuthCache.set(paymentRequired.resource.url, siwxHeader);
      console.log('SIWx signature created and cached\n');

      // Create Yellow session
      console.log('Creating Yellow payment session...');
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
      const appSessionId = (sessionResponse as any).result?.appSessionId;

      if (!appSessionId) {
        console.error('Failed to create Yellow session');
        process.exit(1);
      }

      console.log(`Yellow session created: ${appSessionId}\n`);

      // Retry request with SIWx + Yellow session
      console.log('Retrying request with authentication and payment...');
      const secondResult = await mcpClient.callTool({
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

      if (!secondResult.isError && Array.isArray(secondResult.content)) {
        console.log('Success! Data received:');
        console.log((secondResult.content as any)[0]);
        console.log('');
      } else {
        console.error('Request failed:', secondResult.content);
      }

      // Second request - should reuse session
      console.log('--- Subsequent Request: Session Reuse ---\n');
      console.log('Making second request with cached SIWx signature...');

      const thirdResult = await mcpClient.callTool({
        name: 'market_rumors',
        arguments: { symbol: 'GOOGL' },
        _meta: {
          'SIGN-IN-WITH-X': siwxHeader,
        },
      } as any);

      if (!thirdResult.isError && Array.isArray(thirdResult.content)) {
        console.log('Success! Session reused - no payment needed!');
        console.log((thirdResult.content as any)[0]);
        console.log('');
      } else {
        console.error('Request failed:', thirdResult.content);
      }
    }

    console.log('=== Demo Complete ===\n');
  } catch (error) {
    console.error('Demo failed:', error);
    process.exit(1);
  } finally {
    await mcpClient.close();
  }
}

void main();
