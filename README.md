<div align="center">

# eXpress402

  <img src="docs/assets/express402-logo.png" alt="eXpress402 Logo" width="600">

  <h3>Paid infrastructure for agentic commerce</h3>

  [![Yellow](https://img.shields.io/badge/Yellow-Network-FFD700?logo=ethereum&logoColor=black)](https://yellow.org)
  [![LI.FI](https://img.shields.io/badge/LI.FI-SDK-8B5CF6?logo=ethereum&logoColor=white)](https://li.fi)
  [![x402](https://img.shields.io/badge/x402-v2-0066CC?logo=protocol&logoColor=white)](https://x402.org)
  [![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-1.9+-FF6B35?logo=openai&logoColor=white)](https://modelcontextprotocol.io)

  [![CI](https://github.com/vhspace/eXpress402/workflows/CI/badge.svg)](https://github.com/vhspace/eXpress402/actions)
  [![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
</div>

A paid MCP server for web3 agents to access real-time market data at scale. Uses x402 with Yellow Network session-based settlement so agents can make many paid tool calls without per-call on-chain payment transactions.

## Overview

Web3 agents need market data, but per-call on-chain payment transactions add latency and friction. eXpress402 combines x402 v2 with SIWx wallet authentication and Yellow Network app sessions so agents can authenticate, fund a session, and then make repeated paid queries under that session.

## Architecture: SIWx + Yellow Network

![Yellow Network x402/SIWx Flow](assets/yellow-x402-siwx-flow.png)

**Key Innovation: Pay Once, Call Many Times**

- First call: Authenticate with wallet signature + Create Yellow session + Pay
- Subsequent calls: Verify signature + Reuse session + No per-call on-chain payment transaction
- Session lookup backed by Redis
- Standards-compliant (x402 v2 + CAIP-122 SIWx)
 
See [detailed flow diagrams](docs/HACKATHON-FLOWS.md) and the short reviewer path in [docs/JUDGES.md](docs/JUDGES.md).

## Features

- **Two payment rails**: Yellow Network sessions (off-chain) and Arc + Circle Gateway (on-chain proof on Arc Testnet)
- **Wallet authentication**: SIWx (message signing)
- **Session lifecycle**: create and close app sessions (including quorum 2 mechanics in `npm run minimal-session`)
- **Sentifi demo app**: web dashboard and agent loop with LI.FI routing

## Quick Start

### For Cursor/Claude Code Users (Devcontainer - Recommended)

1. Open project in Cursor or VS Code
2. Click "Reopen in Container" when prompted
3. Wait for container to build (first time: ~2 minutes)
4. Done! Redis auto-starts, dependencies installed, everything ready

### For Local Development

```bash
npm run setup     # One command - everything automated!
                  # - Generates agent wallet
                  # - Generates merchant wallet
                  # - Auto-funds from Yellow faucet
                  # - Installs dependencies

npm run demo:siwx # Test SIWx integration
```

**Fully automated** - No manual steps required for sandbox testing!

### Manual Setup

```bash
npm install
npm run generate-wallet  # Creates AI agent wallet
npm run dev              # Start MCP server
```

## How It Works

**SIWx (Sign-In-With-X)** provides CAIP-122 compliant wallet authentication, proving AI agent identity without requiring accounts or passwords. Combined with **Yellow Network** off-chain settlement, this enables:

1. **First Request**: Agent signs challenge with wallet -> Creates Yellow session -> Pays once
2. **Subsequent Requests**: Agent presents signed challenge -> Server finds session in Redis -> No payment needed
3. **Result**: Sub-millisecond authentication, no per-call fees, standards-compliant

## MCP Configuration

The server is pre-configured in `.cursor/mcp.json`. For other MCP clients, see [docs/x402-yellow-extension.md](docs/x402-yellow-extension.md).

## AI Agent Wallet Requirements

AI agents need EOA (Externally Owned Account) wallets with private keys:

```bash
npm run generate-wallet  # Auto-generates and configures wallet
```

Supported:
- EOA with private key (recommended, auto-generated)
- viem/ethers programmatic wallets

Not Supported:
- MetaMask (requires browser/user interaction)
- Hardware wallets (requires physical device)

See `AGENTS.md` for complete guide.

## Environment Setup

**Auto-configured by `npm run setup`:**
- `YELLOW_AGENT_PRIVATE_KEY` - Auto-generated AI agent wallet
- `YELLOW_AGENT_ADDRESS` - Agent's public address
- `YELLOW_MERCHANT_ADDRESS` - Auto-generated test merchant wallet
- `YELLOW_MERCHANT_PRIVATE_KEY` - For testing (replace in production)

**Optional:**
- `TAVILY_API_KEY` - For market research
- `KV_URL` - Redis connection (default: redis://redis:6379)

**Using Existing Wallets:**
If you have existing Yellow Network wallets, set them in `.env` before running `npm run setup`:
```bash
YELLOW_AGENT_PRIVATE_KEY=0xyour_existing_key
YELLOW_MERCHANT_ADDRESS=0xyour_existing_merchant
```

See `.env.example` for all configuration options.

## Demos

### SIWx Integration Demo (Recommended)

```bash
npm run demo:siwx
```

Demonstrates:
- First request: SIWx authentication + Yellow session creation + Payment
- Subsequent request: Session reuse without payment

### AgentKit Trading Demo (Default)

```bash
npm run demo
```

Full AI agent demo with Claude reasoning, market research, and quorum 2 settlement. Shows complete flow: agent creates session → researches stocks → pays merchant → merchant withdraws to wallet.

**Production mode:**
```bash
npm run demo:production  # Automated production flow with real USDC on Base
```

### Minimal Quorum 2 Demo

```bash
npm run minimal-session
```

Demonstrates quorum 2 governance with agent + merchant signatures. See `docs/minimal-session-demo.md` for details.

---

## Sentifi: AI cross-chain trading demo

Sentifi is an autonomous AI trading agent that combines real-time market sentiment analysis with cross-chain DeFi execution. It uses Yellow MCP for paid market intelligence and LI.FI SDK for optimal swap routing across chains.

### Architecture

![Sentifi Li.fi Trading Agent Flow](assets/sentifi-lifi-trading-flow.png)

**Autonomous Decision Loop**: 
1. **MONITOR** - Fetch sentiment data via eXpress402 MCP (prepaid Yellow sessions)
2. **DECIDE** - Analyze signals and determine strategy (bullish/bearish/neutral/rebalance)
3. **EXECUTE** - Route trades through Li.fi SDK across 30+ DEXs for best prices
4. **RECORD** - Track P&L and update portfolio state

See [detailed flow diagrams](docs/HACKATHON-FLOWS.md) for complete technical architecture.

### Features

| Feature | Description |
|---------|-------------|
| **Live Sentiment** | Real-time data from Reddit + news via Yellow MCP `market_rumors` tool |
| **Smart Analysis** | Negation detection ("not bullish" → bearish), recency weighting, engagement scoring |
| **Multi-Signal** | Combines sentiment (60%) + momentum indicators (40%) |
| **Risk Management** | Confidence-based position sizing, max drawdown limits, circuit breakers |
| **LI.FI Integration** | Real DEX quotes from Kyberswap, OKX, Uniswap across multiple chains |
| **P&L Tracking** | Entry prices, average cost basis, realized/unrealized gains |
| **Live Dashboard** | Real-time visualization at `localhost:3456` |

### Run Sentifi Demo

```bash
# Start the trading agent with dashboard
npm run demo:sentifi

# Open dashboard in browser
open http://localhost:3456
```

### Dashboard

Open `http://localhost:3456`. Use the **Rail** selector to switch between Yellow and Arc rails, then click **LOGIN** and **Analyze**.

### Module Structure

```
src/sentifi/
├── index.ts                 # Main orchestrator
├── config.ts                # Zod-validated configuration
├── types.ts                 # Core type definitions
├── providers/               # Data sources
│   ├── sentiment/           # Reddit, Tavily aggregation
│   └── price/               # Price feeds
├── signals/                 # Signal processing
│   ├── sentiment/           # Sentiment analysis engine
│   └── momentum/            # Technical indicators
├── strategies/              # Trading strategies
│   └── sentiment-momentum/  # Default combined strategy
├── risk/                    # Risk management
│   ├── position-sizer.ts    # Confidence-based sizing
│   └── circuit-breaker.ts   # Emergency stops
├── execution/               # Trade execution
│   ├── lifi-executor.ts     # LI.FI SDK integration
│   └── simulator.ts         # Demo mode
├── learning/                # Feedback loop
│   └── tracker.ts           # Prediction accuracy
└── server/                  # HTTP API + Dashboard
    └── demo.ts              # Main entry point
```

### Configuration

Configure via environment variables:

```bash
# Strategy
SENTIFI_BULLISH_THRESHOLD=40      # Score above this = bullish
SENTIFI_BEARISH_THRESHOLD=-40     # Score below this = bearish
SENTIFI_MIN_CONFIDENCE=0.5        # Minimum confidence to trade

# Risk Management
SENTIFI_MAX_POSITION_PCT=25       # Max position size (% of portfolio)
SENTIFI_CONFIDENCE_SCALING=true   # Scale size by confidence

# Execution
SENTIFI_CHAIN_ID=42161            # Arbitrum One
```

---

## Merchant Operations

### Understanding Merchant Funds

After app sessions close, merchant funds go to **Yellow Network's Unified Balance** (off-chain ledger). This is by design for efficiency and zero gas fees.

**Current merchant balance:** Check anytime with:
```bash
npm run merchant-spend -- 0xAnyAddress 0  # Shows balance in error message
```

### Transfer Unified Balance (RECOMMENDED)

Move funds to other Yellow Network accounts instantly with zero gas:

```bash
# Transfer to another Yellow account
npm run merchant-spend -- 0xRecipientAddress 10

# Example (tested):
npm run merchant-spend -- 0xe74298ea70069822eB490cb4Fb4694302e94Dbe1 1
```

**Result:**
- Instant settlement (< 1 second)
- Zero gas fees
- Off-chain transfer
- Yellow Network transaction ID for tracking

**Use Cases:**
- Pay suppliers or partners
- Transfer to personal Yellow account
- Move to account with existing channel
- Consolidate funds across accounts

### Payment Channel Offramp (FOR CUSTODY LEDGER FUNDS)

For users who deposited on-chain initially:

```bash
npm run merchant-offramp
```

**Requirements:**
- Funds in Custody contract ledger (on-chain deposits)
- Gas fees for transactions (~0.0003 ETH)
- Only works for custody ledger, not unified balance

**Process:**
1. Create payment channel (TX: Etherscan link #1)
2. Close channel (TX: Etherscan link #2)
3. Withdraw to wallet (TX: Etherscan link #3)

**See:** [Merchant fund management (archive)](docs/archive/MERCHANT-FUND-MANAGEMENT-GUIDE.md) for background and options.

## Funding (Automated in Development)

**Sandbox Mode (automatic):**
`npm run setup` automatically requests Yellow Network test tokens (ytest.usd) from the faucet if balance is below 10.

**Manual Funding (if needed):**
- Yellow Faucet: https://faucet.yellow.org/
- Asset: ytest.usd (sandbox test token)
- Or API: `curl -X POST https://clearnet-sandbox.yellow.com/faucet/requestTokens -H "Content-Type: application/json" -d '{"userAddress":"YOUR_ADDRESS"}'`

## Verify Installation

```bash
# Run tests
npm test

# Test SIWx integration (after funding wallet)
npm run demo:siwx

# AgentKit trading demo (default)
npm run demo

# Legacy client demo
npm run demo:client
```

## Debugging with Verbose Logging

Enable comprehensive operation logging:

```bash
VERBOSE_LOGGING=true npm run demo:agentkit
```

**Captures:**
- Agent setup, queries, decisions
- Wallet signing operations
- SIWx authentication flow
- MCP tool calls and results
- Yellow Network operations
- Session storage operations
- Nonce tracking (use/replay)
- Payment flow details

All logs exported with timestamps and structured data.

## Documentation

- [Judge guide](docs/JUDGES.md)
- [Docs index](docs/README.md)
- [Architecture overview](docs/ARCHITECTURE.md)
- [Payment rails comparison](docs/PAYMENT-RAILS.md)
- [Diagrams](docs/HACKATHON-FLOWS.md)
- [Demo commands](DEMO-COMMANDS.md)

## Deployment

See `docs/deployment/RAILWAY.md`.

## Development Resources

- `claude.md` - Context for Claude AI agents
- `AGENTS.md` - Guide for AI agents using this server
- `.cursor/commands/` - Quick commands for common tasks
- `docs/history/MISTAKES.md` - Lessons learned from debugging Yellow quorum 2

## Testing

```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:coverage # With coverage report
```

## Links

- [Yellow Network](https://yellow.org) - Off-chain payment infrastructure
- [LI.FI SDK](https://docs.li.fi) - Cross-chain DEX aggregation
- [x402 Specification](https://x402.org) - Payment protocol standard
- [x402 SIWx PR #921](https://github.com/coinbase/x402/pull/921) - SIWx implementation reference
- [Model Context Protocol](https://modelcontextprotocol.io) - Tool integration framework
