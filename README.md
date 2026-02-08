<div align="center">

# eXpress402 - Sentifi Trading Agent

  <img src="docs/assets/express402-logo.png" alt="eXpress402 Logo" width="600">

  <h3>AI cross-chain trading with real-time market sentiment</h3>

  [![Yellow](https://img.shields.io/badge/Yellow-Network-FFD700?logo=ethereum&logoColor=black)](https://yellow.org)
  [![LI.FI](https://img.shields.io/badge/LI.FI-SDK-8B5CF6?logo=ethereum&logoColor=white)](https://li.fi)
</div>

Sentifi is an autonomous AI trading agent that combines real-time market sentiment analysis with cross-chain DeFi execution. It uses Yellow Network for paid market intelligence and LI.FI SDK for optimal swap routing across chains.

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
- Real-time sentiment analysis
- Trading decisions and confidence scores
- Portfolio tracking with P&L
- Switch between Yellow and Arc payment rails

## How It Works

![Sentifi Li.fi Trading Agent Flow](assets/sentifi-lifi-trading-flow.png)

**Autonomous Decision Loop**:
1. **MONITOR** - Fetch sentiment data via eXpress402 MCP (prepaid Yellow sessions)
2. **DECIDE** - Analyze signals and determine strategy (bullish/bearish/neutral)
3. **EXECUTE** - Route trades through LI.FI SDK across 30+ DEXs for best prices
4. **RECORD** - Track P&L and update portfolio state

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

**Suifi**: Alternative Sentifi implementation using Sui blockchain. Fully complete but not integrated due to time constraints. See the [Suifi repository](https://github.com/vhspace/suifi) for details.

---

For complete documentation, architecture details, and additional demos, see [docs/README.md](docs/README.md).
