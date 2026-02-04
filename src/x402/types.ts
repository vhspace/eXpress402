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

/**
 * SIWx extension info for wallet authentication
 * Part of x402 v2 extensions system
 */
export type SIWxExtensionInfo = {
  domain: string;
  uri: string;
  version: string;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
  statement?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
};

/**
 * SIWx payload sent by client in SIGN-IN-WITH-X header
 */
export type SIWxPayload = SIWxExtensionInfo & {
  address: string;
  chainId: string;
  type: 'eip191' | 'ed25519';
  signature: string;
};

export type PaymentRequired = {
  x402Version: 2;
  error?: string;
  resource: PaymentResource;
  accepts: PaymentRequirements[];
  extensions?: Record<string, any>;
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
