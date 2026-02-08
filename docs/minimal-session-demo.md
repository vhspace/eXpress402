# Minimal Yellow App Session Demo

A clean, educational demonstration of Yellow Network app sessions that shows the complete lifecycle from creation to payment to closure.

## Overview

This demo demonstrates the core Yellow app session workflow with two participants:

1. **Agent** - Opens a session (example: 1 USDC), initiates payment
2. **Merchant** - Receives a metered payment (example: 0.1 USDC)

## What This Demo Shows

### App Session Lifecycle

```
1. Create Session
   └─ Agent locks 1 USDC (example)
   └─ Uses quorum governance (both parties must agree)

2. Payment (State Update)
   └─ Agent submits OPERATE intent
   └─ Redistributes: Agent 0.9, Merchant 0.1 (example)

3. Close Session
   └─ Finalizes state
   └─ Funds redistributed to wallets
```

### Key Yellow Concepts Demonstrated

1. **NitroRPC/0.4 Protocol**
   - Compact JSON array message format
   - Signature-based authentication
   - Challenge-response auth flow

2. **App Session Management**
   - `create_app_session` - Initialize multi-party channel
   - `submit_app_state` - Update state with intents
   - `close_app_session` - Finalize and settle

3. **Quorum Governance**
   - Defines voting weights for participants
   - Sets threshold for state changes (2 out of 2 in this demo)
   - Ensures all parties agree on state transitions

4. **Intent System (0.4 Feature)**
   - **OPERATE** intent - Redistribute existing funds
   - Future: DEPOSIT (add funds), WITHDRAW (remove funds)

## Running the Demo

```bash
# Ensure your .env has both wallet keys
set -a && source .env && npm run minimal-session
```

## Expected Output

```
╔════════════════════════════════════════╗
║   Minimal Yellow App Session Demo     ║
╚════════════════════════════════════════╝

Agent:    0xe74298ea70069822eB490cb4Fb4694302e94Dbe1
Merchant: 0x9126d073e0a5e45D907feA0b4f4857F5b7191430

✓ Connected to Yellow clearnode
✓ Agent authenticated

=== Initial Balance ===
[
  {
    "asset": "ytest.usd",
    "amount": "3.6"
  }
]

=== Creating App Session ===
  Creating session with quorum 2 governance...
  Session created with quorum 1 (agent signature)
  Note: In production with quorum 2, merchant would also sign here
✓ App session created: 0x675743e02790e534c0b87f43795ff2e08486c9db0eb1543bd5bdbec8adfb74cd
  Initial balance: Agent=1.0, Merchant=0

=== Verifying Session Balance ===
✓ Session funded with 1 ytest.usd

=== Payment via Session Close ===
  Redistributing funds: Agent=0.9, Merchant=0.1

=== Closing App Session ===
  Closing session with final allocations...
  Closing with quorum 1 (agent signature)
  Note: In production with quorum 2, merchant would also sign here
✓ App session closed

=== Final Balances ===
Agent: 3.5 ytest.usd
  Started with: 3.6
  Change: -0.1 (paid to merchant)

Authenticating as merchant to verify payment...

Merchant: 13.6 ytest.usd
  Received: 0.1 ytest.usd ✓

✓ Demo complete!
✓ Verified: Merchant received 0.1 ytest.usd as expected
```

## Code Structure

### 1. Connection & Authentication

```typescript
// Connect to clearnode WebSocket
const ws = await connect();

// Three-step auth flow
auth_request → auth_challenge → auth_verify
```

### 2. Create App Session

```typescript
const appDefinition = {
  protocol: '0x...01',           // App protocol identifier
  participants: [agent, merchant], // All parties
  weights: [1, 1],                // Equal voting power
  quorum: 2,                      // Both must agree
  challenge_period: 86400,        // 24 hours to dispute
  nonce: Date.now(),              // Unique session ID
};

const allocations = {
  [agent]: { [USDC]: '1000000' },    // Agent: 1 USDC (6 decimals)
  [merchant]: { [USDC]: '0' },       // Merchant: 0
};
```

### 3. Payment via State Update

```typescript
const intent = {
  type: 'OPERATE',              // Redistribute funds
  allocations: {
    [agent]: { [USDC]: '900000' },     // 0.9 USDC
    [merchant]: { [USDC]: '100000' },  // 0.1 USDC
  },
};

// Sign and submit
await submit_app_state({ intent, version: 1, signatures });
```

### 4. Close Session

```typescript
// Sign close intent
await close_app_session({
  app_session_id,
  signatures,
  version: 1
});

// Funds redistributed to wallets automatically
```

## Key Differences from Production

This minimal demo is intentionally simplified for learning:

1. **No Error Handling** - Production needs retry logic, timeout handling
2. **No Multi-Sig Collection** - Real apps collect signatures from all participants
3. **No State Validation** - Production validates state transitions
4. **Hardcoded Values** - Real apps use configuration and dynamic values
5. **Single Payment** - Production supports multiple state updates

## Next Steps

After understanding this demo, explore:

1. **Multi-Step Payments** - Multiple `submit_app_state` calls
2. **DEPOSIT Intent** - Add funds to active session
3. **WITHDRAW Intent** - Remove funds from active session
4. **Error Recovery** - Handle network failures and disputes
5. **Multi-Party Sessions** - More than 2 participants with weighted voting

## Technical Details

### Message Format (NitroRPC)

```javascript
// Request: [requestId, method, params, timestamp]
[1699123456789, "create_app_session", {...}, 1699123456789]

// Response: [requestId, "result", data, timestamp, signature]
[1699123456789, "result", {...}, 1699123457000, "0x..."]

// Error: [requestId, "error", errorData, timestamp, signature]
[1699123456789, "error", {...}, 1699123457000, "0x..."]
```

### Signature Generation

```typescript
1. Create message (deterministic JSON)
2. Hash with Keccak256
3. Sign with secp256k1 (lowS: true)
4. Format: 0x + compactHex + recovery byte
```

### State Versioning

```
Version 0: Initial state (create_app_session)
Version 1: First update (submit_app_state)
Version 2: Second update
...
Version N: Final state (close_app_session)
```

Each version must be signed by quorum of participants.

## Resources

- [Yellow Network Docs](https://docs.yellow.org/)
- [Off-Chain RPC Overview](https://docs.yellow.org/docs/protocol/off-chain/overview)
- [NitroRPC Protocol](https://docs.yellow.org/docs/protocol/off-chain/message-format)
- [App Sessions Guide](https://docs.yellow.org/docs/build/quick-start/)

## Troubleshooting

### "Insufficient balance"
Ensure agent wallet is funded via [Yellow Faucet](https://faucet.yellow.org/)

### "Authentication failed"
Verify `YELLOW_AGENT_PRIVATE_KEY` in `.env` is correct

### "Quorum not met"
This demo only collects agent signature. In production, merchant must also sign state updates.

### "Invalid signature"
Check that message serialization is deterministic and matches Yellow's format
