<div align="center">

# eXpress402 - Sentifi Trading Agent

  <img src="docs/assets/express402-logo.png" alt="eXpress402 Logo" width="600">

  <h3>AI cross-chain trading with real-time market sentiment</h3>

  [![Yellow](https://img.shields.io/badge/Yellow-Network-FFD700?logo=ethereum&logoColor=black)](https://yellow.org)
  [![LI.FI](https://img.shields.io/badge/LI.FI-SDK-8B5CF6?logo=ethereum&logoColor=white)](https://li.fi)
  [![x402](https://img.shields.io/badge/x402-v2-0066CC?logo=protocol&logoColor=white)](https://x402.org)
  [![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-1.9+-FF6B35?logo=openai&logoColor=white)](https://modelcontextprotocol.io)

  [![CI](https://github.com/vhspace/eXpress402/workflows/CI/badge.svg)](https://github.com/vhspace/eXpress402/actions)
  [![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
</div>

eXpress402 is a paid MCP server infrastructure for AI agents, implementing x402 v2 with wallet authentication. It provides two payment rails for accessing premium tools and data.

## Payment Rails

### Yellow Network Support
Off-chain session-based payments with instant settlement:
- **Pay once, call many times** - Create a session, make unlimited paid calls without per-transaction fees
- **SIWx authentication** - Wallet-based identity using CAIP-122 message signing
- **Sub-millisecond lookups** - Session mapping stored in Redis for instant authentication
- **Zero gas fees** - All payments settled off-chain on Yellow Network

### Arc + Circle Gateway Support
On-chain payments with blockchain proof:
- **USDC payments** - Pay with Circle USDC on Arc Testnet
- **On-chain verification** - Every payment recorded on-chain for full transparency
- **Circle Gateway integration** - Seamless USDC handling through Circle's infrastructure
- **Blockchain receipts** - Verifiable payment proofs on Arc Testnet

## Sentifi: Demo Trading Agent

Sentifi demonstrates eXpress402 in action - an autonomous AI trading agent that combines real-time market sentiment analysis with cross-chain DeFi execution. It uses eXpress402 MCP tools for paid market intelligence and LI.FI SDK for optimal swap routing across chains.

## Wallet Setup

Generate an AI agent wallet for authentication and payments:

```bash
npm run generate-wallet
```

This creates:
- `YELLOW_AGENT_PRIVATE_KEY` - Your AI agent's wallet private key
- `YELLOW_AGENT_ADDRESS` - Your AI agent's public address

The wallet will be automatically funded with test tokens via Yellow Network faucet.

## Environment Setup

Required environment variables (auto-configured by setup):

```bash
# Agent Wallet (auto-generated)
YELLOW_AGENT_PRIVATE_KEY=0x...
YELLOW_AGENT_ADDRESS=0x...

# Merchant Wallet (auto-generated)
YELLOW_MERCHANT_ADDRESS=0x...
YELLOW_MERCHANT_PRIVATE_KEY=0x...

# Optional: Market Research
TAVILY_API_KEY=your_tavily_key

# Optional: Redis (default works in devcontainer)
KV_URL=redis://redis:6379
```

Copy `.env.example` to `.env` and run:

```bash
npm run setup  # Generates wallets, funds them, installs dependencies
```

## Run Sentifi

Start the trading agent with live dashboard:

```bash
npm run demo:sentifi

# Open dashboard in browser
open http://localhost:3456
```

The dashboard provides:
- **Payment rail selector** - Switch between Yellow Network (off-chain) and Arc Gateway (on-chain)
- **Real-time sentiment analysis** - Live market data from Reddit and news sources
- **Trading decisions** - AI-powered strategy with confidence scores
- **Portfolio tracking** - Real-time P&L and position monitoring

## How Sentifi Uses eXpress402

![Sentifi Li.fi Trading Agent Flow](assets/sentifi-lifi-trading-flow.png)

**Autonomous Decision Loop**:
1. **MONITOR** - Fetch sentiment data via eXpress402 MCP tools (choose Yellow or Arc rail)
2. **DECIDE** - Analyze signals and determine strategy (bullish/bearish/neutral)
3. **EXECUTE** - Route trades through LI.FI SDK across 30+ DEXs for best prices
4. **RECORD** - Track P&L and update portfolio state

The dashboard lets you switch between payment rails to see both Yellow Network (off-chain) and Arc Gateway (on-chain) in action.

## Configuration

Customize trading behavior via environment variables:

```bash
# Strategy Thresholds
SENTIFI_BULLISH_THRESHOLD=40      # Score above this = buy signal
SENTIFI_BEARISH_THRESHOLD=-40     # Score below this = sell signal
SENTIFI_MIN_CONFIDENCE=0.5        # Minimum confidence to trade

# Risk Management
SENTIFI_MAX_POSITION_PCT=25       # Max position size (% of portfolio)
SENTIFI_CONFIDENCE_SCALING=true   # Scale size by confidence

# Execution
SENTIFI_CHAIN_ID=42161            # Chain ID (Arbitrum One)
```

## Additional Projects

**Suifi**: Alternative implementation using Sui blockchain for AI vault investment decisions. Records and evaluates DeFi vault strategies using DefiLlama data. Fully implemented in `src/suifi/` but not integrated into the main demo due to time constraints.

---

For complete documentation, architecture details, and additional demos, see [docs/README.md](docs/README.md).
