/**
 * SIWE (Sign-In-With-Ethereum) message formatting for EVM chains
 * Implements EIP-4361 compliant message format
 */

import { SiweMessage } from 'siwe';
import type { CompleteSIWxInfo } from './types.js';

/**
 * Extract numeric chain ID from CAIP-2 EVM chainId
 *
 * @param chainId - CAIP-2 format (e.g., "eip155:8453")
 * @returns Numeric chain ID (e.g., 8453)
 *
 * @example
 * extractEVMChainId("eip155:8453") // 8453 (Base)
 * extractEVMChainId("eip155:1")    // 1 (Ethereum)
 */
export function extractEVMChainId(chainId: string): number {
  const match = /^eip155:(\d+)$/.exec(chainId);
  if (!match) {
    throw new Error(`Invalid EVM chainId format: ${chainId}. Expected eip155:<number>`);
  }
  return parseInt(match[1], 10);
}

/**
 * Format SIWE message following EIP-4361 specification
 *
 * Uses siwe library to ensure spec compliance and proper formatting.
 *
 * @param info - Server-provided extension info with chain selected
 * @param address - Client's EVM wallet address
 * @returns EIP-4361 formatted message ready for signing
 *
 * @example
 * const message = formatSIWEMessage(serverInfo, "0x1234...");
 * // Returns:
 * // "api.example.com wants you to sign in with your Ethereum account:
 * // 0x1234...
 * //
 * // Sign in to access premium data
 * //
 * // URI: https://api.example.com/data
 * // Version: 1
 * // Chain ID: 8453
 * // Nonce: abc123def456
 * // Issued At: 2024-01-15T10:30:00.000Z"
 */
export function formatSIWEMessage(info: CompleteSIWxInfo, address: string): string {
  const numericChainId = extractEVMChainId(info.chainId);

  const siweMessage = new SiweMessage({
    domain: info.domain,
    address,
    statement: info.statement,
    uri: info.uri,
    version: info.version,
    chainId: numericChainId,
    nonce: info.nonce,
    issuedAt: info.issuedAt,
    expirationTime: info.expirationTime,
    notBefore: info.notBefore,
    requestId: info.requestId,
    resources: info.resources,
  });

  return siweMessage.prepareMessage();
}
