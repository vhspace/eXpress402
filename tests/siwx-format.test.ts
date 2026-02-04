/**
 * Unit tests for SIWx message formatting
 */

import { describe, it, expect } from 'vitest';
import { formatSIWEMessage, extractEVMChainId } from '../src/x402/siwx/format.js';
import type { CompleteSIWxInfo } from '../src/x402/siwx/types.js';

describe('extractEVMChainId', () => {
  it('should extract chain ID from CAIP-2 format', () => {
    expect(extractEVMChainId('eip155:8453')).toBe(8453); // Base
    expect(extractEVMChainId('eip155:1')).toBe(1); // Ethereum
    expect(extractEVMChainId('eip155:137')).toBe(137); // Polygon
  });

  it('should throw on invalid format', () => {
    expect(() => extractEVMChainId('invalid')).toThrow('Invalid EVM chainId format');
    expect(() => extractEVMChainId('eip155:')).toThrow();
    expect(() => extractEVMChainId('eip155:abc')).toThrow();
  });
});

describe('formatSIWEMessage', () => {
  const baseInfo: CompleteSIWxInfo = {
    domain: 'api.example.com',
    uri: 'https://api.example.com/data',
    version: '1',
    chainId: 'eip155:8453',
    type: 'eip191',
    nonce: 'a1b2c3d4', // Min 8 alphanumeric
    issuedAt: '2024-01-15T10:30:00.000Z',
    statement: 'Sign in to access data',
  };

  it('should format valid SIWE message for Base', () => {
    const message = formatSIWEMessage(baseInfo, '0x857b06519E91e3A54538791bDbb0E22373e36b66');

    // Check EIP-4361 format
    expect(message).toContain('api.example.com wants you to sign in with your Ethereum account:');
    expect(message).toContain('0x857b06519E91e3A54538791bDbb0E22373e36b66');
    expect(message).toContain('URI: https://api.example.com/data');
    expect(message).toContain('Version: 1');
    expect(message).toContain('Chain ID: 8453');
    expect(message).toContain('Nonce: a1b2c3d4');
    expect(message).toContain('Issued At: 2024-01-15T10:30:00.000Z');
  });

  it('should include optional statement', () => {
    const message = formatSIWEMessage(
      { ...baseInfo, statement: 'Sign in to access premium data' },
      '0x857b06519E91e3A54538791bDbb0E22373e36b66',
    );

    expect(message).toContain('Sign in to access premium data');
  });

  it('should include optional expirationTime', () => {
    const message = formatSIWEMessage(
      { ...baseInfo, expirationTime: '2024-01-15T10:35:00.000Z' },
      '0x857b06519E91e3A54538791bDbb0E22373e36b66',
    );

    expect(message).toContain('Expiration Time: 2024-01-15T10:35:00.000Z');
  });

  it('should include optional resources', () => {
    const message = formatSIWEMessage(
      { ...baseInfo, resources: ['https://api.example.com/data', 'https://api.example.com/tools'] },
      '0x857b06519E91e3A54538791bDbb0E22373e36b66',
    );

    expect(message).toContain('Resources:');
    expect(message).toContain('- https://api.example.com/data');
    expect(message).toContain('- https://api.example.com/tools');
  });
});
