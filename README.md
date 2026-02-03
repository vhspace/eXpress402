<div align="center">

# eXpress402

  <img src="docs/assets/express402-logo.png" alt="eXpress402 Logo" width="600">

  <h3>⚡ Extreme DeFi Payments for AI Agents ⚡</h3>

  [![ETHGlobal HackMoney](https://img.shields.io/badge/ETHGlobal-HackMoney-7B3FE4?logo=ethereum&logoColor=white)](https://hackmoney.ethglobal.com/)
  [![Yellow](https://img.shields.io/badge/Yellow-Network-FFD700?logo=ethereum&logoColor=black)](https://yellow.org)
  [![x402](https://img.shields.io/badge/x402-v2-0066CC?logo=protocol&logoColor=white)](https://x402.org)
  [![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-1.9+-FF6B35?logo=openai&logoColor=white)](https://modelcontextprotocol.io)

  [![CI](https://github.com/vhspace/eXpress402/workflows/CI/badge.svg)](https://github.com/vhspace/eXpress402/actions)
  [![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
</div>

A paid MCP server for web3 agents to access real-time market data at scale. Set up once with x402 on Yellow Network's off-chain payment channels, then make unlimited queries without per-transaction blockchain fees. Built for high-volume agent workflows requiring bulk financial data.

## Overview

Web3 agents need market data, but traditional per-call blockchain transactions create bottlenecks and excessive fees. eXpress402 solves this by combining x402 v2 with SIWx wallet authentication and Yellow Network's off-chain channels - agents authenticate once with their wallet, pay once for a session, then make unlimited queries without additional payments or authentication. Perfect for AI agents running high-frequency trading strategies, portfolio analysis, or market research.

## Architecture: SIWx + Yellow Network

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant Server as MCP Server
    participant Redis as Redis/Vercel KV
    participant Yellow as Yellow Network

    Note over Agent,Yellow: First Request - Authenticate and Pay
    Agent->>Server: GET /stock_price
    Server->>Agent: 402 Payment Required + SIWx challenge + Yellow info
    Agent->>Agent: Sign SIWx message (prove wallet)
    Agent->>Yellow: Create payment session (pay once)
    Yellow-->>Agent: session ID
    Agent->>Server: Request + SIGN-IN-WITH-X header + Yellow session
    Server->>Server: Verify SIWx signature
    Server->>Redis: Store wallet to session mapping
    Server->>Agent: 200 OK + stock data

    Note over Agent,Yellow: Subsequent Requests - Reuse Session
    Agent->>Server: GET /market_rumors + SIGN-IN-WITH-X header
    Server->>Redis: Lookup session (sub-millisecond)
    Redis-->>Server: Found session ID
    Server->>Agent: 200 OK + market data (no payment needed!)
```

**Key Innovation: Pay Once, Call Many Times**

- First call: Authenticate with wallet signature + Create Yellow session + Pay
- Subsequent calls: Verify signature + Reuse session + No payment
- Sub-millisecond session lookup (Redis/Vercel KV)
- Standards-compliant (x402 v2 + CAIP-122 SIWx)

## Features

### 🎉 NEW: Full Quorum 2 Support!

The minimal session demo (`npm run minimal-session`) now demonstrates **complete quorum 2 governance** where both agent AND merchant sign all operations:
- ✅ `create_app_session` with quorum 2
- ✅ `close_app_session` with quorum 2
- ✅ Full balance verification at each step
- ✅ Merchant payment confirmed

See `QUORUM-2-SOLVED.md` for the technical breakthrough!

### Core Features

- **Prepaid Payment Sessions**: Fund once via x402, query thousands of times without additional transactions
- **Off-Chain Settlement**: Yellow Network channels eliminate per-call blockchain fees
- **Real Market Data**: Live stock prices, market sentiment, and financial news from production APIs
- **Agent-Optimized**: Built for MCP-compatible AI agents requiring high-volume data access

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

Auto-configured in devcontainer. For local setup:

Required:
- `YELLOW_AGENT_PRIVATE_KEY` - Generated by `npm run generate-wallet`
- `YELLOW_MERCHANT_ADDRESS` - Your payment recipient address

Optional:
- `TAVILY_API_KEY` - For market research
- `KV_URL` - Redis connection (default: redis://redis:6379)

See `.env.example` for all configuration options.

## Demos

### SIWx Integration Demo (Recommended)

```bash
npm run demo:siwx
```

Demonstrates:
- First request: SIWx authentication + Yellow session creation + Payment
- Subsequent request: Session reuse without payment

### Full Yellow Session Demo

```bash
npm run demo
```

Complete paid workflow with balance tracking and session lifecycle.

### Minimal Quorum 2 Demo

```bash
npm run minimal-session
```

Demonstrates quorum 2 governance with agent + merchant signatures. See `QUORUM-2-SOLVED.md` for technical details.

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
```

## Documentation

- [x402 Yellow Extension](docs/x402-yellow-extension.md) - Payment protocol details
- [Setup Guide](docs/) - Complete environment and deployment instructions
- [API Reference](docs/) - Tool specifications and examples

## Deployment to Vercel

```bash
# One-time: Create Vercel KV store
vercel kv create express402-sessions

# Deploy
vercel --prod
```

Environment variables are auto-injected by Vercel. No manual configuration needed.

## Development Resources

- `claude.md` - Context for Claude AI agents
- `AGENTS.md` - Guide for AI agents using this server
- `.cursor/commands/` - Quick commands for common tasks
- `MISTAKES.md` - Lessons learned from debugging Yellow quorum 2

## Testing

```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:coverage # With coverage report
```

## Links

- [Yellow Network](https://yellow.org) - Off-chain payment infrastructure
- [x402 Specification](https://x402.org) - Payment protocol standard
- [x402 SIWx PR #921](https://github.com/coinbase/x402/pull/921) - SIWx implementation reference
- [Model Context Protocol](https://modelcontextprotocol.io) - Tool integration framework
