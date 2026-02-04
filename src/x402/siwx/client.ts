/**
 * Client-side utilities for SIWx authentication
 * For AI agents using EOA wallets with private keys
 */

import type { Account } from 'viem';
import { formatSIWEMessage } from './format.js';
import type { CompleteSIWxInfo, SIWxPayload } from './types.js';

/**
 * Create complete SIWx payload with signature
 *
 * For AI agents: Pass viem account (from privateKeyToAccount)
 *
 * @param serverInfo - Server extension info with chain selected
 * @param wallet - Viem account (EOA wallet)
 * @returns Complete SIWx payload ready to send
 *
 * @example
 * ```typescript
 * import { privateKeyToAccount } from 'viem/accounts';
 *
 * const wallet = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
 * const payload = await createSIWxPayload(serverInfo, wallet);
 * ```
 */
export async function createSIWxPayload(
  serverInfo: CompleteSIWxInfo,
  wallet: Account,
): Promise<SIWxPayload> {
  // Format SIWE message per EIP-4361
  const message = formatSIWEMessage(serverInfo, wallet.address);

  // Sign message with wallet
  if (!wallet.signMessage) {
    throw new Error('Wallet does not support message signing');
  }
  const signature = await wallet.signMessage({ message });

  // Return complete payload
  return {
    domain: serverInfo.domain,
    address: wallet.address,
    statement: serverInfo.statement,
    uri: serverInfo.uri,
    version: serverInfo.version,
    chainId: serverInfo.chainId,
    type: serverInfo.type,
    nonce: serverInfo.nonce,
    issuedAt: serverInfo.issuedAt,
    expirationTime: serverInfo.expirationTime,
    notBefore: serverInfo.notBefore,
    requestId: serverInfo.requestId,
    resources: serverInfo.resources,
    signature,
  };
}

/**
 * Encode SIWx payload for SIGN-IN-WITH-X HTTP header
 *
 * @param payload - Complete SIWx payload with signature
 * @returns Base64-encoded JSON string
 */
export function encodeSIWxHeader(payload: SIWxPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json).toString('base64');
}

/**
 * Parse SIGN-IN-WITH-X header value
 *
 * @param headerValue - Base64-encoded SIWx payload
 * @returns Parsed SIWx payload
 */
export function parseSIWxHeader(headerValue: string): SIWxPayload {
  const json = Buffer.from(headerValue, 'base64').toString('utf-8');
  return JSON.parse(json) as SIWxPayload;
}
