/**
 * Session storage for SIWx authentication
 * Maps wallet addresses to Yellow session IDs
 * Uses Redis (local) or Upstash Redis (production via Vercel)
 */

import { Redis } from '@upstash/redis';

type SessionMapping = {
  walletAddress: string;
  yellowSessionId: string;
  resourceUrl: string;
  createdAt: string;
};

/**
 * Create Redis client with automatic environment detection
 * Works with Upstash Redis (Vercel production)
 * For local development without Upstash, uses in-memory fallback
 */
function createKVClient(): Redis | null {
  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? 'local-dev-token';

  if (!url) {
    console.error('[SIWx Storage] No KV URL configured. Using in-memory fallback (dev mode).');
    return null;
  }

  // Upstash Redis requires HTTPS REST API URLs
  if (!url.startsWith('http')) {
    console.error(
      `[SIWx Storage] Upstash Redis requires HTTPS URL. Got: ${url}. Using in-memory fallback.`,
    );
    return null;
  }

  return new Redis({ url, token });
}

// Lazy initialization to allow env vars to be set first
let kv: Redis | null = null;
let kvInitialized = false;

// In-memory fallback for local development
const inMemorySessions = new Map<string, any>();
const inMemoryNonces = new Set<string>();

function getKV(): Redis | null {
  if (!kvInitialized) {
    kv = createKVClient();
    kvInitialized = true;
  }
  return kv;
}

/**
 * SIWx session storage implementation
 * Thread-safe operations with Redis/Vercel KV
 */
export class SIWxSessionStorage {
  /**
   * Store wallet to Yellow session mapping
   * Auto-configured for local Redis or Vercel KV
   *
   * @param wallet - Wallet address (checksummed)
   * @param resource - Resource URL
   * @param sessionId - Yellow session ID
   */
  async storeSession(wallet: string, resource: string, sessionId: string): Promise<void> {
    // Store session per-wallet (not per-resource) for Yellow Network
    // One Yellow session can be used for all resources
    const key = `session:${wallet.toLowerCase()}`;
    const data: SessionMapping = {
      walletAddress: wallet,
      yellowSessionId: sessionId,
      resourceUrl: resource, // Track original resource for reference
      createdAt: new Date().toISOString(),
    };

    const client = getKV();
    if (client) {
      await client.set(key, data);
    } else {
      // In-memory fallback
      inMemorySessions.set(key, data);
    }

    console.error(`[SIWx] Session stored: ${wallet} -> ${sessionId}`);
  }

  /**
   * Retrieve existing session for wallet and resource
   *
   * @param wallet - Wallet address
   * @param resource - Resource URL
   * @returns Yellow session ID or null if not found
   */
  async getSession(wallet: string, resource: string): Promise<string | null> {
    // Lookup session by wallet only (not per-resource)
    // One Yellow session works for all resources
    const key = `session:${wallet.toLowerCase()}`;

    const client = getKV();
    let data: SessionMapping | null = null;

    if (client) {
      data = await client.get<SessionMapping>(key);
    } else {
      // In-memory fallback
      data = inMemorySessions.get(key) ?? null;
    }

    if (data) {
      console.error(`[SIWx] Session found: ${wallet} -> ${data.yellowSessionId}`);
    }

    return data?.yellowSessionId ?? null;
  }

  /**
   * Mark nonce as used to prevent replay attacks
   * Auto-expires after 5 minutes (TTL)
   *
   * @param nonce - Cryptographic nonce from SIWx message
   * @returns false if nonce was already used (replay attack)
   */
  async markNonceUsed(nonce: string): Promise<boolean> {
    const key = `nonce:${nonce}`;

    const client = getKV();
    let exists = false;

    if (client) {
      exists = (await client.exists(key)) > 0;
    } else {
      // In-memory fallback
      exists = inMemoryNonces.has(nonce);
    }

    if (exists) {
      console.error(`[SIWx] Nonce replay detected: ${nonce}`);
      return false;
    }

    if (client) {
      // Store with 5 minute TTL (auto-expires)
      await client.set(key, '1', { ex: 300 });
    } else {
      // In-memory fallback
      inMemoryNonces.add(nonce);
      // Auto-expire after 5 minutes
      setTimeout(() => inMemoryNonces.delete(nonce), 300000);
    }

    console.error(`[SIWx] Nonce marked used: ${nonce} (expires in 5min)`);
    return true;
  }

  /**
   * Delete session mapping (e.g., on logout or expiry)
   *
   * @param wallet - Wallet address
   * @param resource - Resource URL
   */
  async deleteSession(wallet: string, resource: string): Promise<void> {
    // Delete session by wallet only
    const key = `session:${wallet.toLowerCase()}`;

    const client = getKV();
    if (client) {
      await client.del(key);
    } else {
      inMemorySessions.delete(key);
    }

    console.error(`[SIWx] Session deleted: ${wallet}`);
  }

  /**
   * Health check - verify Redis/KV connection
   * Called during server startup
   *
   * @returns true if connection successful
   */
  async ping(): Promise<boolean> {
    const client = getKV();
    if (!client) {
      console.error('[SIWx] Using in-memory storage (no Upstash configured)');
      return true;
    }

    try {
      const response = await client.ping();
      console.error('[SIWx] Storage connection verified');
      return response === 'PONG';
    } catch (error) {
      console.error('[SIWx] Storage connection failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const siwxStorage = new SIWxSessionStorage();
