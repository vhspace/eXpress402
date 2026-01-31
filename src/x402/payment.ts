import { PaymentPayload, PaymentRequired, PaymentRequirements, SettlementResponse } from "./types.js";

export type YellowPaymentConfig = {
  clearnodeUrl: string;
  merchantAddress: string;
  assetSymbol: string;
  pricePerCall: string;
  network: string;
  maxTimeoutSeconds: number;
};

const yellowExtensionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    clearnodeUrl: { type: "string" },
    protocolVersion: { type: "string" },
    asset: { type: "string" },
    pricePerCall: { type: "string" },
    transferId: { type: ["number", "string"] },
    payer: { type: "string" }
  },
  required: ["clearnodeUrl", "protocolVersion", "asset", "pricePerCall"],
  additionalProperties: true
};

export function buildPaymentRequired(
  config: YellowPaymentConfig,
  resourceUrl: string,
  description: string
): PaymentRequired {
  const requirement: PaymentRequirements = {
    scheme: "yellow-offchain",
    network: config.network,
    amount: config.pricePerCall,
    asset: config.assetSymbol,
    payTo: config.merchantAddress,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    extra: {
      settlement: "yellow"
    }
  };

  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: resourceUrl,
      description,
      mimeType: "application/json"
    },
    accepts: [requirement],
    extensions: {
      yellow: {
        info: {
          clearnodeUrl: config.clearnodeUrl,
          protocolVersion: "NitroRPC/0.4",
          asset: config.assetSymbol,
          pricePerCall: config.pricePerCall
        },
        schema: yellowExtensionSchema
      }
    }
  };
}

export function validateYellowPayment(
  payload: PaymentPayload,
  config: YellowPaymentConfig
): { ok: true; info: YellowReceipt } | { ok: false; reason: string } {
  if (!payload || payload.x402Version !== 2) {
    return { ok: false, reason: "invalid_x402_version" };
  }

  if (!payload.accepted) {
    return { ok: false, reason: "missing_payment_requirements" };
  }

  if (payload.accepted.scheme !== "yellow-offchain") {
    return { ok: false, reason: "unsupported_scheme" };
  }

  if (payload.accepted.network !== config.network) {
    return { ok: false, reason: "invalid_network" };
  }

  if (payload.accepted.asset !== config.assetSymbol) {
    return { ok: false, reason: "invalid_asset" };
  }

  if (payload.accepted.payTo.toLowerCase() !== config.merchantAddress.toLowerCase()) {
    return { ok: false, reason: "invalid_payto" };
  }

  const receipt = payload.payload as Partial<YellowReceipt>;
  if (!receipt || !receipt.transferId || !receipt.payer || !receipt.amount) {
    return { ok: false, reason: "missing_receipt_fields" };
  }

  const paid = Number(receipt.amount);
  const required = Number(config.pricePerCall);
  if (Number.isNaN(paid) || paid < required) {
    return { ok: false, reason: "insufficient_amount" };
  }

  return { ok: true, info: receipt as YellowReceipt };
}

export type YellowReceipt = {
  transferId: string | number;
  payer: string;
  amount: string;
  asset: string;
  to: string;
};

export function buildSettlementResponse(
  ok: boolean,
  network: string,
  payer?: string,
  transaction?: string,
  reason?: string
): SettlementResponse {
  if (ok) {
    return {
      success: true,
      transaction: transaction ?? "",
      network,
      payer
    };
  }

  return {
    success: false,
    transaction: "",
    network,
    payer,
    errorReason: reason ?? "payment_failed"
  };
}
