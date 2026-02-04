/**
 * SIWx (Sign-In-With-X) extension for x402 v2
 * CAIP-122 compliant wallet authentication for AI agents
 */

// Types
export type {
  SIWxExtensionInfo,
  SIWxExtension,
  SIWxPayload,
  CompleteSIWxInfo,
  SupportedChain,
  SignatureType,
  SIWxValidationResult,
  SIWxVerifyResult,
} from './types.js';

export { SIGN_IN_WITH_X, SIWxPayloadSchema } from './types.js';

// Message formatting
export { formatSIWEMessage, extractEVMChainId } from './format.js';

// Verification
export { validateSIWxMessage, verifySIWxSignature, validateAndVerifySIWx } from './verify.js';

// Client utilities
export { createSIWxPayload, encodeSIWxHeader, parseSIWxHeader } from './client.js';

// Storage
export { SIWxSessionStorage, siwxStorage } from './storage.js';
