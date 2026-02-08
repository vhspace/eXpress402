# Payment Channel Offramp Limitation

## Current Status

The merchant offramp implementation is **partially complete**. The Yellow Network RPC integration works, but the on-chain smart contract interaction is not implemented.

## What Works

1. Unified balance queries - SUCCESS
2. Asset configuration lookup - SUCCESS
3. Yellow Network RPC method calls:
   - `create_channel()` - Returns channel configuration
   - `resize_channel()` - Prepares resize state
   - `close_channel()` - Prepares final state
4. Transaction tracking and Etherscan link generation
5. Step-by-step progress display

## What Doesn't Work

**On-Chain Smart Contract Submission**

Payment channels require blockchain transactions that we haven't implemented:

```
Flow:
  Unified Balance → [BLOCKED] → Payment Channel → [BLOCKED] → On-Chain Wallet

Where BLOCKED = requires smart contract interaction
```

### Required Smart Contract Calls

1. **Custody.create()** - Submit channel creation to blockchain
   - Requires: Channel data, state, signatures
   - Gas cost: ~200k gas
   - Returns: Transaction hash

2. **Custody.resize()** - Submit resize state to blockchain
   - Requires: Channel ID, resize state, signatures
   - Gas cost: ~150k gas
   - Returns: Transaction hash

3. **Custody.close()** - Submit final state to blockchain
   - Requires: Channel ID, final state, signatures
   - Gas cost: ~100k gas
   - Returns: Transaction hash, funds distributed

### Why This Is Complex

1. **Smart Contract ABI**: Need the Custody contract ABI
2. **Contract Address**: Need to know where Custody is deployed
3. **Gas Management**: Need to estimate and pay gas fees
4. **Transaction Submission**: Need viem/ethers integration
5. **Confirmation Waiting**: Need to wait for block confirmation
6. **Error Handling**: Handle reverts, insufficient gas, etc.

## Current Workaround

### Option 1: Use Off-Chain Transfers

Transfer unified balance to another wallet:

```bash
npm run merchant-spend -- 0xDestinationWallet 36
```

This keeps funds in Yellow Network's unified balance system but moves them to a different account.

### Option 2: Manual Channel Management

1. Create payment channel via Yellow Network UI/CLI
2. Submit channel creation transaction manually
3. Use the existing channel for future offramps

## Test Results

Running `npm run merchant-offramp`:

```
Step 1/6: Checking unified balance...
SUCCESS: Unified balance: 36 ytest.usd ✓

Step 2/6: Looking up token address...
SUCCESS: Token found: 0xDB9F... ✓

Step 3/6: Checking for existing payment channels...
INFO: No merchant-owned channel found ✗
ERROR: Payment channel offramp requires on-chain smart contract interaction
```

## What Would Be Needed To Complete This

### 1. Get Custody Contract Details

```typescript
const CUSTODY_ADDRESS = '0x...'; // Need from Yellow docs
const CUSTODY_ABI = [...]; // Need contract ABI
```

### 2. Implement Contract Interaction

```typescript
import { createPublicClient, createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';

async function submitChannelToBlockchain(
  channelData,
  state,
  userSignature,
  clearnodeSignature
) {
  const walletClient = createWalletClient({
    account: privateKeyToAccount(merchantPrivateKey),
    chain: sepolia,
    transport: http()
  });

  const hash = await walletClient.writeContract({
    address: CUSTODY_ADDRESS,
    abi: CUSTODY_ABI,
    functionName: 'create',
    args: [channelData, state, userSignature, clearnodeSignature],
  });

  // Wait for confirmation
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.transactionHash;
}
```

### 3. Integrate into Flow

After each Yellow RPC call, submit the corresponding blockchain transaction.

## Recommendation

### Short Term

Document this limitation clearly and use the transfer() workaround for moving funds between accounts.

### Medium Term

Partner with Yellow Network to understand if:
1. They provide automated on-chain submission
2. They have SDKs that handle this
3. They recommend a specific approach

### Long Term

Implement full smart contract interaction with:
- Custody contract integration
- Gas management
- Transaction monitoring
- Error recovery

## Related Documentation

- Yellow Channel Methods: https://docs.yellow.org/docs/protocol/off-chain/channel-methods
- ClearSync GitHub: https://github.com/layer-3/clearsync
- Architecture docs: https://docs.yellow.org/docs/protocol/architecture

## Conclusion

The merchant offramp implementation correctly integrates with Yellow Network's RPC protocol but cannot complete the full on-chain settlement without smart contract interaction. This is a significant undertaking that requires:
- Custody contract ABI
- Blockchain transaction submission
- Gas management
- Confirmation waiting

The funds remain safely in unified balance and can be used for off-chain operations.
