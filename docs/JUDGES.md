# Judge guide

This repo contains a working web demo plus reference docs for the payment rails and architecture.

## Quick demo (web UI)

```bash
npm run setup
npm run demo:sentifi
```

Open `http://localhost:3456`.

- Choose a rail: **Yellow Network** (session-based, off-chain) or **Arc + Circle Gateway** (on-chain USDC proof on Arc Testnet)
- Click **LOGIN**
- Run **Analyze** (and optionally **Execute** if configured)

## What to review

- **Architecture overview**: `ARCHITECTURE.md`
- **Diagrams (detailed)**: `HACKATHON-FLOWS.md`
- **Payment rails comparison**: `PAYMENT-RAILS.md`

## Bounty-track mapping 

- **Yellow Network track**: `bounties/YELLOW.md`
- **Arc + Circle Gateway (Arc track)**: `ARC-GATEWAY-SETUP.md`
- **LI.FI track**: `bounties/LIFI.md`

## Suggested 2–3 minute demo video outline

- Start `npm run demo:sentifi`, open the dashboard
- Show **Yellow rail**: login, one or two paid MCP calls, then logout (session closes)
- Show **Arc rail**: login, one paid MCP call, and open the mint transaction in Arc explorer
- Briefly explain why two rails exist (see `PAYMENT-RAILS.md`)

