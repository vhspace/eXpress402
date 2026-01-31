import { describe, expect, it } from "vitest";
import {
  buildPaymentRequired,
  buildSettlementResponse,
  validateYellowPayment
} from "../src/x402/payment.js";

const config = {
  clearnodeUrl: "wss://clearnet-sandbox.yellow.com/ws",
  merchantAddress: "0xABCDEF",
  assetSymbol: "ytest.usd",
  pricePerCall: "0.1",
  network: "yellow:sandbox",
  maxTimeoutSeconds: 60
};

describe("x402 payment helpers", () => {
  it("builds PaymentRequired with yellow extension", () => {
    const required = buildPaymentRequired(config, "https://example.test/tools", "Test tool");
    expect(required.x402Version).toBe(2);
    expect(required.accepts[0].scheme).toBe("yellow-offchain");
    expect(required.extensions?.yellow?.info?.clearnodeUrl).toBe(config.clearnodeUrl);
    expect(required.extensions?.yellow?.info?.asset).toBe(config.assetSymbol);
  });

  it("validates a matching payment payload", () => {
    const payload = {
      x402Version: 2,
      accepted: {
        scheme: "yellow-offchain",
        network: config.network,
        amount: config.pricePerCall,
        asset: config.assetSymbol,
        payTo: config.merchantAddress,
        maxTimeoutSeconds: config.maxTimeoutSeconds,
        extra: { settlement: "yellow" }
      },
      payload: {
        transferId: "123",
        payer: "0xPayer",
        amount: "0.1",
        asset: config.assetSymbol,
        to: config.merchantAddress
      }
    };

    const result = validateYellowPayment(payload as never, config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.info.transferId).toBe("123");
    }
  });

  it("rejects insufficient payment amount", () => {
    const payload = {
      x402Version: 2,
      accepted: {
        scheme: "yellow-offchain",
        network: config.network,
        amount: config.pricePerCall,
        asset: config.assetSymbol,
        payTo: config.merchantAddress,
        maxTimeoutSeconds: config.maxTimeoutSeconds,
        extra: { settlement: "yellow" }
      },
      payload: {
        transferId: "123",
        payer: "0xPayer",
        amount: "0.01",
        asset: config.assetSymbol,
        to: config.merchantAddress
      }
    };

    const result = validateYellowPayment(payload as never, config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("insufficient_amount");
    }
  });

  it("builds settlement response for success and failure", () => {
    const ok = buildSettlementResponse(true, "yellow:sandbox", "0xPayer", "tx123");
    expect(ok.success).toBe(true);
    expect(ok.transaction).toBe("tx123");

    const fail = buildSettlementResponse(false, "yellow:sandbox", "0xPayer", undefined, "bad");
    expect(fail.success).toBe(false);
    expect(fail.errorReason).toBe("bad");
  });
});
