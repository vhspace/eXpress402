# Merchant Offramp Guide

Complete guide for merchants to withdraw funds from Yellow Network's unified balance to their Sepolia wallet.

## Overview

When app sessions close, merchant funds are deposited into Yellow Network's **unified balance** (off-chain). This guide explains how to withdraw these funds to your on-chain Sepolia wallet using payment channels.

## Flow Architecture

```
Unified Balance (off-chain) → Payment Channel → On-Chain Wallet (Sepolia)
```

The offramp process involves:
1. Creating a payment channel
2. Moving funds from unified balance to the channel
3. Closing the channel to settle on-chain
4. Receiving funds in your Sepolia wallet

## Prerequisites

### Required Environment Variables

In your `.env` file:

```bash
YELLOW_MERCHANT_PRIVATE_KEY=0x...    # Required for signing
YELLOW_MERCHANT_ADDRESS=0x...        # Default destination address
YELLOW_CLEARNODE_URL=wss://clearnet-sandbox.yellow.com/ws  # Auto-configured
YELLOW_ASSET_SYMBOL=ytest.usd        # Asset to withdraw
```

### Gas Fees

Ensure your merchant wallet has sufficient ETH for gas:
- **Testnet (Sepolia)**: Free test ETH from faucets
- **Mainnet**: Real ETH required for gas

Get Sepolia ETH from:
- https://sepoliafaucet.com/
- https://www.alchemy.com/faucets/ethereum-sepolia

## Usage

### Standalone Offramp

Withdraw to the merchant address configured in `.env`:

```bash
npm run merchant-offramp
```

### Custom Destination

Withdraw to a specific address:

```bash
npm run merchant-offramp 0x1234567890123456789012345678901234567890
```

### Integrated in Demo

The offramp automatically runs at the end of the AgentKit demo:

```bash
npm run demo:agentkit
```

After the session closes and merchant receives payment, Step 7 automatically executes the offramp.

## Step-by-Step Process

### Step 1: Check Unified Balance

The script queries your unified balance from Yellow Network.

**Output:**
```
Step 1/6: Checking unified balance...
SUCCESS: Unified balance: 0.2 ytest.usd
   Location: Yellow Network (off-chain)
   Status: Ready for offramp
```

**Evidence:** Off-chain ledger entry in Yellow Network

### Step 2: Get Token Address

Looks up the token contract address for the asset on Sepolia.

**Output:**
```
Step 2/6: Looking up token address...
SUCCESS: Token found: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
   Chain: Sepolia (11155111)
   Decimals: 6
```

**Evidence:** Yellow Network asset configuration

### Step 3: Create Payment Channel

Creates a new payment channel between you and the Yellow clearnode.

**Output:**
```
Step 3/6: Creating payment channel...
SUCCESS: Channel created: 0x8f3c5d1a9e7b2c4f6d8e1a3b5c7d9e2f4a6b8c1d
   Participants: [0x9126d073e0a5e45D907feA0b4f4857F5b7191430, 0xClearNode...]
   Initial balance: 0 (empty channel)
```

**Evidence:** Channel ID from Yellow Network

### Step 4: Move Funds to Channel

Transfers funds from unified balance into the payment channel using resize operation.

**Output:**
```
Step 4/6: Moving unified balance to channel...
SUCCESS: Funds moved to channel
   Channel balance: 0.2 ytest.usd
   Unified balance: 0 ytest.usd
   Status: Ready for on-chain settlement
```

**Evidence:** Updated balances in Yellow Network

### Step 5: Close Channel (On-Chain Settlement)

Closes the channel cooperatively, triggering on-chain settlement.

**Output:**
```
Step 5/6: Closing channel (on-chain settlement)...
SUCCESS: Channel closed
   Transaction submitted to Sepolia blockchain
   TX Hash: 0x1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z
```

**Evidence:** Transaction hash from Sepolia blockchain

### Step 6: Transaction Verification

Generates Etherscan link for easy verification.

**Output:**
```
Step 6/6: Transaction verification...
SUCCESS: View on Etherscan: https://sepolia.etherscan.io/tx/0x1a2b3c...
   Status: Pending confirmation
   Expected: ~15 seconds on Sepolia
```

**Evidence:** Etherscan transaction explorer

## Final Summary

After completion, you'll see:

```
=== Offramp Summary ===
Amount: 0.2 ytest.usd
From: Yellow Network Unified Balance (off-chain)
To: 0x9126d073e0a5e45D907feA0b4f4857F5b7191430 (Sepolia blockchain)
Channel: 0x8f3c5d1a9e7b2c4f6d8e1a3b5c7d9e2f4a6b8c1d
Transaction: 0x1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z
Etherscan: https://sepolia.etherscan.io/tx/0x1a2b3c...

SUCCESS: Offramp complete!
Merchant can now offramp to fiat via exchange (Coinbase, etc.)
```

## Verification Steps

### 1. Open Etherscan Link

Click the provided Etherscan link to view the transaction.

### 2. Verify Destination Address

Ensure the "To" address matches your merchant wallet address.

### 3. Verify Token Transfer

Check that the token transfer amount matches your offramp amount.

### 4. Check Transaction Status

Wait for confirmation (typically ~15 seconds on Sepolia).

**Transaction Status Meanings:**
- **Pending**: Transaction submitted, waiting for confirmation
- **Success**: Transaction confirmed, funds in your wallet
- **Failed**: Transaction reverted (rare, funds remain in unified balance)

## Troubleshooting

### Error: No unified balance to offramp

**Cause:** No funds in unified balance

**Solution:** Ensure app sessions have closed and funds transferred to unified balance

### Error: Asset not found on Sepolia

**Cause:** Asset not supported on Sepolia testnet

**Solution:** Verify `YELLOW_ASSET_SYMBOL` is set to `ytest.usd` for testnet

### Error: Insufficient gas

**Cause:** Merchant wallet doesn't have enough ETH for gas

**Solution:** Add Sepolia ETH to your merchant wallet from faucets

### Error: Transaction hash not received

**Cause:** Channel closure failed or network issue

**Solution:**
- Check Yellow Network status
- Verify merchant private key is correct
- Retry after a few minutes

### Funds Remain in Unified Balance

If offramp fails at any step, funds remain safely in unified balance. You can:
1. Check the error message
2. Fix the issue (add gas, check configuration)
3. Retry the offramp

## FAQ

### How long does offramp take?

**Total time:** ~20-30 seconds on Sepolia

- Step 1-4: ~2-3 seconds (off-chain operations)
- Step 5: ~3 seconds (resize confirmation)
- Step 6: ~15 seconds (blockchain confirmation)

### What are the gas costs?

**Testnet (Sepolia):** Free (test ETH from faucets)

**Mainnet:** ~$5-20 USD depending on network congestion

### Can I offramp partial amounts?

Currently, the script offramps the entire unified balance. To offramp partial amounts, you would need to:
1. Transfer the partial amount to a separate account
2. Run offramp from that account

### What happens if I lose connection during offramp?

The process is atomic at each step:
- If connection lost before Step 5: Funds remain in unified balance
- If connection lost during Step 5: Channel closure may still complete
- If connection lost after Step 5: Transaction was submitted, check Etherscan

### Can I offramp multiple times?

Yes, each offramp creates a new channel and closes it. You can run the script as many times as needed.

### Is this safe?

Yes, the offramp process is safe:
- Uses Yellow Network's cooperative closure (preferred method)
- Requires your private key signature (only you can authorize)
- Funds never lost (revert to unified balance on error)
- Transaction hash provides proof of settlement

## Next Steps

After successful offramp, your funds are in your Sepolia wallet. You can:

1. **View on Etherscan:** Verify the transaction and balance
2. **Transfer to Exchange:** Send to Coinbase/Kraken for fiat offramp
3. **Use in DeFi:** Use the funds in other Ethereum applications

## Production Considerations

### Mainnet Deployment

When deploying to mainnet:

1. **Update Chain ID:** Change from Sepolia (11155111) to mainnet (1)
2. **Real Assets:** Use production tokens (USDC, USDT, etc.)
3. **Gas Budget:** Ensure sufficient ETH for gas fees
4. **Monitoring:** Set up alerts for offramp transactions
5. **Security:** Use hardware wallet or secure key management

### Automation

For automated offramp:

```typescript
import { offrampMerchantFunds } from './merchant-offramp.js';

// After session closes
await offrampMerchantFunds(merchantAddress);
```

### Error Handling

Always wrap in try-catch:

```typescript
try {
  const result = await offrampMerchantFunds();
  console.log('Offramp successful:', result.etherscanUrl);
} catch (error) {
  console.error('Offramp failed:', error);
  // Alert merchant, retry later, etc.
}
```

## Support

For issues or questions:

- **Yellow Network:** https://docs.yellow.org
- **GitHub Issues:** https://github.com/vhspace/eXpress402/issues
- **Discord:** Join the Yellow Network community

## Related Documentation

- [Yellow Network Docs](https://docs.yellow.org)
- [Payment Channel Methods](https://docs.yellow.org/docs/protocol/off-chain/channel-methods)
- [Architecture Overview](../README.md#architecture)
