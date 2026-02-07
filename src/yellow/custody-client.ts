import { createPublicClient, createWalletClient, http, type Hash } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { CUSTODY_ABI, CUSTODY_ADDRESS_SEPOLIA } from './custody-abi.js';

export type CustodyChannel = {
  participants: readonly [`0x${string}`, `0x${string}`];
  adjudicator: `0x${string}`;
  challenge: bigint;
  nonce: bigint;
};

export type CustodyAllocation = {
  destination: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
};

export type CustodyState = {
  intent: number;
  version: bigint;
  data: `0x${string}`;
  allocations: readonly CustodyAllocation[];
  sigs: readonly `0x${string}`[];
};

export class CustodyClient {
  private walletClient;
  private publicClient;
  private account;

  constructor(privateKey: `0x${string}`) {
    this.account = privateKeyToAccount(privateKey);

    this.walletClient = createWalletClient({
      account: this.account,
      chain: sepolia,
      transport: http(),
    });

    this.publicClient = createPublicClient({
      chain: sepolia,
      transport: http(),
    });
  }

  /**
   * Deposit funds into custody ledger balance
   */
  async deposit(token: `0x${string}`, amount: bigint): Promise<Hash> {
    const hash = await this.walletClient.writeContract({
      address: CUSTODY_ADDRESS_SEPOLIA,
      abi: CUSTODY_ABI,
      functionName: 'deposit',
      args: [this.account.address, token, amount],
      value: token === '0x0000000000000000000000000000000000000000' ? amount : 0n,
    });

    console.log('   Waiting for deposit transaction confirmation...');
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });

    if (receipt.status !== 'success') {
      throw new Error(`Deposit failed: ${receipt.status}`);
    }

    return receipt.transactionHash;
  }

  /**
   * Create a channel on-chain by submitting the signed channel configuration
   */
  async create(channel: CustodyChannel, state: CustodyState): Promise<Hash> {
    const hash = await this.walletClient.writeContract({
      address: CUSTODY_ADDRESS_SEPOLIA,
      abi: CUSTODY_ABI,
      functionName: 'create',
      args: [channel, state],
    });

    console.log('   Waiting for create transaction confirmation...');
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });

    if (receipt.status !== 'success') {
      throw new Error(`Channel creation failed: ${receipt.status}`);
    }

    return receipt.transactionHash;
  }

  /**
   * Resize a channel by adjusting allocations (deposit or withdraw)
   */
  async resize(
    channelId: `0x${string}`,
    state: CustodyState,
    proofs: readonly CustodyState[],
  ): Promise<Hash> {
    const hash = await this.walletClient.writeContract({
      address: CUSTODY_ADDRESS_SEPOLIA,
      abi: CUSTODY_ABI,
      functionName: 'resize',
      args: [channelId, state, proofs],
    });

    console.log('   Waiting for resize transaction confirmation...');
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });

    if (receipt.status !== 'success') {
      throw new Error(`Channel resize failed: ${receipt.status}`);
    }

    return receipt.transactionHash;
  }

  /**
   * Close a channel cooperatively with final state
   */
  async close(channelId: `0x${string}`, state: CustodyState): Promise<Hash> {
    const hash = await this.walletClient.writeContract({
      address: CUSTODY_ADDRESS_SEPOLIA,
      abi: CUSTODY_ABI,
      functionName: 'close',
      args: [channelId, state, []],
    });

    console.log('   Waiting for close transaction confirmation...');
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });

    if (receipt.status !== 'success') {
      throw new Error(`Channel close failed: ${receipt.status}`);
    }

    return receipt.transactionHash;
  }

  /**
   * Withdraw funds from custody ledger to wallet
   */
  async withdraw(token: `0x${string}`, amount: bigint): Promise<Hash> {
    const hash = await this.walletClient.writeContract({
      address: CUSTODY_ADDRESS_SEPOLIA,
      abi: CUSTODY_ABI,
      functionName: 'withdraw',
      args: [token, amount],
    });

    console.log('   Waiting for withdrawal transaction confirmation...');
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });

    if (receipt.status !== 'success') {
      throw new Error(`Withdrawal failed: ${receipt.status}`);
    }

    return receipt.transactionHash;
  }

  /**
   * Get the merchant's wallet address
   */
  getAddress(): `0x${string}` {
    return this.account.address;
  }
}

/**
 * Convert Yellow Network response data to Custody contract format
 */
export function convertYellowChannelToCustody(yellowChannel: {
  participants: string[];
  adjudicator: string;
  challenge: number;
  nonce: number;
}): CustodyChannel {
  return {
    participants: [
      yellowChannel.participants[0] as `0x${string}`,
      yellowChannel.participants[1] as `0x${string}`,
    ],
    adjudicator: yellowChannel.adjudicator as `0x${string}`,
    challenge: BigInt(yellowChannel.challenge),
    nonce: BigInt(yellowChannel.nonce),
  };
}

export function convertYellowStateToCustody(
  yellowState: {
    intent: number;
    version: number;
    state_data: string;
    allocations: Array<{
      participant?: string;
      destination?: string;
      token: string;
      amount: string;
    }>;
  },
  signatures: string[],
): CustodyState {
  return {
    intent: yellowState.intent,
    version: BigInt(yellowState.version),
    data: (yellowState.state_data || '0x') as `0x${string}`,
    allocations: yellowState.allocations.map(a => ({
      destination: (a.destination || a.participant) as `0x${string}`,
      token: a.token as `0x${string}`,
      amount: BigInt(a.amount),
    })),
    sigs: signatures.map(s => s as `0x${string}`),
  };
}
