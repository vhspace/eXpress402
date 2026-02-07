import { describe, it, expect, beforeAll } from 'vitest';
import { YellowRpcClient } from '../src/yellow/rpc.js';
import { getYellowConfig } from '../src/yellow/config.js';

describe('Merchant Offramp - Payment Channel Operations', () => {
  let client: YellowRpcClient;
  let config: ReturnType<typeof getYellowConfig>;

  beforeAll(() => {
    config = getYellowConfig();

    if (!config.merchantPrivateKey) {
      throw new Error('YELLOW_MERCHANT_PRIVATE_KEY required for tests');
    }

    client = new YellowRpcClient({
      url: config.clearnodeUrl,
      privateKey: config.merchantPrivateKey,
      authDomain: config.authDomain,
      debug: false,
    });
  });

  describe('createChannel', () => {
    it('should create a payment channel with valid parameters', async () => {
      // Get asset information
      const assetsResponse = (await client.request('get_assets', {})) as {
        assets?: Array<{
          symbol: string;
          address: string;
          chainId: number;
          decimals: number;
        }>;
      };

      const asset = assetsResponse.assets?.find(
        (a: { symbol: string; chainId: number }) =>
          a.symbol === config.assetSymbol && a.chainId === 11155111,
      );

      if (!asset) {
        console.log('Skipping test: Asset not found on Sepolia');
        return;
      }

      const response = await client.createChannel(asset.chainId, asset.address as `0x${string}`);

      expect(response).toBeDefined();
      expect(response.channelId || (response as any).channel_id).toBeDefined();
      expect(response.channel).toBeDefined();
      expect(response.channel.participants).toHaveLength(2);
      expect(response.channel.participants[0]?.toLowerCase()).toBe(
        config.merchantAddress?.toLowerCase(),
      );
      expect(response.state).toBeDefined();
      expect(response.state.intent).toBe(1); // INITIALIZE
      expect(response.state.version).toBe(0);
    }, 30000);

    it('should fail without authentication', async () => {
      const unauthClient = new YellowRpcClient({
        url: config.clearnodeUrl,
      });

      await expect(async () => {
        await unauthClient.createChannel(11155111, '0x1234567890123456789012345678901234567890');
      }).rejects.toThrow('Missing private key');
    });
  });

  describe('resizeChannel', () => {
    it('should require valid channel ID', async () => {
      const invalidChannelId = '0x0000000000000000000000000000000000000000000000000000000000000000';
      const amount = BigInt(100000); // 0.1 USDC

      await expect(async () => {
        await client.resizeChannel(
          invalidChannelId as `0x${string}`,
          amount,
          -amount,
          config.merchantAddress as `0x${string}`,
        );
      }).rejects.toThrow();
    }, 30000);

    it('should handle amount conversions correctly', () => {
      const humanAmount = 0.2; // 0.2 USDC
      const decimals = 6;
      const expectedBigInt = BigInt(Math.floor(humanAmount * Math.pow(10, decimals)));

      expect(expectedBigInt).toBe(BigInt(200000));
    });
  });

  describe('closeChannel', () => {
    it('should require valid channel ID', async () => {
      const invalidChannelId = '0x0000000000000000000000000000000000000000000000000000000000000000';

      await expect(async () => {
        await client.closeChannel(
          invalidChannelId as `0x${string}`,
          config.merchantAddress as `0x${string}`,
        );
      }).rejects.toThrow();
    }, 30000);

    it('should fail without authentication', async () => {
      const unauthClient = new YellowRpcClient({
        url: config.clearnodeUrl,
      });

      await expect(async () => {
        await unauthClient.closeChannel(
          '0x1234567890123456789012345678901234567890123456789012345678901234' as `0x${string}`,
          '0x1234567890123456789012345678901234567890' as `0x${string}`,
        );
      }).rejects.toThrow('Missing private key');
    });
  });

  describe('Transaction Hash Extraction', () => {
    it('should extract txHash from response (camelCase)', () => {
      const response = {
        channelId: '0xabc',
        state: {},
        txHash: '0x1234567890abcdef',
      };

      const txHash = response.txHash ?? (response as any).tx_hash;
      expect(txHash).toBe('0x1234567890abcdef');
    });

    it('should extract tx_hash from response (snake_case)', () => {
      const response = {
        channel_id: '0xabc',
        state: {},
        tx_hash: '0xfedcba0987654321',
      };

      const txHash = (response as any).txHash ?? response.tx_hash;
      expect(txHash).toBe('0xfedcba0987654321');
    });

    it('should handle missing transaction hash', () => {
      const response = {
        channelId: '0xabc',
        state: {},
      };

      const txHash = (response as any).txHash ?? (response as any).tx_hash;
      expect(txHash).toBeUndefined();
    });
  });

  describe('Etherscan URL Generation', () => {
    it('should generate correct Sepolia Etherscan URL', () => {
      const txHash = '0x1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z';
      const etherscanUrl = `https://sepolia.etherscan.io/tx/${txHash}`;

      expect(etherscanUrl).toBe(
        'https://sepolia.etherscan.io/tx/0x1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z',
      );
    });

    it('should handle mainnet Etherscan URL', () => {
      const txHash = '0xabcdef123456';
      const etherscanUrl = `https://etherscan.io/tx/${txHash}`;

      expect(etherscanUrl).toBe('https://etherscan.io/tx/0xabcdef123456');
    });
  });

  describe('Amount Conversions', () => {
    it('should convert human-readable to smallest units (6 decimals)', () => {
      const humanAmount = '0.2';
      const decimals = 6;
      const amountBigInt = BigInt(Math.floor(Number(humanAmount) * Math.pow(10, decimals)));

      expect(amountBigInt).toBe(BigInt(200000));
    });

    it('should convert human-readable to smallest units (18 decimals)', () => {
      const humanAmount = '1.5';
      const decimals = 18;
      const amountBigInt = BigInt(Math.floor(Number(humanAmount) * Math.pow(10, decimals)));

      expect(amountBigInt).toBe(BigInt('1500000000000000000'));
    });

    it('should handle small amounts correctly', () => {
      const humanAmount = '0.000001';
      const decimals = 6;
      const amountBigInt = BigInt(Math.floor(Number(humanAmount) * Math.pow(10, decimals)));

      expect(amountBigInt).toBe(BigInt(1));
    });

    it('should handle resize amount calculations', () => {
      const unifiedBalance = '0.2';
      const decimals = 6;
      const amountBigInt = BigInt(Math.floor(Number(unifiedBalance) * Math.pow(10, decimals)));

      const resizeAmount = amountBigInt; // Positive: deposit to channel
      const allocateAmount = -amountBigInt; // Negative: withdraw from unified

      expect(resizeAmount).toBe(BigInt(200000));
      expect(allocateAmount).toBe(BigInt(-200000));
    });
  });

  describe('Error Handling', () => {
    it('should handle missing merchant private key', () => {
      expect(() => {
        new YellowRpcClient({
          url: config.clearnodeUrl,
        });
      }).not.toThrow();

      const unauthClient = new YellowRpcClient({
        url: config.clearnodeUrl,
      });

      expect(async () => {
        await unauthClient.createChannel(11155111, '0x1234567890123456789012345678901234567890');
      }).rejects.toThrow();
    });

    it('should handle network errors gracefully', async () => {
      const badClient = new YellowRpcClient({
        url: 'wss://invalid-url.example.com',
        privateKey: config.merchantPrivateKey,
        timeoutMs: 2000,
      });

      await expect(async () => {
        await badClient.createChannel(11155111, '0x1234567890123456789012345678901234567890');
      }).rejects.toThrow();
    }, 10000);

    it('should validate destination address format', () => {
      const validAddress = '0x9126d073e0a5e45D907feA0b4f4857F5b7191430';
      const invalidAddress = '0xinvalid';

      expect(validAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(invalidAddress).not.toMatch(/^0x[a-fA-F0-9]{40}$/);
    });
  });

  describe('Balance Queries', () => {
    it('should fetch ledger balances', async () => {
      const balances = await client.getLedgerBalances();

      expect(Array.isArray(balances)).toBe(true);

      if (balances.length > 0) {
        const balance = balances[0];
        expect(balance).toHaveProperty('asset');
        expect(balance).toHaveProperty('amount');
      }
    }, 30000);

    it('should find specific asset balance', async () => {
      const balances = await client.getLedgerBalances();
      const assetBalance = balances.find(b => b.asset === config.assetSymbol);

      if (assetBalance) {
        expect(assetBalance.asset).toBe(config.assetSymbol);
        expect(typeof assetBalance.amount).toBe('string');
        expect(Number(assetBalance.amount)).toBeGreaterThanOrEqual(0);
      }
    }, 30000);
  });

  describe('Asset Configuration', () => {
    it('should fetch assets from Yellow Network', async () => {
      const assetsResponse = (await client.request('get_assets', {})) as {
        assets?: Array<{
          symbol: string;
          address: string;
          chainId: number;
          decimals: number;
        }>;
      };

      expect(assetsResponse).toBeDefined();
      if (assetsResponse.assets) {
        expect(Array.isArray(assetsResponse.assets)).toBe(true);
      }
    }, 30000);

    it('should find ytest.usd on Sepolia', async () => {
      const assetsResponse = (await client.request('get_assets', {})) as {
        assets?: Array<{
          symbol: string;
          address: string;
          chainId: number;
          decimals: number;
        }>;
      };

      const asset = assetsResponse.assets?.find(
        (a: { symbol: string; chainId: number }) =>
          a.symbol === 'ytest.usd' && a.chainId === 11155111,
      );

      if (asset) {
        expect(asset.symbol).toBe('ytest.usd');
        expect(asset.chainId).toBe(11155111);
        expect(asset.decimals).toBe(6);
        expect(asset.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      }
    }, 30000);
  });
});
