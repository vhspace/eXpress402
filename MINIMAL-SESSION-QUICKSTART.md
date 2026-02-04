# Minimal Yellow Session Demo with Quorum 2 - Quick Start

This demo teaches you how Yellow app sessions work with FULL quorum 2 governance through a simple payment flow.

## What You'll Learn

1. How to connect and authenticate with Yellow clearnode
2. How to create an app session with quorum governance (including quorum 2!)
3. How to verify balances at each step (Expected vs Got)
4. How to close a session and finalize payments
5. How to verify the merchant actually received the payment

## Quick Run

```bash
# Make sure you have both wallet keys in .env
set -a && source .env && npm run minimal-session
```

## Expected Flow

```
┌─────────────┐                                    ┌──────────────┐
│   Agent     │                                    │  Merchant    │
│   Wallet    │                                    │   Wallet     │
└─────┬───────┘                                    └──────┬───────┘
      │                                                   │
      │  1. Create app session with 1.0 ytest.usd        │
      ├──────────────────────────────────►               │
      │     (locks 1.0 from agent's unified balance)     │
      │                                                   │
      │  2. Close app session with redistribution        │
      │     - Agent: 0.9 ytest.usd                       │
      │     - Merchant: 0.1 ytest.usd                    │
      ├──────────────────────────────────►               │
      │                                                   │
      │  3. Funds redistributed to wallets               │
      │     Agent: -0.1                                  │
      │     Merchant: +0.1  ◄────────────────────────────┤
      │                                                   │
      │  4. Both authenticate to verify final balances   │
      │                                                   │
```

## Key Concepts

### App Session
Multi-party off-chain channel that locks funds from unified balance. All operations happen off-chain with instant finality.

### Quorum Governance
Defines how many participants must agree on state changes:
- `weights: [1, 1]` - Each participant has 1 vote
- `quorum: 2` - Both must agree (2 out of 2)

**Achievement:** The demo proves quorum 2 works COMPLETELY! Both `create_app_session` AND `close_app_session` use quorum 2 where both agent and merchant must sign all operations.

**The Secret:** Pass the REQUEST ARRAY to signers, not stringified JSON!
```typescript
// ✓ Correct:
const sig = await merchantSigner(parsed.req);  // req is the array

// ❌ Wrong:
const sig = await merchantSigner(JSON.stringify(parsed.req));
```

### Balance Tracking
At each step, the demo shows:
```
Agent:    Expected: X, Got: Y ✓
Session:  Expected: X, Got: Y ✓
Merchant: Expected: X, Got: Y ✓
```

This proves every operation works as expected.

### State Versioning
Each state update increments the version:
- Version 0: Initial state (session created)
- Version 1: After first payment
- Version N: Final state before close

## File Structure

```
src/minimal-session-demo.ts     # Complete demo code
docs/minimal-session-demo.md    # Detailed documentation
MINIMAL-SESSION-QUICKSTART.md   # This file
```

## Next Steps

1. Run the demo to see it in action
2. Read `docs/minimal-session-demo.md` for detailed explanations
3. Experiment with different payment amounts
4. Try multiple state updates before closing

## Resources

- [Yellow Docs](https://docs.yellow.org/)
- [Off-Chain RPC Protocol](https://docs.yellow.org/docs/protocol/off-chain/overview)
