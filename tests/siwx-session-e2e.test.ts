/**
 * E2E test for SIWx + Yellow Session integration
 * Tests complete flow: authentication, payment, session reuse
 *
 * Note: These tests require Upstash REST API URL or will be skipped
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { formatSIWEMessage } from '../src/x402/siwx/format.js';
import { createSIWxPayload, encodeSIWxHeader, parseSIWxHeader } from '../src/x402/siwx/client.js';
import { validateAndVerifySIWx } from '../src/x402/siwx/verify.js';
import { SIWxSessionStorage } from '../src/x402/siwx/storage.js';
import type { CompleteSIWxInfo, SIWxPayload } from '../src/x402/siwx/types.js';

// Test wallet
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const testWallet = privateKeyToAccount(TEST_PRIVATE_KEY);

// Skip if not using Upstash format
const isUpstashFormat = process.env.KV_URL?.startsWith('http') || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL?.startsWith('http');
const describeOrSkip = isUpstashFormat ? describe : describe.skip;

describeOrSkip('SIWx + Yellow Session E2E', () => {
  let storage: SIWxSessionStorage;

  beforeAll(() => {
    if (!isUpstashFormat) {
      console.log('[SIWx E2E Tests] Skipping - requires Upstash REST API URL');
      return;
    }
    storage = new SIWxSessionStorage();
  });

  it('should complete full authentication and session flow', async () => {
    const resourceUrl = 'mcp://tool/stock_price';
    const yellowSessionId = `test-session-${Date.now()}`;

    // Step 1: Create server challenge (simulating PaymentRequired response)
    const serverInfo: CompleteSIWxInfo = {
      domain: 'mcp.local',
      uri: resourceUrl,
      version: '1',
      chainId: 'eip155:8453',
      type: 'eip191',
      nonce: `nonce-${Date.now()}`,
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 300000).toISOString(),
      statement: 'Sign in to access paid tools',
      resources: [resourceUrl],
    };

    console.log('Step 1: Server creates challenge');
    expect(serverInfo.nonce).toBeDefined();

    // Step 2: Agent signs SIWx message
    console.log('Step 2: Agent signs SIWx challenge');
    const siwxPayload = await createSIWxPayload(serverInfo, testWallet);

    expect(siwxPayload.address).toBe(testWallet.address);
    expect(siwxPayload.signature).toBeDefined();
    expect(siwxPayload.signature).toMatch(/^0x[0-9a-f]+$/i);

    // Step 3: Encode for header
    console.log('Step 3: Encode for SIGN-IN-WITH-X header');
    const headerValue = encodeSIWxHeader(siwxPayload);
    expect(headerValue).toBeDefined();

    // Step 4: Server parses and verifies
    console.log('Step 4: Server parses and verifies signature');
    const parsed = parseSIWxHeader(headerValue);
    expect(parsed.address).toBe(testWallet.address);

    const verification = await validateAndVerifySIWx(parsed, resourceUrl, async nonce => {
      return await storage.markNonceUsed(nonce);
    });

    expect(verification.valid).toBe(true);
    expect(verification.address).toBe(testWallet.address);

    // Step 5: Store session mapping (after Yellow payment)
    console.log('Step 5: Store wallet -> session mapping');
    await storage.storeSession(testWallet.address, resourceUrl, yellowSessionId);

    // Step 6: Subsequent request - reuse session
    console.log('Step 6: Subsequent request - lookup session');
    const foundSession = await storage.getSession(testWallet.address, resourceUrl);

    expect(foundSession).toBe(yellowSessionId);
    console.log('Success: Session reused without payment!');
  });

  it('should reject nonce replay attack', async () => {
    const resourceUrl = 'mcp://tool/test_replay';

    const serverInfo: CompleteSIWxInfo = {
      domain: 'mcp.local',
      uri: resourceUrl,
      version: '1',
      chainId: 'eip155:8453',
      type: 'eip191',
      nonce: `replay-nonce-${Date.now()}`,
      issuedAt: new Date().toISOString(),
    };

    // Create and verify first time
    const payload = await createSIWxPayload(serverInfo, testWallet);

    const first = await validateAndVerifySIWx(payload, resourceUrl, async nonce => {
      return await storage.markNonceUsed(nonce);
    });

    expect(first.valid).toBe(true);

    // Try to reuse same nonce (replay attack)
    const second = await validateAndVerifySIWx(payload, resourceUrl, async nonce => {
      return await storage.markNonceUsed(nonce);
    });

    expect(second.valid).toBe(false);
    expect(second.error).toContain('Nonce');
  });

  it('should handle different resources independently', async () => {
    const resource1 = 'mcp://tool/stock_price';
    const resource2 = 'mcp://tool/market_rumors';
    const session1 = `session-1-${Date.now()}`;
    const session2 = `session-2-${Date.now()}`;

    // Store sessions for different resources
    await storage.storeSession(testWallet.address, resource1, session1);
    await storage.storeSession(testWallet.address, resource2, session2);

    // Retrieve independently
    const retrieved1 = await storage.getSession(testWallet.address, resource1);
    const retrieved2 = await storage.getSession(testWallet.address, resource2);

    expect(retrieved1).toBe(session1);
    expect(retrieved2).toBe(session2);
  });

  it('should verify signature matches claimed address', async () => {
    const serverInfo: CompleteSIWxInfo = {
      domain: 'mcp.local',
      uri: 'mcp://tool/test',
      version: '1',
      chainId: 'eip155:8453',
      type: 'eip191',
      nonce: `test-${Date.now()}`,
      issuedAt: new Date().toISOString(),
    };

    // Sign with testWallet
    const message = formatSIWEMessage(serverInfo, testWallet.address);
    const signature = await testWallet.signMessage({ message });

    // Create payload claiming different address
    const fakePayload: SIWxPayload = {
      ...serverInfo,
      address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // Wrong address
      signature,
    };

    const verification = await validateAndVerifySIWx(fakePayload, serverInfo.uri);

    expect(verification.valid).toBe(false);
  });
});
