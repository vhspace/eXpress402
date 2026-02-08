# Architecture overview

eXpress402 is a paid MCP server for agent workflows. It implements x402 v2 with wallet authentication (SIWx) and supports two payment rails:

- **Yellow Network rail**: session-based, off-chain spending via Nitrolite app sessions
- **Arc + Circle Gateway rail**: on-chain proof of payment on Arc Testnet via Circle Gateway mint events

## Components

- **MCP server**: `src/mcp/server.ts`
- **x402 payment requirements + verification**: `src/x402/payment.ts`, `src/x402/verify.ts`
- **SIWx (wallet auth) client + verifier + storage**: `src/x402/siwx/*`
- **Yellow SDK / Nitrolite client**: `src/yellow/*`
- **Arc payment verification**: `src/arc/*`
- **Sentifi demo app (dashboard + agent loop)**: `src/sentifi/server/demo.ts`, `src/lifi-agent/dashboard.html`

## High-level flow (shared)

1. Client calls an MCP tool (for example `market_rumors`)
2. Server returns **402 Payment Required** with:
   - an SIWx challenge
   - accepted payment rails (`accepts[]`)
3. Client authenticates (SIWx), pays using the chosen rail, and retries the tool call with `_meta['x402/payment']`
4. Server verifies proof, then returns the tool result

See `HACKATHON-FLOWS.md` for full diagrams.

## Rail-specific verification

### Yellow Network (session-based)

- Client creates an app session and pays via Yellow off-chain transfers
- Server verifies the transfer via Yellow RPC and tracks session state
- Session reuse is enabled via Redis-backed lookup keyed by wallet + scheme

### Arc + Circle Gateway (on-chain proof)

- Client submits a `GatewayMinter.gatewayMint(...)` transaction on Arc Testnet
- Server verifies the transaction receipt contains `GatewayMinter.AttestationUsed` for the configured `payTo` and required amount
- Replay protection marks the `transferSpecHash` as used

## Where to start (for reviewers)

- `JUDGES.md` (short path)
- `PAYMENT-RAILS.md` (Yellow vs Arc tradeoffs)
- `HACKATHON-FLOWS.md` (sequence diagrams)

