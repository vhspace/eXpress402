export type PaymentResource = {
  url: string;
  description?: string;
  mimeType?: string;
};

export type PaymentRequirements = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
};

export type X402ExtensionInfo = {
  info: Record<string, unknown>;
  schema: Record<string, unknown>;
};

export type PaymentRequired = {
  x402Version: 2;
  error?: string;
  resource: PaymentResource;
  accepts: PaymentRequirements[];
  extensions?: Record<string, X402ExtensionInfo>;
};

export type PaymentPayload = {
  x402Version: 2;
  resource?: PaymentResource;
  accepted: PaymentRequirements;
  payload: Record<string, unknown>;
  extensions?: Record<string, X402ExtensionInfo>;
};

export type SettlementResponse = {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  errorReason?: string;
  extensions?: Record<string, X402ExtensionInfo>;
};
