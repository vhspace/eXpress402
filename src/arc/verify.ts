import { createPublicClient, decodeEventLog, http, parseUnits } from 'viem';
import type { Hash } from 'viem';
import { getArcConfig, arcTestnetChain } from './config.js';

const gatewayMinterAbi = [
  {
    type: 'event',
    name: 'AttestationUsed',
    inputs: [
      { indexed: true, name: 'token', type: 'address' },
      { indexed: true, name: 'recipient', type: 'address' },
      { indexed: true, name: 'transferSpecHash', type: 'bytes32' },
      { indexed: false, name: 'sourceDomain', type: 'uint32' },
      { indexed: false, name: 'sourceDepositor', type: 'bytes32' },
      { indexed: false, name: 'sourceSigner', type: 'bytes32' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
    anonymous: false,
  },
] as const;

export type ArcGatewayMintVerification =
  | {
      ok: true;
      txHash: string;
      transferSpecHash: `0x${string}`;
      recipient: `0x${string}`;
      token: `0x${string}`;
      value: bigint;
      sourceSigner?: `0x${string}`;
    }
  | { ok: false; reason: string };

function bytes32ToAddress(value: `0x${string}`): `0x${string}` | null {
  // Gateway encodes some addresses as bytes32. For EVM addresses, take the last 20 bytes.
  if (value.length !== 66) return null;
  return `0x${value.slice(26)}`;
}

export async function verifyArcGatewayMintPayment(args: {
  mintTxHash: string;
  merchantAddress: string;
  requiredAmountUsd: string;
  expectedPayerAddress?: string;
}): Promise<ArcGatewayMintVerification> {
  const cfg = getArcConfig();
  const publicClient = createPublicClient({
    chain: arcTestnetChain,
    transport: http(cfg.rpcUrl),
  });

  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: args.mintTxHash as Hash });
  } catch (error) {
    return {
      ok: false,
      reason: `tx_receipt_unavailable:${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (receipt.status !== 'success') {
    return { ok: false, reason: 'tx_failed' };
  }

  const to = receipt.to?.toLowerCase();
  if (to && to !== cfg.gatewayMinter.toLowerCase()) {
    return { ok: false, reason: 'tx_not_to_gateway_minter' };
  }

  const required = parseUnits(args.requiredAmountUsd, 6);
  const merchant = args.merchantAddress.toLowerCase();
  const expectedPayer = args.expectedPayerAddress?.toLowerCase();

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== cfg.gatewayMinter.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: gatewayMinterAbi,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName !== 'AttestationUsed') continue;
      const { token, recipient, transferSpecHash, value, sourceSigner } = decoded.args;

      if (recipient.toLowerCase() !== merchant) {
        continue;
      }

      if (token.toLowerCase() !== cfg.usdcAddress.toLowerCase()) {
        return { ok: false, reason: 'wrong_token' };
      }

      if (value < required) {
        return { ok: false, reason: 'insufficient_amount' };
      }

      const signerAddress = bytes32ToAddress(sourceSigner);
      if (expectedPayer && signerAddress && signerAddress.toLowerCase() !== expectedPayer) {
        return { ok: false, reason: 'payer_mismatch' };
      }

      return {
        ok: true,
        txHash: args.mintTxHash,
        transferSpecHash,
        recipient,
        token,
        value,
        sourceSigner: signerAddress ?? undefined,
      };
    } catch {
      // ignore non-matching logs
    }
  }

  return { ok: false, reason: 'missing_attestation_used' };
}
