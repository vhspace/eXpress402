/**
 * Unit tests for SIWx signature verification
 */

import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { formatSIWEMessage } from '../src/x402/siwx/format.js';
import { validateSIWxMessage, verifySIWxSignature } from '../src/x402/siwx/verify.js';
import type { CompleteSIWxInfo, SIWxPayload } from '../src/x402/siwx/types.js';

// Test wallet for consistent testing
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const testWallet = privateKeyToAccount(TEST_PRIVATE_KEY);

describe('validateSIWxMessage', () => {
  const resourceUrl = 'mcp://tool/stock_price';

  const validPayload: SIWxPayload = {
    domain: 'mcp.local',
    address: testWallet.address,
    uri: resourceUrl,
    version: '1',
    chainId: 'eip155:8453',
    type: 'eip191',
    nonce: 'testnonce123', // Min 8 alphanumeric
    issuedAt: new Date().toISOString(),
    statement: 'Sign in to access tools',
    signature: '0x...',
  };

  it('should validate correct message fields', () => {
    const result = validateSIWxMessage(validPayload, resourceUrl);
    expect(result.valid).toBe(true);
  });

  it('should reject URI mismatch', () => {
    const result = validateSIWxMessage(validPayload, 'mcp://tool/different');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('URI mismatch');
  });

  it('should reject future issuedAt', () => {
    const futurePayload = {
      ...validPayload,
      issuedAt: new Date(Date.now() + 60000).toISOString(),
    };
    const result = validateSIWxMessage(futurePayload, resourceUrl);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('future');
  });

  it('should reject old message', () => {
    const oldPayload = {
      ...validPayload,
      issuedAt: new Date(Date.now() - 400000).toISOString(), // 6+ minutes old
    };
    const result = validateSIWxMessage(oldPayload, resourceUrl, { maxAge: 300000 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too old');
  });

  it('should reject expired message', () => {
    const expiredPayload = {
      ...validPayload,
      expirationTime: new Date(Date.now() - 1000).toISOString(), // Already expired
    };
    const result = validateSIWxMessage(expiredPayload, resourceUrl);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });
});

describe('verifySIWxSignature', () => {
  it('should verify valid EIP-191 signature', async () => {
    const info: CompleteSIWxInfo = {
      domain: 'mcp.local',
      uri: 'mcp://tool/stock_price',
      version: '1',
      chainId: 'eip155:8453',
      type: 'eip191',
      nonce: Date.now().toString(36).padStart(8, '0'), // Min 8 alphanumeric chars
      issuedAt: new Date().toISOString(),
      statement: 'Sign in to access paid tools',
    };

    // Create message and sign
    const message = formatSIWEMessage(info, testWallet.address);
    const signature = await testWallet.signMessage({ message });

    // Verify
    const payload: SIWxPayload = {
      ...info,
      address: testWallet.address,
      signature,
    };

    const result = await verifySIWxSignature(payload);

    expect(result.valid).toBe(true);
    expect(result.address).toBe(testWallet.address);
  });

  it('should reject invalid signature', async () => {
    const payload: SIWxPayload = {
      domain: 'mcp.local',
      address: testWallet.address,
      uri: 'mcp://tool/stock_price',
      version: '1',
      chainId: 'eip155:8453',
      type: 'eip191',
      nonce: 'invalid123',
      issuedAt: new Date().toISOString(),
      statement: 'Sign in to access tools',
      signature: '0xinvalidsignature1234567890abcdef',
    };

    const result = await verifySIWxSignature(payload);

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should reject signature from wrong wallet', async () => {
    const info: CompleteSIWxInfo = {
      domain: 'mcp.local',
      uri: 'mcp://tool/stock_price',
      version: '1',
      chainId: 'eip155:8453',
      type: 'eip191',
      nonce: Date.now().toString(36).padStart(8, '0'),
      issuedAt: new Date().toISOString(),
      statement: 'Sign in to access paid tools',
    };

    // Sign with test wallet
    const message = formatSIWEMessage(info, testWallet.address);
    const signature = await testWallet.signMessage({ message });

    // But claim it's from different address
    const payload: SIWxPayload = {
      ...info,
      address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // Different address
      signature,
    };

    const result = await verifySIWxSignature(payload);

    expect(result.valid).toBe(false);
  });

  it('should reject non-EVM chains', async () => {
    const payload: SIWxPayload = {
      domain: 'mcp.local',
      address: 'SolanaAddress123',
      uri: 'mcp://tool/stock_price',
      version: '1',
      chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      type: 'ed25519',
      nonce: 'soltest123',
      issuedAt: new Date().toISOString(),
      statement: 'Sign in to access tools',
      signature: 'solana-signature',
    };

    const result = await verifySIWxSignature(payload);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported chain');
  });
});
