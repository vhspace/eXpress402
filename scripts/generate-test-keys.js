#!/usr/bin/env node

// Generate ephemeral test keys for Yellow sandbox testing
import crypto from 'crypto';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { getPublicKey } from '@noble/secp256k1';

// Generate agent private key (for client operations)
const agentPrivKeyBytes = crypto.randomBytes(32);
const agentPrivKey = '0x' + agentPrivKeyBytes.toString('hex');

// Generate merchant private key and derive address (for server operations)
const merchantPrivKeyBytes = crypto.randomBytes(32);
const merchantPrivKey = '0x' + merchantPrivKeyBytes.toString('hex');

const merchantPubKey = getPublicKey(merchantPrivKeyBytes, false); // uncompressed
const merchantHash = keccak_256(merchantPubKey.slice(1)); // Remove 0x04 prefix
const merchantAddressBytes = merchantHash.slice(-20); // Take last 20 bytes
const merchantAddress = '0x' + Array.from(merchantAddressBytes, byte => byte.toString(16).padStart(2, '0')).join('');

console.log(`YELLOW_AGENT_PRIVATE_KEY=${agentPrivKey}`);
console.log(`YELLOW_MERCHANT_PRIVATE_KEY=${merchantPrivKey}`);
console.log(`YELLOW_MERCHANT_ADDRESS=${merchantAddress}`);