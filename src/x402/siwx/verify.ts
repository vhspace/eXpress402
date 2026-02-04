/**
 * SIWx signature verification
 * Validates message fields and verifies cryptographic signatures
 */

import { verifyMessage } from 'viem';
import { formatSIWEMessage } from './format.js';
import type { SIWxPayload, SIWxValidationResult, SIWxVerifyResult } from './types.js';

/**
 * Validate SIWX message fields (temporal bounds, domain, etc.)
 * Does NOT verify signature - only checks message validity
 *
 * @param payload - Client proof payload from SIGN-IN-WITH-X header
 * @param expectedResourceUri - Expected resource URI from request
 * @param options - Validation options
 * @returns Validation result
 */
export function validateSIWxMessage(
  payload: SIWxPayload,
  expectedResourceUri: string,
  options: { maxAge?: number; checkNonce?: (nonce: string) => boolean | Promise<boolean> } = {},
): SIWxValidationResult {
  const now = Date.now();
  const maxAge = options.maxAge ?? 300000; // 5 minutes default

  // Validate URI matches
  if (payload.uri !== expectedResourceUri) {
    return {
      valid: false,
      error: `URI mismatch: expected ${expectedResourceUri}, got ${payload.uri}`,
    };
  }

  // Validate issuedAt
  const issuedAt = new Date(payload.issuedAt).getTime();
  if (Number.isNaN(issuedAt)) {
    return { valid: false, error: 'Invalid issuedAt format' };
  }
  if (issuedAt > now) {
    return { valid: false, error: 'issuedAt is in the future' };
  }
  if (now - issuedAt > maxAge) {
    return { valid: false, error: 'Message too old' };
  }

  // Validate expirationTime if present
  if (payload.expirationTime) {
    const expiry = new Date(payload.expirationTime).getTime();
    if (Number.isNaN(expiry)) {
      return { valid: false, error: 'Invalid expirationTime format' };
    }
    if (expiry < now) {
      return { valid: false, error: 'Message expired' };
    }
  }

  // Validate notBefore if present
  if (payload.notBefore) {
    const notBefore = new Date(payload.notBefore).getTime();
    if (Number.isNaN(notBefore)) {
      return { valid: false, error: 'Invalid notBefore format' };
    }
    if (notBefore > now) {
      return { valid: false, error: 'Message not yet valid' };
    }
  }

  return { valid: true };
}

/**
 * Verify SIWX signature for EVM chains (EIP-191 EOA wallets)
 *
 * Reconstructs the SIWE message and verifies the signature matches
 * the claimed address using ECDSA recovery.
 *
 * @param payload - Client proof payload with signature
 * @returns Verification result with recovered address
 *
 * @example
 * const result = await verifySIWxSignature(payload);
 * if (result.valid) {
 *   console.log('Verified address:', result.address);
 * }
 */
export async function verifySIWxSignature(payload: SIWxPayload): Promise<SIWxVerifyResult> {
  try {
    // Only support EVM for now (Base network)
    if (!payload.chainId.startsWith('eip155:')) {
      return {
        valid: false,
        error: `Unsupported chain: ${payload.chainId}. Only EVM (eip155:*) supported.`,
      };
    }

    // Reconstruct the message that was signed
    const message = formatSIWEMessage(
      {
        ...payload,
        type: payload.type,
      },
      payload.address,
    );

    // Verify signature (EIP-191 for EOA)
    const valid = await verifyMessage({
      address: payload.address as `0x${string}`,
      message,
      signature: payload.signature as `0x${string}`,
    });

    if (valid) {
      return {
        valid: true,
        address: payload.address,
      };
    }

    return {
      valid: false,
      error: 'Invalid signature',
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Verification failed',
    };
  }
}

/**
 * Complete validation and verification of SIWx payload
 * Combines message validation and signature verification
 *
 * @param payload - Client proof payload
 * @param expectedResourceUri - Expected resource URI
 * @param checkNonce - Optional nonce validation function
 * @returns Verification result
 */
export async function validateAndVerifySIWx(
  payload: SIWxPayload,
  expectedResourceUri: string,
  checkNonce?: (nonce: string) => Promise<boolean>,
): Promise<SIWxVerifyResult> {
  // First validate message fields
  const validation = validateSIWxMessage(payload, expectedResourceUri);
  if (!validation.valid) {
    return {
      valid: false,
      error: validation.error,
    };
  }

  // Check nonce if validator provided
  if (checkNonce) {
    const nonceValid = await checkNonce(payload.nonce);
    if (!nonceValid) {
      return {
        valid: false,
        error: 'Nonce replay detected or invalid',
      };
    }
  }

  // Verify signature
  return verifySIWxSignature(payload);
}
