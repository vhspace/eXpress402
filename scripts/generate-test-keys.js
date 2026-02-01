#!/usr/bin/env node

// Generate ephemeral test keys for Yellow sandbox testing
import crypto from 'crypto';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { getPublicKey } from '@noble/secp256k1';

// Generate a random 32-byte private key
const privKeyBytes = crypto.randomBytes(32);
const privKey = '0x' + privKeyBytes.toString('hex');

// Derive Ethereum address from private key
const pubKey = getPublicKey(privKeyBytes, false); // uncompressed, no 0x04 prefix
const hash = keccak_256(pubKey.slice(1)); // Remove 0x04 prefix if present
const addressBytes = hash.slice(-20); // Take last 20 bytes
const address = '0x' + Array.from(addressBytes, byte => byte.toString(16).padStart(2, '0')).join('');

console.log(`YELLOW_AGENT_PRIVATE_KEY=${privKey}`);
console.log(`YELLOW_MERCHANT_ADDRESS=${address}`);