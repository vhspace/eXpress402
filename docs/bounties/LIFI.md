# LI.FI track

This repo uses LI.FI as the cross-chain routing and execution layer for an agent-driven trading demo.

## What judges typically look for

- Uses LI.FI programmatically (SDK or API) for at least one cross-chain action
- Supports at least two EVM chains in the user journey
- Includes a working UI or a clear CLI/demo with logs
- For AI-focused tracks: a clear **monitor → decide → act** loop where actions are executed via LI.FI

## Where this repo uses LI.FI

- **Sentifi execution layer (quotes + routing)**: `src/sentifi/execution/lifi-executor.ts`
- **Dashboard execution module (routes + optional execution)**: `src/lifi-agent/execute.ts`
- **Web demo**: `npm run demo:sentifi` (dashboard at `http://localhost:3456`)

## How to demo (recommended)

```bash
npm run setup
npm run demo:sentifi
```

In the dashboard:

1. Click **LOGIN**
2. Run **Analyze** to produce a decision (strategy loop)
3. Use **Execute** to request a route and (optionally) execute it depending on configuration

## Notes on execution modes

- **Demo mode** can simulate execution for safe reviews (no real transactions)
- **Live execution** is available in the dashboard module via LI.FI `executeRoute(...)` when configured and funded

