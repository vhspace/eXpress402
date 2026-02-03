# Claude AI Agent Context for eXpress402

This project implements x402 v2 with SIWx (Sign-In-With-X) wallet authentication integrated with Yellow Network's off-chain payment channels.

## Key Concepts

- **SIWx (Sign-In-With-X)**: CAIP-122 compliant wallet authentication. AI agents sign a message with their wallet to prove identity.
- **Yellow Sessions**: Off-chain payment sessions. Pay once, call many times without per-transaction fees.
- **Session Mapping**: Wallet addresses are mapped to Yellow session IDs in Redis/Vercel KV for instant lookup.

## AI Agent Wallets

AI agents MUST use EOA (Externally Owned Account) wallets with private keys.

**Automatic setup (recommended):**
```bash
npm run setup  # Auto-generates agent + merchant wallets, auto-funds from faucet
```

**Manual wallet generation:**
```bash
npm run generate-wallet  # Generates agent wallet only
```

The wallet is used to:
1. Sign SIWx messages (wallet authentication)
2. Sign Yellow Nitro RPC messages (payment authorization)

DO NOT use MetaMask, hardware wallets, or smart contract wallets for AI agents.

**Funding:** Automatic in sandbox mode via `npm run setup` (requests from Yellow faucet if balance < 10 ytest.usd)

## Architecture Flow

**First Request:**
1. Agent signs SIWx message proving wallet ownership
2. Creates Yellow payment session (pays once)
3. Server stores wallet → session mapping in Redis
4. Returns data

**Subsequent Requests:**
1. Agent sends same SIWx signature
2. Server looks up session in Redis (sub-millisecond)
3. Reuses existing Yellow session
4. Returns data (no payment needed)

## Key Files

- `src/x402/siwx/` - SIWx implementation (signature verification, message formatting)
- `src/x402/siwx/storage.ts` - Session storage (Redis/Vercel KV)
- `src/mcp/server.ts` - Payment handler with SIWx integration
- `src/siwx-demo.ts` - Example agent implementation

## Development Commands

```bash
npm run setup           # Complete dev environment setup
npm run generate-wallet # Create new agent wallet
npm run demo:siwx       # Test SIWx integration
npm test                # Run unit tests
npm run dev             # Start MCP server
```

## Redis/KV Storage

Local development uses Redis (auto-started in devcontainer).
Production uses Vercel KV (auto-configured).
Same code works in both environments via @vercel/kv package.

## Critical Lessons from MISTAKES.md

Based on team's experience debugging Yellow quorum 2:

1. **Always read type definitions first** - Don't guess from protocol docs
2. **Pass correct data structures** - Objects/arrays as-is, not JSON strings
3. **Test systematically** - Isolate components, add detailed logging
4. **Never pre-serialize** - Libraries handle serialization internally
5. **Verify all perspectives** - Check agent, server, and storage state

## Security Notes

- Private keys stored in .env (git-ignored)
- Nonce replay prevention with TTL
- Session data persists across server restarts
- Minimal wallet balance (only what's needed for testing)
