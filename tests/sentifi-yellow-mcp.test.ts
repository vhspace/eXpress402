import { describe, it, expect, vi } from 'vitest';
import {
  computeSessionCloseAllocations,
  getToolText,
  parseJsonFromToolText,
  stopSpawnedMcpServer,
} from '../src/sentifi/server/yellow-mcp.js';

describe('sentifi/server/yellow-mcp', () => {
  describe('getToolText()', () => {
    it('returns empty text when missing content', () => {
      expect(getToolText({})).toEqual({ text: '', isError: false });
    });

    it('prefers typed text content', () => {
      const result = {
        content: [
          { type: 'text', text: '{"ok":true}' },
          { type: 'text', text: '{"ignored":true}' },
        ],
      };
      expect(getToolText(result)).toEqual({ text: '{"ok":true}', isError: false });
    });

    it('propagates isError flag', () => {
      const result = { isError: true, content: [{ type: 'text', text: 'boom' }] };
      expect(getToolText(result)).toEqual({ text: 'boom', isError: true });
    });
  });

  describe('parseJsonFromToolText()', () => {
    it('parses valid JSON', () => {
      expect(parseJsonFromToolText<{ a: number }>('tool', '{"a":1}')).toEqual({ a: 1 });
    });

    it('throws a helpful error for non-JSON', () => {
      expect(() => parseJsonFromToolText('tool', 'Reddit request failed: 429')).toThrow(
        /returned non-JSON text/i,
      );
    });
  });

  describe('stopSpawnedMcpServer()', () => {
    it('no-ops on null', async () => {
      await expect(stopSpawnedMcpServer(null)).resolves.toBeUndefined();
    });

    it('calls transport.close()', async () => {
      const close = vi.fn().mockResolvedValue(undefined);
      const transport = { close } as any;
      await stopSpawnedMcpServer(transport);
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe('computeSessionCloseAllocations()', () => {
    const agent = '0x0000000000000000000000000000000000000001' as const;
    const merchant = '0x0000000000000000000000000000000000000002' as const;

    it('returns empty allocations if addresses missing', () => {
      expect(
        computeSessionCloseAllocations({
          agentAddress: null,
          merchantAddress: merchant,
          assetSymbol: 'ytest.usd',
          initialAmount: 1,
          remainingAmount: 0.8,
        }),
      ).toEqual([]);
    });

    it('splits remaining to agent and spent to merchant', () => {
      const allocations = computeSessionCloseAllocations({
        agentAddress: agent,
        merchantAddress: merchant,
        assetSymbol: 'ytest.usd',
        initialAmount: 1,
        remainingAmount: 0.8,
      });

      expect(allocations).toEqual([
        { participant: agent, asset: 'ytest.usd', amount: '0.800000' },
        { participant: merchant, asset: 'ytest.usd', amount: '0.200000' },
      ]);
    });

    it('clamps remaining above initial', () => {
      const allocations = computeSessionCloseAllocations({
        agentAddress: agent,
        merchantAddress: merchant,
        assetSymbol: 'ytest.usd',
        initialAmount: 1,
        remainingAmount: 2,
      });

      expect(allocations[0]?.amount).toBe('1.000000');
      expect(allocations[1]?.amount).toBe('0.000000');
    });
  });
});
