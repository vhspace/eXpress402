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

Web3 agents need market data, but traditional per-call blockchain transactions create bottlenecks and excessive fees. eXpress402 solves this by combining x402 payment protocol with Yellow Network's off-chain channels - agents fund a prepaid session once, then make thousands of market data queries without individual blockchain transactions. Perfect for AI agents running high-frequency trading strategies, portfolio analysis, or market research.

## Architecture

![x402 v2 + Yellow offchain MCP architecture](docs/assets/x402-yellow-architecture.png)

## Features

- **Prepaid Payment Sessions**: Fund once via x402, query thousands of times without additional transactions
- **Off-Chain Settlement**: Yellow Network channels eliminate per-call blockchain fees
- **Real Market Data**: Live stock prices, market sentiment, and financial news from production APIs
- **Agent-Optimized**: Built for MCP-compatible AI agents requiring high-volume data access

## Quick Start

```bash
npm install
npm run dev
```

## MCP Configuration

The server is pre-configured in `.cursor/mcp.json`. For other MCP clients, see [docs/x402-yellow-extension.md](docs/x402-yellow-extension.md).

## Environment Setup

Required:
- `YELLOW_MERCHANT_ADDRESS` - Your payment recipient address
- `TAVILY_API_KEY` - For market research (optional)

See [docs/](docs/) for complete setup and configuration details.

## Demo

Run the complete paid workflow:

```bash
npm run demo
```

This demonstrates the full payment flow from funding to tool usage with balance tracking. It also includes an offline MCP scenario that closes the app session and reclaims unused allocation to show offchain wallet safety.

## Documentation

- [x402 Yellow Extension](docs/x402-yellow-extension.md) - Payment protocol details
- [Setup Guide](docs/) - Complete environment and deployment instructions
- [API Reference](docs/) - Tool specifications and examples

## Links

- [Yellow Network](https://yellow.org) - Off-chain payment infrastructure
- [x402 Specification](https://x402.org) - Payment protocol standard
- [Model Context Protocol](https://modelcontextprotocol.io) - Tool integration framework