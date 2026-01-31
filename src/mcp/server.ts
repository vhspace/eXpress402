import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getMarketRumors, getStockPrice } from "../finance/index.js";
import { buildPaymentRequired, buildSettlementResponse, validateYellowPayment } from "../x402/payment.js";
import { YellowRpcClient } from "../yellow/rpc.js";
import { verifyYellowTransfer } from "../yellow/verify.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";

const PAYMENT_RESOURCE_BASE = "mcp://tool";

const env = {
  clearnodeUrl: process.env.YELLOW_CLEARNODE_URL ?? "wss://clearnet-sandbox.yellow.com/ws",
  merchantAddress: process.env.YELLOW_MERCHANT_ADDRESS ?? "",
  assetSymbol: process.env.YELLOW_ASSET_SYMBOL ?? "usdc",
  pricePerCall: process.env.YELLOW_PRICE_PER_CALL ?? "0.1",
  network: process.env.YELLOW_NETWORK ?? "yellow:sandbox",
  maxTimeoutSeconds: Number(process.env.YELLOW_MAX_TIMEOUT_SECONDS ?? "60"),
  agentAddress: process.env.YELLOW_AGENT_ADDRESS
};

if (!env.merchantAddress) {
  console.error("Missing YELLOW_MERCHANT_ADDRESS; required for payments.");
}

const yellowClient = new YellowRpcClient({ url: env.clearnodeUrl });

export async function startMcpServer() {
  const server = new McpServer({
    name: "x402-yellow-mcp",
    version: "0.1.0"
  });

  server.registerTool(
    "stock_price",
    {
      description: "Get latest OHLCV price data for a stock symbol.",
      inputSchema: {
        symbol: z.string().min(1).describe("Stock ticker symbol, e.g. AAPL or TSLA")
      }
    },
    async ({ symbol }, extra) => {
      const settlement = await requirePayment(extra, "stock_price");
      const data = await getStockPrice(symbol);
      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
        _meta: {
          "x402/payment-response": settlement
        }
      };
    }
  );

  server.registerTool(
    "market_rumors",
    {
      description: "Fetch recent market rumors for a stock symbol from Reddit and Tavily.",
      inputSchema: {
        symbol: z.string().min(1).describe("Stock ticker symbol, e.g. AAPL or TSLA")
      }
    },
    async ({ symbol }, extra) => {
      const settlement = await requirePayment(extra, "market_rumors");
      const data = await getMarketRumors(symbol);
      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
        _meta: {
          "x402/payment-response": settlement
        }
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("x402 Yellow MCP server started.");
}

async function requirePayment(extra: RequestHandlerExtra, toolName: string) {
  if (!env.merchantAddress) {
    throw new McpError(402, "Payment unavailable: missing merchant address");
  }

  const payment = extra._meta?.["x402/payment"] as unknown;
  const resourceUrl = `${PAYMENT_RESOURCE_BASE}/${toolName}`;
  const paymentRequired = buildPaymentRequired(
    {
      clearnodeUrl: env.clearnodeUrl,
      merchantAddress: env.merchantAddress,
      assetSymbol: env.assetSymbol,
      pricePerCall: env.pricePerCall,
      network: env.network,
      maxTimeoutSeconds: env.maxTimeoutSeconds
    },
    resourceUrl,
    `Paid tool: ${toolName}`
  );

  if (!payment) {
    throw new McpError(402, "Payment required", paymentRequired);
  }

  const validation = validateYellowPayment(payment, {
    clearnodeUrl: env.clearnodeUrl,
    merchantAddress: env.merchantAddress,
    assetSymbol: env.assetSymbol,
    pricePerCall: env.pricePerCall,
    network: env.network,
    maxTimeoutSeconds: env.maxTimeoutSeconds
  });

  if (!validation.ok) {
    throw new McpError(402, `Payment invalid: ${validation.reason}`, paymentRequired);
  }

  const verified = await verifyYellowTransfer(
    yellowClient,
    validation.info,
    env.merchantAddress,
    env.assetSymbol
  );

  if (!verified) {
    const paymentResponse = buildSettlementResponse(
      false,
      env.network,
      validation.info.payer,
      undefined,
      "verification_failed"
    );
    throw new McpError(402, "Payment verification failed", {
      ...paymentRequired,
      "x402/payment-response": paymentResponse
    });
  }

  return buildSettlementResponse(
    true,
    env.network,
    validation.info.payer,
    String(validation.info.transferId)
  );
}
