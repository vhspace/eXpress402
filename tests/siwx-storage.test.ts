/**
 * Unit tests for SIWx session storage
 * Tests Redis/KV operations
 *
 * Note: These tests require KV_URL to be a REST API endpoint (Upstash format)
 * or will be skipped for local redis:// URLs
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SIWxSessionStorage } from '../src/x402/siwx/storage.js';

// Skip tests if using local redis:// URL (Upstash client needs REST API)
const isUpstashFormat =
  process.env.KV_URL?.startsWith('http') ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL?.startsWith('http');
const describeOrSkip = isUpstashFormat ? describe : describe.skip;

describeOrSkip('SIWxSessionStorage', () => {
  let storage: SIWxSessionStorage;

  beforeAll(() => {
    if (!isUpstashFormat) {
      console.log('[SIWx Storage Tests] Skipping - requires Upstash REST API URL');
      return;
    }
    storage = new SIWxSessionStorage();
  });

  describe('session management', () => {
    it('should store and retrieve session', async () => {
      const wallet = '0x857b06519E91e3A54538791bDbb0E22373e36b66';
      const resource = 'mcp://tool/stock_price';
      const sessionId = 'test-session-123';

      await storage.storeSession(wallet, resource, sessionId);
      const retrieved = await storage.getSession(wallet, resource);

      expect(retrieved).toBe(sessionId);
    });

    it('should normalize wallet address to lowercase', async () => {
      const wallet = '0xABCDEF1234567890abcdef1234567890ABCDEF12';
      const resource = 'mcp://tool/test';
      const sessionId = 'session-abc';

      await storage.storeSession(wallet, resource, sessionId);

      // Should retrieve with different casing
      const retrieved = await storage.getSession(wallet.toUpperCase(), resource);
      expect(retrieved).toBe(sessionId);
    });

    it('should return null for non-existent session', async () => {
      const wallet = '0x1234567890123456789012345678901234567890';
      const resource = 'mcp://tool/nonexistent';

      const retrieved = await storage.getSession(wallet, resource);
      expect(retrieved).toBeNull();
    });

    it('should delete session', async () => {
      const wallet = '0x857b06519E91e3A54538791bDbb0E22373e36b66';
      const resource = 'mcp://tool/delete_test';
      const sessionId = 'session-to-delete';

      await storage.storeSession(wallet, resource, sessionId);
      let retrieved = await storage.getSession(wallet, resource);
      expect(retrieved).toBe(sessionId);

      await storage.deleteSession(wallet, resource);
      retrieved = await storage.getSession(wallet, resource);
      expect(retrieved).toBeNull();
    });
  });

  describe('nonce management', () => {
    it('should mark nonce as used', async () => {
      const nonce = `test-nonce-${Date.now()}`;

      const first = await storage.markNonceUsed(nonce);
      expect(first).toBe(true);
    });

    it('should prevent nonce replay', async () => {
      const nonce = `replay-test-${Date.now()}`;

      const first = await storage.markNonceUsed(nonce);
      expect(first).toBe(true);

      const second = await storage.markNonceUsed(nonce);
      expect(second).toBe(false); // Replay detected
    });
  });

  describe('health check', () => {
    it('should ping Redis/KV successfully', async () => {
      const result = await storage.ping();
      expect(result).toBe(true);
    });
  });
});
