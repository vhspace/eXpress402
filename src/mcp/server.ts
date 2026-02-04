import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getMarketRumors, getStockPrice } from '../finance/index.js';
import {
  buildPaymentRequired,
  buildSettlementResponse,
  validateYellowPayment,
} from '../x402/payment.js';
import type { PaymentPayload } from '../x402/types.js';
import { getYellowConfig } from '../yellow/config.js';
import { YellowRpcClient } from '../yellow/rpc.js';
import { verifyYellowTransfer } from '../yellow/verify.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { parseSIWxHeader, validateAndVerifySIWx } from '../x402/siwx/index.js';
import { siwxStorage } from '../x402/siwx/storage.js';

const PAYMENT_RESOURCE_BASE = 'mcp://tool';

let env: ReturnType<typeof getYellowConfig> | undefined;
let yellowClient: YellowRpcClient | undefined;
let yellowAuthClient: YellowRpcClient | undefined;
let yellowSessionClient: YellowRpcClient | undefined;
let sessionBalanceCache: Map<string, number> | undefined;

export async function startMcpServer() {
  try {
    // Initialize environment and clients at runtime (not module load time)
    // This ensures environment variables set in CI are available
    console.error('Initializing MCP server environment...');
    if (!env) {
      env = getYellowConfig();

      if (!env.merchantAddress) {
        console.error('Missing YELLOW_MERCHANT_ADDRESS; required for payments.');
        throw new Error('Missing YELLOW_MERCHANT_ADDRESS');
      }
      if (!env.merchantPrivateKey) {
        console.error('Missing YELLOW_MERCHANT_PRIVATE_KEY; required for offchain billing.');
        throw new Error('Missing YELLOW_MERCHANT_PRIVATE_KEY');
      }

      yellowClient = new YellowRpcClient({ url: env.clearnodeUrl });
      yellowAuthClient = new YellowRpcClient({
        url: env.clearnodeUrl,
        privateKey: env.merchantPrivateKey || undefined,
      });
      yellowSessionClient = env.sessionPrivateKey
        ? new YellowRpcClient({ url: env.clearnodeUrl, privateKey: env.sessionPrivateKey })
        : undefined;

      sessionBalanceCache = new Map<string, number>();
    }

    console.error('Creating MCP server...');
    const server = new McpServer({
      name: 'eXpress402-mcp',
      version: '0.1.0',
    });

    server.registerTool(
      'stock_price',
      {
        description: 'Get latest OHLCV price data for a stock symbol.',
        inputSchema: {
          symbol: z.string().min(1).describe('Stock ticker symbol, e.g. AAPL or TSLA'),
        },
      },
      async ({ symbol }, extra) => {
        const settlement = await requirePayment(extra, 'stock_price');
        const data = await getStockPrice(symbol);
        return {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          _meta: {
            'x402/payment-response': settlement,
          },
        };
      },
    );

    server.registerTool(
      'market_rumors',
      {
        description: 'Fetch recent market rumors for a stock symbol from Reddit and Tavily.',
        inputSchema: {
          symbol: z.string().min(1).describe('Stock ticker symbol, e.g. AAPL or TSLA'),
        },
      },
      async ({ symbol }, extra) => {
        const settlement = await requirePayment(extra, 'market_rumors');
        const data = await getMarketRumors(symbol);
        return {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          _meta: {
            'x402/payment-response': settlement,
          },
        };
      },
    );

    console.error('Setting up stdio transport...');
    const transport = new StdioServerTransport();

    console.error('Connecting server to transport...');
    await server.connect(transport);

    console.error('x402 Yellow MCP server started successfully.');
  } catch (error) {
    console.error('Error in startMcpServer:', error);
    throw error;
  }
}

function getPriceForTool(toolName: string) {
  if (!env) {
    throw new Error('Server not initialized');
  }
  const toolPrice = env.toolPrices?.[toolName];
  return toolPrice ?? env.pricePerCall;
}

async function requirePayment(extra: RequestHandlerExtra<any, any>, toolName: string) {
  if (!env) {
    throw new Error('Server not initialized - call startMcpServer() first');
  }

  // After the check above, env is guaranteed to be defined
  const config = env;

  if (!config.merchantAddress) {
    throw new McpError(402, 'Payment unavailable: missing merchant address');
  }

  const payment = extra._meta?.['x402/payment'] as PaymentPayload;
  const yellowMeta = (extra._meta?.['x402/yellow'] ?? {}) as {
    appSessionId?: string;
    payer?: string;
  };
  const resourceUrl = `${PAYMENT_RESOURCE_BASE}/${toolName}`;
  const pricePerCall = getPriceForTool(toolName);
  const paymentRequired = buildPaymentRequired(
    {
      clearnodeUrl: config.clearnodeUrl,
      merchantAddress: config.merchantAddress,
      assetSymbol: config.assetSymbol,
      pricePerCall,
      network: config.network,
      maxTimeoutSeconds: config.maxTimeoutSeconds,
    },
    resourceUrl,
    `Paid tool: ${toolName}`,
  );

  // Check for SIWx authentication header
  const siwxHeader = extra._meta?.['SIGN-IN-WITH-X'] as string | undefined;

  if (siwxHeader) {
    try {
      // Parse and verify SIWx payload
      const siwxPayload = parseSIWxHeader(siwxHeader);
      const verification = await validateAndVerifySIWx(
        siwxPayload,
        resourceUrl,
        async nonce => await siwxStorage.markNonceUsed(nonce),
      );

      if (verification.valid && verification.address) {
        // Check if this wallet has an existing Yellow session
        const existingSession = await siwxStorage.getSession(verification.address, resourceUrl);

        if (existingSession) {
          // Reuse existing session - no payment needed!
          console.error(`[SIWx] Reusing session for wallet ${verification.address}`);
          return buildSettlementResponse(
            true,
            config.network,
            verification.address,
            existingSession,
          );
        }

        // Valid auth but no session - store for later after payment
        console.error('[SIWx] Valid authentication, proceeding to payment');
        if (yellowMeta.appSessionId) {
          await siwxStorage.storeSession(
            verification.address,
            resourceUrl,
            yellowMeta.appSessionId,
          );
        }
      } else {
        console.error(`[SIWx] Invalid signature: ${verification.error}`);
      }
    } catch (error) {
      console.error('[SIWx] Header parsing failed:', error);
    }
  }

  // Log request for debugging
  console.error(`[requirePayment] Tool: ${toolName}, Has SIWx: ${!!siwxHeader}, Has payment: ${!!payment}, Has session: ${!!yellowMeta.appSessionId}`);

  if (!payment && !yellowMeta.appSessionId) {
    console.error('[requirePayment] No payment or session, throwing 402');
    throw new McpError(402, 'Payment required', paymentRequired);
  }

  if (yellowMeta.appSessionId) {
    const payer = yellowMeta.payer ?? config.agentAddress ?? '';
    
    // Check session balance from cache or query Yellow
    let remaining: number;
    if (sessionBalanceCache && sessionBalanceCache.has(yellowMeta.appSessionId)) {
      remaining = sessionBalanceCache.get(yellowMeta.appSessionId) ?? 0;
    } else {
      // First use of this session - query actual balance from Yellow
      try {
        remaining = await fetchSessionBalance(yellowMeta.appSessionId, config.assetSymbol);
      } catch (error) {
        console.error('[requirePayment] Failed to fetch session balance:', error);
        throw new McpError(402, 'Cannot verify session balance', paymentRequired);
      }
    }

    if (remaining < Number(pricePerCall)) {
      console.error(`[requirePayment] Insufficient session balance: ${remaining} < ${pricePerCall}`);
      
      // Attempt to close depleted session
      try {
        await attemptCloseAppSession(yellowMeta.appSessionId, payer, remaining);
      } catch (error) {
        console.error('[requirePayment] Failed to close depleted session:', error);
      }
      
      const paymentResponse = buildSettlementResponse(
        false,
        config.network,
        payer,
        yellowMeta.appSessionId,
        'insufficient_balance',
      );
      throw new McpError(402, 'Session balance depleted', {
        ...paymentRequired,
        'x402/payment-response': paymentResponse,
      });
    }

    if (sessionBalanceCache) {
      sessionBalanceCache.set(yellowMeta.appSessionId, remaining - Number(pricePerCall));
    }

    // If SIWx authentication present, store session mapping
    if (siwxHeader) {
      try {
        const siwxPayload = parseSIWxHeader(siwxHeader);
        await siwxStorage.storeSession(siwxPayload.address, resourceUrl, yellowMeta.appSessionId);
        console.error('[SIWx] Stored session mapping after payment');
      } catch (error) {
        console.error('[SIWx] Failed to store session mapping:', error);
      }
    }

    return buildSettlementResponse(true, config.network, payer, yellowMeta.appSessionId);
  }

  // Validate payment payload
  if (!payment || !payment.payload) {
    const paymentResponse = buildSettlementResponse(false, config.network, undefined, undefined, 'missing_payment');
    throw new McpError(402, 'Payment payload required', {
      ...paymentRequired,
      'x402/payment-response': paymentResponse,
    });
  }

  const validation = validateYellowPayment(payment, {
    clearnodeUrl: config.clearnodeUrl,
    merchantAddress: config.merchantAddress,
    assetSymbol: config.assetSymbol,
    pricePerCall,
    network: config.network,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
  });

  if (!validation.ok) {
    throw new McpError(402, `Payment invalid: ${(validation as any).reason}`, paymentRequired);
  }

  if (!yellowClient) {
    throw new Error('Yellow client not initialized');
  }

  // Verify Yellow transfer
  const verified = await verifyYellowTransfer(yellowClient, validation.info, config.merchantAddress, config.assetSymbol);

  if (!verified) {
    const paymentResponse = buildSettlementResponse(
      false,
      config.network,
      validation.info.payer,
      undefined,
      'verification_failed',
    );
    throw new McpError(402, 'Payment verification failed', {
      ...paymentRequired,
      'x402/payment-response': paymentResponse,
    });
  }

  return buildSettlementResponse(
    true,
    env.network,
    validation.info.payer,
    String(validation.info.transferId),
  );
}

async function fetchSessionBalance(appSessionId: string, asset: string): Promise<number> {
  if (!sessionBalanceCache || !env) throw new Error('Server not initialized');

  const cached = sessionBalanceCache.get(appSessionId);
  if (cached !== undefined) {
    return cached;
  }
  const client = env.sessionPrivateKey
    ? (yellowSessionClient ?? yellowAuthClient)
    : env.merchantPrivateKey
      ? yellowAuthClient
      : yellowClient;

  if (!client) throw new Error('No Yellow client available');
  if (env.sessionPrivateKey || env.merchantPrivateKey) {
    await client.authenticate({
      allowances: [{ asset, amount: '1000000' }],
      scope: 'transfer',
    });
  }
  const balances = await client.getLedgerBalances(appSessionId);
  const match = balances.find(entry => entry.asset === asset);
  const amount = match ? Number(match.amount) : 0;
  const normalized = Number.isNaN(amount) ? 0 : amount;
  sessionBalanceCache.set(appSessionId, normalized);
  return normalized;
}

async function attemptCloseAppSession(appSessionId: string, payer: string, amount: number) {
  if (!env || !yellowClient || !yellowAuthClient || !sessionBalanceCache) {
    throw new Error('Server not initialized');
  }

  if (!env?.merchantPrivateKey || !payer) {
    return;
  }

  try {
    const sessions = await yellowClient.getAppSessions(payer as `0x${string}`);
    const session = sessions.find(item => item.appSessionId === appSessionId);
    if (!session) {
      return;
    }
    const allocations = session.participants.map(participant => ({
      participant: participant as `0x${string}`,
      asset: env?.assetSymbol ?? '',
      amount: participant.toLowerCase() === payer.toLowerCase() ? String(amount) : '0',
    }));
    await yellowAuthClient.closeAppSession({
      appSessionId: appSessionId as `0x${string}`,
      allocations,
    });
    sessionBalanceCache.delete(appSessionId);
  } catch (error) {
    console.error('Failed to close app session:', error);
  }
}
