/**
 * Type definitions for Sign-In-With-X (SIWx) extension
 * Implements CAIP-122 standard for wallet-based authentication
 * Focus: EVM chains (Base) for x402 v2 + Yellow Network integration
 */

import { z } from 'zod';

export const SIGN_IN_WITH_X = 'sign-in-with-x';

/**
 * Signature type per CAIP-122
 * This project focuses on EIP-191 for EOA wallets
 */
export type SignatureType = 'eip191' | 'ed25519';

/**
 * Supported chain configuration
 */
export interface SupportedChain {
  /** CAIP-2 chain identifier (e.g., "eip155:8453" for Base) */
  chainId: string;
  /** Signature algorithm type */
  type: SignatureType;
}

/**
 * Server-declared extension info in PaymentRequired response
 * Contains message metadata for CAIP-122 challenge
 */
export interface SIWxExtensionInfo {
  /** Server's domain */
  domain: string;
  /** Full resource URI being accessed */
  uri: string;
  /** CAIP-122 version (always "1") */
  version: string;
  /** Cryptographic nonce (32 hex chars) */
  nonce: string;
  /** ISO 8601 timestamp when challenge created */
  issuedAt: string;
  /** Optional human-readable purpose */
  statement?: string;
  /** Optional expiry timestamp */
  expirationTime?: string;
  /** Optional validity start */
  notBefore?: string;
  /** Optional correlation ID */
  requestId?: string;
  /** Associated resource URIs */
  resources?: string[];
}

/**
 * Complete SIWX extension in PaymentRequired.extensions
 */
export interface SIWxExtension {
  info: SIWxExtensionInfo;
  supportedChains: SupportedChain[];
  schema: Record<string, unknown>;
}

/**
 * Zod schema for client payload validation
 */
export const SIWxPayloadSchema = z.object({
  domain: z.string(),
  address: z.string(),
  statement: z.string().optional(),
  uri: z.string(),
  version: z.string(),
  chainId: z.string(),
  type: z.enum(['eip191', 'ed25519']),
  nonce: z.string(),
  issuedAt: z.string(),
  expirationTime: z.string().optional(),
  notBefore: z.string().optional(),
  requestId: z.string().optional(),
  resources: z.array(z.string()).optional(),
  signature: z.string(),
});

/**
 * Client proof payload sent in SIGN-IN-WITH-X header
 * Contains all server fields plus address and signature
 */
export type SIWxPayload = z.infer<typeof SIWxPayloadSchema>;

/**
 * Complete SIWx info with chain selected (used during signing)
 */
export type CompleteSIWxInfo = SIWxExtensionInfo & {
  chainId: string;
  type: SignatureType;
};

/**
 * Validation result
 */
export interface SIWxValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Verification result with recovered address
 */
export interface SIWxVerifyResult {
  valid: boolean;
  address?: string;
  error?: string;
}
