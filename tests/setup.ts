/**
 * Global test setup
 * Configures environment for unit and e2e tests
 */

import { beforeAll } from 'vitest';

beforeAll(() => {
  // Setup test environment
  process.env.KV_URL = process.env.KV_URL || 'redis://redis:6379';
  process.env.KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || 'test-token';

  // Yellow test configuration
  process.env.YELLOW_CLEARNODE_URL =
    process.env.YELLOW_CLEARNODE_URL || 'wss://clearnode-sandbox.yellow.org';
  process.env.YELLOW_MERCHANT_ADDRESS =
    process.env.YELLOW_MERCHANT_ADDRESS || '0x0000000000000000000000000000000000000000';

  console.log('[Test Setup] Environment configured');
  console.log(`[Test Setup] KV_URL: ${process.env.KV_URL}`);
});
