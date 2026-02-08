# Payment rails: Yellow vs Arc + Circle Gateway

This repo supports two ways to satisfy x402 payments. Both use SIWx for wallet authentication; they differ in *how payment is proven*.

## Summary comparison

| Topic | Yellow Network rail | Arc + Circle Gateway rail |
|---|---|---|
| Best for | Repeated paid calls with minimal per-call overhead | Arc-native USDC receipts and on-chain proof per purchase |
| Payment style | Session-based spending (off-chain) | Transaction-based proof (on-chain) |
| Proof verified by server | Yellow RPC transfer / session state | Arc tx receipt contains `AttestationUsed` event |
| Settlement | Finalized when the session closes | Mint is finalized on-chain when the tx confirms |
| Demo entry point | `npm run demo:sentifi` (choose Yellow) | `npm run demo:sentifi` (choose Arc) |

## How to choose

- Choose **Yellow** when you want an app-like experience where an agent can make many paid tool calls under one session.
- Choose **Arc + Circle Gateway** when you need a verifiable Arc on-chain payment proof for the specific call.

## References

- Yellow track mapping: `bounties/YELLOW.md`
- Arc setup + funding: `ARC-GATEWAY-SETUP.md`
- Verification code: `src/mcp/server.ts`, `src/yellow/*`, `src/arc/*`

