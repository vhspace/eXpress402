# Yellow Network track

This project integrates Yellow SDK / Nitrolite to support **instant, session-based off-chain spending** for x402-protected MCP tools.

## What judges typically look for

- Uses the **Yellow SDK / Nitrolite protocol** in the core flow
- Demonstrates **session-based logic** (one session, many instant actions)
- Shows a clear **start session → spend off-chain → close session** lifecycle
- Ships a working prototype (UI or CLI) and a short demo video

## Where this repo uses Yellow

- **Nitrolite RPC client**: `src/yellow/rpc.ts`
- **x402 payment integration**: `src/mcp/server.ts`, `src/x402/payment.ts`
- **Session reuse (wallet → session id)**: `src/x402/siwx/storage.ts`
- **Demos**:
  - Web UI: `npm run demo:sentifi` (choose **Yellow Network** rail)
  - Minimal session lifecycle: `npm run minimal-session`
  - Full scripted demo: `npm run demo`

## How to demo (recommended)

```bash
npm run setup
npm run demo:sentifi
```

In the dashboard:

1. Select **Yellow Network** rail
2. Click **LOGIN** (creates an app session)
3. Run **Analyze** (calls x402-protected MCP tools and spends from the session)
4. Click **LOGOUT** (closes the session and finalizes allocations)

## What the off-chain logic is

- The client opens an app session with allowances
- Each paid MCP call is metered against the session
- The session is closed to finalize balances at the end of the flow

For detailed diagrams, see `../HACKATHON-FLOWS.md`.

For a comparison with the Arc + Circle Gateway rail, see `../PAYMENT-RAILS.md`.

