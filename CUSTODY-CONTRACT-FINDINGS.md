# Custody Contract Findings from Yellow Network GitHub

## Discovery Summary

Found the complete Custody contract implementation and deployment details for completing the merchant offramp functionality.

## Contract Details

### Custody Contract on Sepolia

**Contract Address:** `0x019B65A265EB3363822f2752141b3dF16131b262`
**Chain ID:** 11155111 (Sepolia)
**Version:** v0.3.0 (SANDBOX)
**Deployed:** 2025-08-27
**Etherscan:** https://sepolia.etherscan.io/address/0x019B65A265EB3363822f2752141b3dF16131b262

**Source Repository:** https://github.com/erc7824/nitrolite
**Contract Source:** https://github.com/erc7824/nitrolite/blob/main/contract/src/Custody.sol
**Deployment Info:** https://github.com/erc7824/nitrolite/blob/main/contract/deployments/11155111/Custody.sol:Custody/2025-08-27T12:18:02.json

## Key Functions for Offramp

Based on the Custody.sol source code, here are the functions needed:

### 1. create() - Create Channel

```solidity
function create(
    Channel calldata ch,
    State calldata initial
) public returns (bytes32 channelId)
```

**Parameters:**
- `ch`: Channel configuration (participants, adjudicator, challenge, nonce)
- `initial`: Initial state with StateIntent.INITIALIZE and allocations

**What it does:**
- Creates channel on-chain
- Locks funds from creator's ledger balance
- Returns channelId
- Emits `Created` event

**Our Implementation Needs:**
```typescript
// After calling yellowClient.createChannel()
const txHash = await custodyContract.create(
  createResponse.channel,
  createResponse.state
);
```

### 2. resize() - Move Funds Between Ledger and Channel

```solidity
function resize(
    bytes32 channelId,
    State calldata candidate,
    State[] calldata proofs
) external
```

**Parameters:**
- `channelId`: Channel identifier
- `candidate`: Resize state with StateIntent.RESIZE and delta amounts
- `proofs`: Supporting states for adjudication

**What it does:**
- Processes positive deltas: locks ledger funds to channel
- Processes negative deltas: unlocks channel funds to ledger
- Updates channel allocations
- Emits `Resized` event with delta amounts

**Our Implementation Needs:**
```typescript
// After calling yellowClient.resizeChannel()
const txHash = await custodyContract.resize(
  channelId,
  resizeResponse.state,
  [precedingState] // proofs array
);
```

### 3. close() - Finalize Channel

```solidity
function close(
    bytes32 channelId,
    State calldata candidate,
    State[] calldata
) public
```

**Parameters:**
- `channelId`: Channel identifier
- `candidate`: Final state with StateIntent.FINALIZE
- `proofs`: Empty array for cooperative close (not used)

**What it does:**
- Verifies all signatures on final state
- Unlocks allocations back to ledger balances
- Deletes channel from storage
- Emits `Closed` event

**Our Implementation Needs:**
```typescript
// After calling yellowClient.closeChannel()
const txHash = await custodyContract.close(
  channelId,
  closeResponse.state,
  [] // empty proofs for cooperative close
);
```

### 4. withdraw() - Move Ledger Balance to Wallet

```solidity
function withdraw(
    address token,
    uint256 amount
) external
```

**Parameters:**
- `token`: Token address (or address(0) for ETH)
- `amount`: Amount to withdraw

**What it does:**
- Withdraws available (not locked in channels) funds
- Transfers tokens from contract to msg.sender
- Emits `Withdrawn` event

**Our Implementation Needs:**
```typescript
// After channel close, funds are in ledger balance
const txHash = await custodyContract.withdraw(
  tokenAddress,
  amount
);
```

## Complete Offramp Flow with Custody Contract

```
STEP 1: Check Unified Balance (Yellow Network RPC)
   ↓ yellowClient.getLedgerBalances()
   ✓ Find: 36 ytest.usd in unified balance

STEP 2: Get Token Address (Yellow Network RPC)
   ↓ yellowClient.request('get_assets', {})
   ✓ Find: 0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb on Sepolia

STEP 3: Create Channel (Yellow RPC + Custody Contract)
   ↓ yellowClient.createChannel(chainId, token)
   ✓ Get: channel config + state + signature
   ↓ custodyContract.create(channel, state)
   ✓ TX: Channel created on-chain

STEP 4: Move Funds to Channel (Yellow RPC + Custody Contract)
   ↓ yellowClient.resizeChannel(channelId, +amount, -amount, dest)
   ✓ Get: resize state + signature
   ↓ custodyContract.resize(channelId, state, proofs)
   ✓ TX: Funds moved from unified balance to channel

STEP 5: Close Channel (Yellow RPC + Custody Contract)
   ↓ yellowClient.closeChannel(channelId, destination)
   ✓ Get: final state + signature
   ↓ custodyContract.close(channelId, state, [])
   ✓ TX: Channel closed, funds to ledger balance

STEP 6: Withdraw to Wallet (Custody Contract)
   ↓ custodyContract.withdraw(token, amount)
   ✓ TX: Funds transferred to merchant wallet
   ✓ Etherscan link: https://sepolia.etherscan.io/tx/0x...
```

## Implementation Requirements

### 1. Install viem (Already Installed)

```json
"dependencies": {
  "viem": "^2.45.1"  // ✓ Already in package.json
}
```

### 2. Get Custody Contract ABI

Extract from: https://github.com/erc7824/nitrolite/blob/main/contract/src/Custody.sol

Key functions needed:
- `create(Channel calldata ch, State calldata initial)`
- `resize(bytes32 channelId, State calldata candidate, State[] calldata proofs)`
- `close(bytes32 channelId, State calldata candidate, State[] calldata)`
- `withdraw(address token, uint256 amount)`

### 3. Create Contract Client

```typescript
import { createPublicClient, createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const CUSTODY_ADDRESS = '0x019B65A265EB3363822f2752141b3dF16131b262';
const CUSTODY_ABI = [
  // ABI extracted from contract
];

const walletClient = createWalletClient({
  account: privateKeyToAccount(merchantPrivateKey as `0x${string}`),
  chain: sepolia,
  transport: http()
});

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http()
});
```

### 4. Implement Smart Contract Calls

```typescript
async function submitChannelCreation(channelData, state) {
  const hash = await walletClient.writeContract({
    address: CUSTODY_ADDRESS,
    abi: CUSTODY_ABI,
    functionName: 'create',
    args: [channelData, state],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.transactionHash;
}

async function submitChannelResize(channelId, state, proofs) {
  const hash = await walletClient.writeContract({
    address: CUSTODY_ADDRESS,
    abi: CUSTODY_ABI,
    functionName: 'resize',
    args: [channelId, state, proofs],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.transactionHash;
}

async function submitChannelClose(channelId, state) {
  const hash = await walletClient.writeContract({
    address: CUSTODY_ADDRESS,
    abi: CUSTODY_ABI,
    functionName: 'close',
    args: [channelId, state, []],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.transactionHash;
}

async function withdrawFromCustody(token, amount) {
  const hash = await walletClient.writeContract({
    address: CUSTODY_ADDRESS,
    abi: CUSTODY_ABI,
    functionName: 'withdraw',
    args: [token, amount],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.transactionHash;
}
```

## Data Structure Mappings

### Channel Structure

From Custody.sol:
```solidity
struct Channel {
    address[] participants;  // [CLIENT, SERVER]
    address adjudicator;     // SimpleConsensus contract
    uint256 challenge;       // Challenge period in seconds
    uint256 nonce;          // Unique identifier
}
```

Maps to Yellow RPC response:
```typescript
createResponse.channel = {
  participants: ['0xClient...', '0xServer...'],
  adjudicator: '0xAdjudicator...',
  challenge: 3600,
  nonce: 1234567890
}
```

### State Structure

From Custody.sol:
```solidity
struct State {
    uint8 intent;           // INITIALIZE=1, OPERATE=0, RESIZE=2, FINALIZE=3
    uint256 version;        // State version number
    bytes data;            // Application-specific data
    Allocation[] allocations;  // Fund allocations
    bytes[] sigs;          // Signatures from participants
}
```

Maps to Yellow RPC response:
```typescript
createResponse.state = {
  intent: 1,  // INITIALIZE
  version: 0,
  state_data: '0x',
  allocations: [
    { participant: '0x...', token: '0x...', amount: '0' },
    { participant: '0x...', token: '0x...', amount: '0' }
  ]
}

// Need to add signatures:
state.sigs = [userSignature, clearnodeSignature]
```

### Allocation Structure

From Custody.sol:
```solidity
struct Allocation {
    address destination;    // Participant address
    address token;         // Token address
    uint256 amount;        // Amount in smallest units
}
```

## Gas Estimates

Based on Custody.sol implementation:

- `create()`: ~200,000 gas (includes storage, deposits, events)
- `resize()`: ~150,000 gas (updates allocations, moves funds)
- `close()`: ~100,000 gas (unlocks allocations, deletes storage)
- `withdraw()`: ~50,000 gas (simple transfer)

**Total for complete offramp:** ~500,000 gas

At current Sepolia gas prices (testnet): FREE (test ETH)
At mainnet gas prices (~20 gwei): ~0.01 ETH (~$25-30 USD)

## SimpleConsensus Adjudicator

**Contract:** https://github.com/erc7824/nitrolite/blob/main/contract/src/adjudicators/SimpleConsensus.sol
**Purpose:** Validates state transitions by checking quorum signatures

For payment channels:
- Participants: [Client, Server]
- Weights: [1, 1]
- Quorum: 2
- Both must sign every state transition

## Next Steps to Complete Implementation

### 1. Extract Custody ABI

Generate ABI from Custody.sol using forge or hardhat:

```bash
git clone https://github.com/erc7824/nitrolite.git
cd nitrolite/contract
forge build
# ABI will be in out/Custody.sol/Custody.json
```

### 2. Create Contract Client Module

Create `src/yellow/custody-client.ts`:

```typescript
import { createPublicClient, createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const CUSTODY_ADDRESS = '0x019B65A265EB3363822f2752141b3dF16131b262';

export class CustodyClient {
  constructor(privateKey: string) {
    this.walletClient = createWalletClient({
      account: privateKeyToAccount(privateKey as `0x${string}`),
      chain: sepolia,
      transport: http()
    });
    this.publicClient = createPublicClient({
      chain: sepolia,
      transport: http()
    });
  }

  async create(channel, state) { ... }
  async resize(channelId, state, proofs) { ... }
  async close(channelId, state) { ... }
  async withdraw(token, amount) { ... }
}
```

### 3. Update Offramp Script

Add smart contract interactions after each RPC call:

```typescript
// After Step 3: Create channel
const createTxHash = await custodyClient.create(
  createResponse.channel,
  { ...createResponse.state, sigs: [userSig, clearnodeSig] }
);
console.log(`Etherscan: https://sepolia.etherscan.io/tx/${createTxHash}`);

// After Step 4: Resize channel
const resizeTxHash = await custodyClient.resize(
  channelId,
  { ...resizeResponse.state, sigs: [userSig, clearnodeSig] },
  [precedingState]
);
console.log(`Etherscan: https://sepolia.etherscan.io/tx/${resizeTxHash}`);

// After Step 5: Close channel
const closeTxHash = await custodyClient.close(
  channelId,
  { ...closeResponse.state, sigs: [userSig, clearnodeSig] }
);
console.log(`Etherscan: https://sepolia.etherscan.io/tx/${closeTxHash}`);

// Step 6: Withdraw to wallet
const withdrawTxHash = await custodyClient.withdraw(tokenAddress, amount);
console.log(`Etherscan: https://sepolia.etherscan.io/tx/${withdrawTxHash}`);
```

## Expected Output After Full Implementation

```
=== Merchant On-Chain Offramp ===

Step 1/6: Checking unified balance...
SUCCESS: Unified balance: 36 ytest.usd
   Location: Yellow Network (off-chain)

Step 2/6: Looking up token address...
SUCCESS: Token found: 0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb
   Chain: Sepolia (11155111)

Step 3/6: Creating payment channel...
SUCCESS: Yellow RPC channel prepared
SUCCESS: Submitting to blockchain...
   TX: 0xabc123... (channel creation)
   Etherscan: https://sepolia.etherscan.io/tx/0xabc123...
SUCCESS: Channel created: 0x8f3c5d1a...

Step 4/6: Moving unified balance to channel...
SUCCESS: Yellow RPC resize prepared
SUCCESS: Submitting to blockchain...
   TX: 0xdef456... (resize operation)
   Etherscan: https://sepolia.etherscan.io/tx/0xdef456...
SUCCESS: Funds moved to channel

Step 5/6: Closing channel...
SUCCESS: Yellow RPC close prepared
SUCCESS: Submitting to blockchain...
   TX: 0x789ghi... (channel close)
   Etherscan: https://sepolia.etherscan.io/tx/0x789ghi...
SUCCESS: Channel closed, funds in custody ledger

Step 6/6: Withdrawing to wallet...
SUCCESS: Submitting to blockchain...
   TX: 0xjkl012... (withdrawal)
   Etherscan: https://sepolia.etherscan.io/tx/0xjkl012...
SUCCESS: Funds in wallet!

=== Offramp Summary ===
Amount: 36 ytest.usd
From: Yellow Network Unified Balance (off-chain)
To: 0x9126d073e0a5e45D907feA0b4f4857F5b7191430 (Sepolia wallet)

ON-CHAIN TRANSACTIONS:
  1. Create: https://sepolia.etherscan.io/tx/0xabc123...
  2. Resize: https://sepolia.etherscan.io/tx/0xdef456...
  3. Close:  https://sepolia.etherscan.io/tx/0x789ghi...
  4. Withdraw: https://sepolia.etherscan.io/tx/0xjkl012...

Total Gas Used: ~500,000 gas
SUCCESS: Offramp complete! Funds now in wallet.
```

## Additional Contracts Needed

### SimpleConsensus Adjudicator

**Purpose:** Validates state transitions
**Deployment:** Check same deployments folder for address

### PremintERC20 (Test Token)

The ytest.usd token contract for testing
**Deployment:** Check deployments for address

## Contract Architecture

```
Custody Contract (0x019B65...)
├── create()    - Creates channel, locks initial deposits
├── join()      - Server joins (not needed for our flow)
├── resize()    - Adjusts allocations, moves funds
├── close()     - Finalizes channel, unlocks to ledger
├── withdraw()  - Transfers ledger balance to wallet
├── deposit()   - Deposits funds to ledger
└── challenge() - Dispute resolution (not needed for cooperative close)
```

## Current vs Full Implementation

### Current Implementation (RPC Only)

```typescript
✓ yellowClient.createChannel()    // Returns channel config
✓ yellowClient.resizeChannel()    // Returns resize state
✓ yellowClient.closeChannel()     // Returns final state
✗ No blockchain submission
✗ Funds stuck in unified balance
```

### Full Implementation (RPC + Smart Contract)

```typescript
✓ yellowClient.createChannel()       // Get channel config
✓ custodyClient.create()             // Submit to blockchain
✓ yellowClient.resizeChannel()       // Get resize state
✓ custodyClient.resize()             // Submit to blockchain
✓ yellowClient.closeChannel()        // Get final state
✓ custodyClient.close()              // Submit to blockchain
✓ custodyClient.withdraw()           // Withdraw to wallet
✓ All transactions have Etherscan links
✓ Funds successfully offramped to wallet
```

## Estimated Implementation Time

- Extract ABI from contract: 30 minutes
- Create CustodyClient module: 2 hours
- Integrate into offramp script: 2 hours
- Add transaction monitoring: 1 hour
- Testing and debugging: 3 hours
- **Total: ~8 hours**

## Benefits of Full Implementation

1. **Complete Offramp:** Merchant can withdraw unified balance to wallet
2. **Full Traceability:** 4 separate Etherscan links for each step
3. **Standards Compliant:** Uses official Custody contract
4. **Production Ready:** Real on-chain settlement
5. **User Friendly:** Automated end-to-end flow

## Resources

- Custody Contract: https://github.com/erc7824/nitrolite/blob/main/contract/src/Custody.sol
- Nitrolite SDK: https://github.com/erc7824/nitrolite/tree/main/sdk
- Yellow Docs: https://docs.yellow.org
- Sepolia Custody: https://sepolia.etherscan.io/address/0x019B65A265EB3363822f2752141b3dF16131b262
