/**
 * Session storage for SIWx authentication
 * Maps wallet addresses to payment-rail session IDs and tracks replay protection
 * Uses Redis (local via ioredis) or Upstash Redis (production via Vercel)
 */

import { Redis as UpstashRedis } from '@upstash/redis';
import { Redis as IORedisClient } from 'ioredis';

type SessionMapping = {
  walletAddress: string;
  scheme: string;
  sessionId: string;
  resourceUrl: string;
  createdAt: string;
};

// Client interface that works with both Redis types
interface RedisClient {
  get(key: string): Promise<any>;
  set(key: string, value: any, options?: { ex?: number }): Promise<any>;
  exists(key: string): Promise<number>;
  del(key: string): Promise<any>;
  ping(): Promise<string>;
}

/**
 * Create Redis client with automatic environment detection
 * - Local dev: Uses ioredis with redis:// URLs (Docker Redis)
 * - Production: Uses Upstash Redis with https:// REST API (Vercel)
 */
function createKVClient(): RedisClient | null {
  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? 'local-dev-token';

  if (!url) {
    console.error('[SIWx Storage] No KV URL configured.');
    return null;
  }

  // Upstash Redis (production) - requires HTTPS REST API
  if (url.startsWith('http')) {
    console.error('[SIWx Storage] Connecting to Upstash Redis (production)');
    return new UpstashRedis({ url, token }) as unknown as RedisClient;
  }

  // Local Redis - use ioredis for redis:// URLs
  if (url.startsWith('redis://')) {
    console.error(`[SIWx Storage] Connecting to local Redis: ${url}`);
    
    // Configure ioredis to not throw on connection errors
    const client = new IORedisClient(url, {
      lazyConnect: true,
      retryStrategy: () => null, // Don't retry if connection fails
      enableOfflineQueue: false,
    });

    // Connect without throwing if fails
    client.connect().catch(() => {
      console.error('[SIWx Storage] Warning: Redis not available, storage disabled');
    });

    // Wrap ioredis to match our interface
    return {
      async get(key: string) {
        try {
          const value = await client.get(key);
          return value ? JSON.parse(value) : null;
        } catch {
          return null;
        }
      },
      async set(key: string, value: any, options?: { ex?: number }) {
        try {
          const json = JSON.stringify(value);
          if (options?.ex) {
            await client.setex(key, options.ex, json);
          } else {
            await client.set(key, json);
          }
        } catch {
          // Silently fail if Redis unavailable
        }
      },
      async exists(key: string) {
        try {
          return await client.exists(key);
        } catch {
          return 0;
        }
      },
      async del(key: string) {
        try {
          await client.del(key);
        } catch {
          // Silently fail
        }
      },
      async ping() {
        try {
          return await client.ping();
        } catch {
          return 'UNAVAILABLE';
        }
      },
    } as RedisClient;
  }

  console.error(`[SIWx Storage] Unknown URL format: ${url}`);
  return null;
}

// Lazy initialization to allow env vars to be set first
let kv: RedisClient | null = null;
let kvInitialized = false;

function getKV(): RedisClient | null {
  if (!kvInitialized) {
    kv = createKVClient();
    kvInitialized = true;
  }
  return kv;
}

/**
 * SIWx session storage implementation
 * Thread-safe operations with Redis
 */
export class SIWxSessionStorage {
  /**
   * Store wallet to rail session mapping
   * Auto-configured for local Redis or Upstash
   *
   * @param wallet - Wallet address (checksummed)
   * @param resource - Resource URL
   * @param sessionId - Session ID (rail-specific)
   * @param scheme - Payment rail scheme (defaults to yellow-offchain)
   */
  async storeSession(
    wallet: string,
    resource: string,
    sessionId: string,
    scheme: string = 'yellow-offchain',
  ): Promise<void> {
    // Store session per-wallet per-scheme (not per-resource)
    const key = `session:${scheme}:${wallet.toLowerCase()}`;
    const data: SessionMapping = {
      walletAddress: wallet,
      scheme,
      sessionId,
      resourceUrl: resource, // Track original resource for reference
      createdAt: new Date().toISOString(),
    };

    const client = getKV();
    if (client) {
      await client.set(key, data);
      console.error(`[SIWx] Session stored in Redis: ${scheme}:${wallet} -> ${sessionId}`);
    } else {
      console.error('[SIWx Storage] Warning: No storage available, sessions not persisted');
    }
  }

  /**
   * Retrieve existing session for wallet and resource
   *
   * @param wallet - Wallet address
   * @param resource - Resource URL
   * @param scheme - Payment rail scheme (defaults to yellow-offchain)
   * @returns Session ID or null if not found
   */
  async getSession(wallet: string, resource: string, scheme: string = 'yellow-offchain'): Promise<string | null> {
    // Lookup session by wallet + scheme (not per-resource)
    const key = `session:${scheme}:${wallet.toLowerCase()}`;

    const client = getKV();
    if (!client) {
      console.error('[SIWx Storage] Warning: No storage available');
      return null;
    }

    const data = await client.get(key);

    if (data) {
      console.error(`[SIWx] Session found in Redis: ${scheme}:${wallet} -> ${data.sessionId}`);
      return data.sessionId as string;
    }

    return null;
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
    if (!client) {
      console.error('[SIWx Storage] Error: Storage required for nonce tracking');
      return false; // Reject if no storage available
    }

    const exists = await client.exists(key);

    if (exists > 0) {
      console.error(`[SIWx] Nonce replay detected: ${nonce}`);
      return false;
    }

    // Store with 5 minute TTL (auto-expires)
    await client.set(key, '1', { ex: 300 });
    console.error(`[SIWx] Nonce marked used in Redis: ${nonce} (expires in 5min)`);
    return true;
  }

  /**
   * Delete session mapping (e.g., on logout or expiry)
   *
   * @param wallet - Wallet address
   * @param resource - Resource URL
   */
  async deleteSession(wallet: string, resource: string): Promise<void> {
    // Delete yellow session by default (legacy signature kept for compatibility)
    const key = `session:yellow-offchain:${wallet.toLowerCase()}`;

    const client = getKV();
    if (client) {
      await client.del(key);
      console.error(`[SIWx] Session deleted from Redis: yellow-offchain:${wallet}`);
    }
  }

  /**
   * Mark a payment proof as used to prevent replay attacks.
   * Intended for onchain receipts (e.g. Gateway transferSpecHash).
   *
   * @throws if storage is unavailable or payment was already used
   */
  async markPaymentUsed(paymentId: string): Promise<void> {
    const ttlSeconds = Number(process.env.PAYMENT_REPLAY_TTL_SECONDS ?? '86400');
    const key = `payment:${paymentId.toLowerCase()}`;

    const client = getKV();
    if (!client) {
      throw new Error('storage_unavailable');
    }

    const exists = await client.exists(key);
    if (exists > 0) {
      throw new Error('payment_replay_detected');
    }

    await client.set(key, '1', { ex: Number.isFinite(ttlSeconds) ? ttlSeconds : 86400 });
  }

  /**
   * Health check - verify Redis connection
   * Called during server startup
   *
   * @returns true if connection successful
   */
  async ping(): Promise<boolean> {
    const client = getKV();
    if (!client) {
      console.error('[SIWx Storage] No client available');
      return false;
    }

    try {
      const response = await client.ping();
      console.error('[SIWx Storage] Connection verified');
      return response === 'PONG';
    } catch (error) {
      console.error('[SIWx Storage] Connection failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const siwxStorage = new SIWxSessionStorage();
