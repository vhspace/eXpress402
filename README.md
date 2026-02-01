<div align="center">
  
# eXpress402

  <img src="docs/assets/express402-logo.png" alt="eXpress402 Logo" width="600">
  
  <h3>⚡ Lightning-Fast Payments for AI Agents ⚡</h3>
  
  [![ETHGlobal HackMoney](https://img.shields.io/badge/ETHGlobal-HackMoney-7B3FE4?logo=ethereum&logoColor=white)](https://hackmoney.ethglobal.com/)
  [![Yellow](https://img.shields.io/badge/Yellow-Network-FFD700?logo=ethereum&logoColor=black)](https://yellow.org)
  [![x402](https://img.shields.io/badge/x402-v2-0066CC?logo=protocol&logoColor=white)](https://x402.org)
  [![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-1.9+-FF6B35?logo=openai&logoColor=white)](https://modelcontextprotocol.io)
  
  [![CI](https://github.com/vhspace/eXpress402/workflows/CI/badge.svg)](https://github.com/vhspace/eXpress402/actions)
  [![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
</div>

A paid MCP server implementing x402 v2 payments with Yellow off-chain settlement. Provides financial data tools with real cryptocurrency payments - no mocks.

## Overview

This project demonstrates monetized AI tools using the Model Context Protocol (MCP) with integrated blockchain payments. Users pay for API calls using Yellow's off-chain payment network, enabling true pay-per-use AI services.

## Architecture

![x402 v2 + Yellow offchain MCP architecture](docs/assets/x402-yellow-architecture.png)

## Features

- **Paid MCP Tools**: Stock prices and market analysis with real payments
- **x402 Payment Protocol**: JSON-RPC payment integration
- **Yellow Settlement**: Off-chain cryptocurrency transfers
- **Real Data Sources**: Live financial APIs (Stooq, Reddit, Tavily)

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

This demonstrates the full payment flow from funding to tool usage with balance tracking.

## Documentation

- [x402 Yellow Extension](docs/x402-yellow-extension.md) - Payment protocol details
- [Setup Guide](docs/) - Complete environment and deployment instructions
- [API Reference](docs/) - Tool specifications and examples

## Links

- [Yellow Network](https://yellow.org) - Off-chain payment infrastructure
- [x402 Specification](https://x402.org) - Payment protocol standard
- [Model Context Protocol](https://modelcontextprotocol.io) - Tool integration framework