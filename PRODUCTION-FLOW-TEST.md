# Production Flow Test with Real USDC

## Overview

This guide walks through testing the complete production flow with real USDC on Base (L2) to validate the entire architecture.

## Cost Estimate

**Base Mainnet (Recommended):**
- Gas fees: ~$0.10-0.20 USD total
- Test amount: 2 USDC
- **Total needed:** ~2.5 USDC + 0.001 ETH for gas

**Why Base:**
- Real USDC supported
- Much cheaper than Ethereum mainnet
- Yellow Network production clearnode supports it
- Fast confirmation times

## Prerequisites

### 1. Get Base ETH for Gas

Agent wallet needs ~0.001 ETH on Base for gas fees.

**Option A: Bridge from Ethereum**
- https://bridge.base.org
- Bridge 0.001 ETH (costs ~$2-3 on Ethereum)

**Option B: Buy on Exchange**
- Coinbase: Buy on Base network directly
- Send to agent wallet

### 2. Get USDC on Base

Agent wallet needs 2-3 USDC on Base mainnet.

**Option A: Buy on Coinbase**
- Buy USDC
- Withdraw to Base network
- Send to: `<YELLOW_AGENT_ADDRESS from .env>`

**Option B: Bridge**
- https://bridge.base.org
- Bridge USDC from Ethereum/other chains

### 3. Verify Funds

```bash
# Check agent wallet address
grep YELLOW_AGENT_ADDRESS .env

# Go to Base explorer and check balances:
# https://basescan.org/address/<YOUR_AGENT_ADDRESS>
#
# Should show:
# - ETH Balance: ~0.001 ETH
# - USDC Balance: ~2-3 USDC
```

## Production Flow Test

### Step 1: Agent Onramp (Deposit to Custody)

```bash
# Deposit 2 USDC to Yellow Network Custody contract
npm run agent-onramp -- 2 base
```

**Expected Output:**
```
=== Agent Onramp to Yellow Network ===
Agent: 0xe74298ea70069822eB490cb4Fb4694302e94Dbe1
Network: Base (chain 8453)
Amount: 2 usdc
Clearnode: wss://clearnet.yellow.com/ws

Step 1/4: Checking wallet usdc balance...
SUCCESS: Wallet balance: 2.5 usdc

Step 2/4: Approving Custody contract...
   Waiting for approval confirmation...
SUCCESS: Approval confirmed
   TX Hash: 0xabc123...
   Etherscan: https://basescan.org/tx/0xabc123...

Step 3/4: Depositing to Custody contract...
SUCCESS: Deposited to custody ledger
   Amount: 2 usdc
   TX Hash: 0xdef456...
   Explorer: https://basescan.org/tx/0xdef456...

Step 4/4: Verifying custody ledger balance...
SUCCESS: Custody ledger balance: 2 usdc
   Agent can now use funds for app sessions

=== Onramp Summary ===
Amount onramped: 2 usdc
From: Agent wallet (base)
To: Custody ledger (ready for Yellow Network)

TRANSACTIONS:
  1. Approve USDC: https://basescan.org/tx/0xabc123...
  2. Deposit to Custody: https://basescan.org/tx/0xdef456...

SUCCESS: Agent onramp complete!
```

**Verification:**
1. Check transactions on Basescan
2. Verify custody contract received USDC
3. Agent wallet now has ~0.5 USDC left
4. Custody ledger has 2 USDC

### Step 2: Create Payment Channel (Custody → Unified Balance)

This step moves custody ledger funds to unified balance for app sessions.

**Method 1: Via agent-onramp (if implemented)**
The onramp script could automatically create a channel after deposit.

**Method 2: Manual channel creation**
```bash
# TO BE IMPLEMENTED: Create channel from custody
# This would call:
# - create_channel (RPC)
# - nitroliteClient.createChannel() (blockchain)
# - Funds move: Custody ledger → Channel → Unified balance
```

**Expected Result:**
- Agent unified balance: 2 USDC (available for app sessions)

### Step 3: Agent Uses App Session (Pay Merchant)

```bash
# Run existing demo with production clearnode
YELLOW_CLEARNODE_URL=wss://clearnet.yellow.com/ws npm run demo:agentkit
```

**Expected:**
- Agent creates app session with 1 USDC
- Agent uses MCP tools
- Session closes
- Merchant receives 0.2 USDC (or whatever pricing)
- Agent gets refund

**Result:**
- Merchant unified balance: +0.2 USDC
- Agent unified balance: +0.8 USDC (refund)

### Step 4: Merchant Offramp (Unified Balance → Wallet)

This is the KEY TEST - can merchant withdraw unified balance to wallet?

```bash
# Attempt to withdraw merchant's unified balance
npm run merchant-offramp -- base
```

**Possible Outcomes:**

**Outcome A: Works (Best Case)**
```
Step 1: Check unified balance: 0.2 USDC ✓
Step 2: Create channel: TX link ✓
Step 3: Resize with allocate_amount: Moves unified → channel ✓
Step 4: Close channel: TX link ✓
Step 5: Withdraw: TX link ✓
SUCCESS: 0.2 USDC in merchant wallet
```

**Outcome B: Same Issue (Expected)**
```
Step 1: Check unified balance: 0.2 USDC ✓
Step 2: Create channel: TX link ✓
Step 3: Resize: Prepared (but funds don't move)
Step 4: Close: TX link ✓
Step 5: Withdraw: Custody empty (same architectural limitation)
```

**Outcome C: Clearnode Coordinates (Possible)**
```
Clearnode recognizes unified balance withdrawal request
Automatically handles custody operations
Returns transaction hashes
Merchant gets funds
```

## What This Test Proves

### If Offramp Works:
- Production architecture supports unified → wallet flow
- Our implementation is correct
- Merchants can self-service withdraw
- Document as production-ready feature

### If Offramp Fails (Same as Sandbox):
- Confirms unified balance stays off-chain by design
- Transfers remain the correct solution
- Document architectural limitation
- Recommend merchant settlement API from Yellow

## Alternative Test: Pure Custody Flow

To test the custody withdrawal path that we KNOW works:

```bash
# 1. Agent deposits to custody (done in step 1)
# 2. Agent creates channel
# 3. Agent uses channel for payments (NOT app sessions)
# 4. Agent closes channel → back to custody ledger
# 5. Agent withdraws to wallet
# SUCCESS: Proven the custody path works
```

This validates our custody integration is correct.

## Estimated Timeline

- Setup (get USDC, ETH): 15-30 minutes
- Onramp test: 5 minutes
- Channel creation: 5 minutes
- App session test: 10 minutes
- Offramp test: 5 minutes
- Analysis: 10 minutes
- **Total: ~1 hour**

## Commands Summary

```bash
# 1. Check agent wallet on Base
# Visit: https://basescan.org/address/<AGENT_ADDRESS>

# 2. Agent onramp (deposit to custody)
npm run agent-onramp -- 2 base

# 3. Run app session demo with production
YELLOW_CLEARNODE_URL=wss://clearnet.yellow.com/ws npm run demo:agentkit

# 4. Merchant offramp attempt
npm run merchant-offramp -- base

# 5. Check all transactions
# Basescan links from script output
```

## Expected Deliverables

After testing:
1. Basescan transaction links (3-6 TXs)
2. Confirmation of which flows work
3. Documentation update
4. Clear recommendation for production deployment

## Next Step

**When you're ready to test:**
1. Add 2-3 USDC to agent wallet on Base
2. Add 0.001 ETH to agent wallet on Base for gas
3. Run the commands above
4. Report results

I'll be ready to debug any issues and update the implementation based on what we learn!
