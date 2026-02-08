# ARC bounty: Arc + USDC settlement via Circle Gateway (Arc Testnet)

This repo supports x402 v2 payments using **Arc Testnet + Circle Gateway**, verified onchain via a `GatewayMinter.AttestationUsed` event.
Use this rail when you want **Arc-native USDC receipts** instead of Yellow offchain sessions.

This document is tailored to the Arc bounty **"Best Agentic Commerce App Powered by Real-World Assets on Arc"** ($2,500).

## How this maps to the ARC bounty

- **Required tools**: Arc, USDC
- **Recommended tools used**: Circle Gateway (permissionless testnet API), Circle contracts (GatewayWallet/GatewayMinter)
- **Autonomous agent behavior**: Sentifi makes decisions from live market signals and pays for x402-protected MCP calls in USDC.
- **Risk management**: Spend is bounded by your deposited unified balance; strategy logic uses thresholds + sizing (see [Hackathon flows](HACKATHON-FLOWS.md)).

If you want to extend toward RWA collateral flows (borrow/repay/rebalance), this rail is the settlement primitive; plug in an Arc RWA protocol and fund the Gateway unified balance from that credit line.

### Bounty fit checklist

- [x] Autonomous spending / payments settled in USDC (Arc + Circle Gateway rail)
- [x] Agent executes transactions (Arc `gatewayMint` proof per paid MCP call)
- [x] Clear decision logic tied to market signals (Sentifi signal + risk layers)
- [ ] Borrow/repay/rebalance against RWA collateral (not implemented in this repo; intended extension point)

## Submission checklist (what to include)

- **Functional MVP**: run `npm run demo:sentifi` (dashboard + backend) and perform one paid call in Arc rail.
- **Architecture diagram**: [Arc + Circle Gateway x402 flow](HACKATHON-FLOWS.md#3-arc--circle-gateway-x402-flow)
- **Video demo outline (60–120s)**:
  - show unified balance deposit (`npx tsx scripts/arc-gateway-deposit.ts 10`)
  - dashboard: **Rail** → **Arc + Circle Gateway** → **LOGIN**
  - trigger **Analyze**, show `LAST MINT` and the mint tx in Arc explorer
- **Product feedback**: note any friction points you hit (faucet, deposit UX, error messages, confirmation time, etc.)

## Demo (2–3 minutes)

1. **One-time setup** (creates `.env` + wallets):

```bash
npm run setup
```

2. **Fund Arc Testnet USDC** (for gas + USDC) using Circle faucet:
   - Faucet: `https://faucet.circle.com/`
   - Network: Arc Testnet
   - Token: USDC

3. **Deposit into Gateway unified balance** (onchain USDC alone is not enough):

```bash
npx tsx scripts/arc-gateway-deposit.ts 10
```

4. **Run the dashboard**:

```bash
npm run demo:sentifi
```

Open `http://localhost:3456`, click **Rail** → **Arc + Circle Gateway** → **LOGIN**, then run an **Analyze** / market call.
You should see a `LAST MINT` tx hash and the merchant’s onchain USDC balance increase.

## Payment proof (what the server verifies)

- **x402 scheme**: `arc-usd-offchain`
- **Client proof**: `_meta['x402/payment'] = { accepted: { ... }, payload: { mintTxHash } }`
- **Onchain verification**: tx receipt contains `AttestationUsed(token=USDC, recipient=payTo, value >= pricePerCall)`
- **Optional payer binding**: if SIWx is present, the server can bind payment to the authenticated wallet via `sourceSigner` (when available)
- **Replay protection**: `transferSpecHash` is marked used in Redis/KV

See [Arc + Circle Gateway x402 flow](HACKATHON-FLOWS.md#3-arc--circle-gateway-x402-flow) for the diagram.

## Config reference

### Required

The demo server reuses existing env names for wallet identity:

- `YELLOW_AGENT_PRIVATE_KEY`: agent EOA private key (signs SIWx and Circle Gateway burn intent)
- `YELLOW_MERCHANT_ADDRESS`: merchant address (the x402 `payTo` recipient)

Notes:
- This demo uses a local EOA private key by default (Viem). Circle Wallets are optional and not required.
- Circle Gateway testnet API calls in this demo are made without API keys.

### Optional overrides

- `ARC_RPC_URL`: Arc Testnet RPC URL override
- `ARC_GATEWAY_MINTER_ADDRESS`: override GatewayMinter address (rare)
- `ARC_USDC_ADDRESS`: override USDC address (rare)
- `PAYMENT_REPLAY_TTL_SECONDS`: TTL for replay protection keys (default: 86400)

## Arc testnet constants (defaults)

- **Arc Testnet RPC**: `https://rpc.testnet.arc.network`
- **Arc explorer**: `https://testnet.arcscan.app`
- **Arc chainId**: `5042002`
- **Gateway domain**: `26`
- **Arc USDC ERC-20 interface** (6 decimals): `0x3600000000000000000000000000000000000000`
- **GatewayWallet**: `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`
- **GatewayMinter**: `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`
- **Gateway API base URL**: `https://gateway-api-testnet.circle.com`
