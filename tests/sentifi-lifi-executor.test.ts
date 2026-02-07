import { describe, it, expect } from 'vitest';
import { LifiExecutor } from '../src/sentifi/execution/lifi-executor.js';

describe('LifiExecutor', () => {
  it('resolves Arbitrum USDC to native USDC address', () => {
    const executor = new LifiExecutor({ mode: 'demo' });
    const resolved = (executor as any).resolveTokenAddress('USDC', 42161) as string;
    expect(resolved.toLowerCase()).toBe('0xaf88d065e77c8cc2239327c5edb3a432268e5831');
  });
});
