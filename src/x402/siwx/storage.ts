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
 * Works with local Redis and Upstash Redis (Vercel)
 */
function createKVClient(): Redis {
  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? 'local-dev-token';

  if (!url) {
    throw new Error(
      'KV_URL, UPSTASH_REDIS_REST_URL, or KV_REST_API_URL must be set. ' +
        'DevContainer auto-sets this. Run: redis-cli -h redis ping to verify.',
    );
  }

  return new Redis({ url, token });
}

// Lazy initialization to allow env vars to be set first
let kv: Redis | null = null;

function getKV(): Redis {
  if (!kv) {
    kv = createKVClient();
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
    const key = `session:${wallet.toLowerCase()}:${resource}`;
    await getKV().set(key, {
      walletAddress: wallet,
      yellowSessionId: sessionId,
      resourceUrl: resource,
      createdAt: new Date().toISOString(),
    } as SessionMapping);

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
    const key = `session:${wallet.toLowerCase()}:${resource}`;
    const data = await getKV().get<SessionMapping>(key);

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
    const exists = await getKV().exists(key);

    if (exists) {
      console.error(`[SIWx] Nonce replay detected: ${nonce}`);
      return false;
    }

    // Store with 5 minute TTL (auto-expires)
    await getKV().set(key, '1', { ex: 300 });
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
    const key = `session:${wallet.toLowerCase()}:${resource}`;
    await getKV().del(key);
    console.error(`[SIWx] Session deleted: ${wallet}`);
  }

  /**
   * Health check - verify Redis/KV connection
   * Called during server startup
   *
   * @returns true if connection successful
   */
  async ping(): Promise<boolean> {
    try {
      const response = await getKV().ping();
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
