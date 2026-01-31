import stableStringify from "json-stable-stringify";
import { keccak_256 } from "@noble/hashes/sha3";
import { hexToBytes, bytesToHex, concatBytes } from "@noble/hashes/utils";
import { getPublicKey, sign, Signature, etc } from "@noble/secp256k1";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";

const encoder = new TextEncoder();
if (!etc.hmacSha256Sync) {
  etc.hmacSha256Sync = (key, ...msgs) => hmac(sha256, key, concatBytes(...msgs));
}

export function encodeCanonicalJson(value: unknown): Uint8Array {
  const json = stableStringify(value);
  return encoder.encode(json);
}

export function hashPayload(payload: unknown): Uint8Array {
  const bytes = encodeCanonicalJson(payload);
  return keccak_256(bytes);
}

export async function signPayload(payload: unknown, privateKeyHex: string): Promise<string> {
  const key = normalizeHex(privateKeyHex);
  const hash = hashPayload(payload);
  const sig = sign(hash, key);
  const recovery = findRecovery(sig, hash, key);
  const sigBytes = sig.toBytes();
  const signature = new Uint8Array(sigBytes.length + 1);
  signature.set(sigBytes, 0);
  signature[sigBytes.length] = 27 + recovery;
  return `0x${bytesToHex(signature)}`;
}

function findRecovery(signature: Signature, hash: Uint8Array, privateKey: Uint8Array): number {
  const pubKey = getPublicKey(privateKey, false);
  for (let recovery = 0; recovery <= 3; recovery += 1) {
    const recovered = signature.addRecoveryBit(recovery).recoverPublicKey(hash).toBytes(false);
    if (bytesEqual(recovered, pubKey)) {
      return recovery;
    }
  }
  throw new Error("Failed to derive recovery bit for signature");
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function normalizeHex(value: string): Uint8Array {
  const trimmed = value.startsWith("0x") ? value.slice(2) : value;
  return hexToBytes(trimmed);
}
