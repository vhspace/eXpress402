/**
 * Custody Contract ABI for Nitrolite State Channels
 *
 * Contract: Custody.sol
 * Address (Sepolia): 0x019B65A265EB3363822f2752141b3dF16131b262
 * Source: https://github.com/erc7824/nitrolite/blob/main/contract/src/Custody.sol
 */

export const CUSTODY_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'create',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'ch',
        type: 'tuple',
        components: [
          { name: 'participants', type: 'address[]' },
          { name: 'adjudicator', type: 'address' },
          { name: 'challenge', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
      {
        name: 'initial',
        type: 'tuple',
        components: [
          { name: 'intent', type: 'uint8' },
          { name: 'version', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          {
            name: 'allocations',
            type: 'tuple[]',
            components: [
              { name: 'destination', type: 'address' },
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
          },
          { name: 'sigs', type: 'bytes[]' },
        ],
      },
    ],
    outputs: [{ name: 'channelId', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'resize',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      {
        name: 'candidate',
        type: 'tuple',
        components: [
          { name: 'intent', type: 'uint8' },
          { name: 'version', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          {
            name: 'allocations',
            type: 'tuple[]',
            components: [
              { name: 'destination', type: 'address' },
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
          },
          { name: 'sigs', type: 'bytes[]' },
        ],
      },
      {
        name: 'proofs',
        type: 'tuple[]',
        components: [
          { name: 'intent', type: 'uint8' },
          { name: 'version', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          {
            name: 'allocations',
            type: 'tuple[]',
            components: [
              { name: 'destination', type: 'address' },
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
          },
          { name: 'sigs', type: 'bytes[]' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'close',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      {
        name: 'candidate',
        type: 'tuple',
        components: [
          { name: 'intent', type: 'uint8' },
          { name: 'version', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          {
            name: 'allocations',
            type: 'tuple[]',
            components: [
              { name: 'destination', type: 'address' },
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
          },
          { name: 'sigs', type: 'bytes[]' },
        ],
      },
      {
        name: 'proofs',
        type: 'tuple[]',
        components: [
          { name: 'intent', type: 'uint8' },
          { name: 'version', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          {
            name: 'allocations',
            type: 'tuple[]',
            components: [
              { name: 'destination', type: 'address' },
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
          },
          { name: 'sigs', type: 'bytes[]' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Created',
    inputs: [
      { name: 'channelId', type: 'bytes32', indexed: true },
      { name: 'wallet', type: 'address', indexed: true },
      { name: 'ch', type: 'tuple', indexed: false },
      { name: 'initial', type: 'tuple', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Opened',
    inputs: [{ name: 'channelId', type: 'bytes32', indexed: true }],
  },
  {
    type: 'event',
    name: 'Resized',
    inputs: [
      { name: 'channelId', type: 'bytes32', indexed: true },
      { name: 'resizeAmounts', type: 'int256[]', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Closed',
    inputs: [
      { name: 'channelId', type: 'bytes32', indexed: true },
      { name: 'candidate', type: 'tuple', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdrawn',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const CUSTODY_ADDRESS_SEPOLIA = '0x019B65A265EB3363822f2752141b3dF16131b262' as const;
