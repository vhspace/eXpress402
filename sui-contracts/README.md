# eXpress402 Sui Contracts

**Written from scratch for Sui HackMoney 2025**

Smart contracts enabling AI-driven trading on Sui blockchain.

## What's New

These contracts were written **entirely after Jan 30, 2026** for this hackathon. They demonstrate:

- **AI Authorization**: Capability-based permissions for autonomous agents
- **Simple Vault Management**: Deposit/withdraw with user balance tracking
- **Learning Foundation**: Structure designed for parallel execution (future work)

## Why Sui?

Sui's object model and Move language provide:
- Safe capability patterns for AI agent authorization
- Fast finality for real-time trading
- Low gas costs for frequent rebalancing

## Contracts

### `ai_vault.move`
Main vault contract for user deposits and AI management.

### `test_token.move`
Test token with faucet for demo purposes.

## Build & Test

```bash
# Build contracts
sui move build

# Run tests
sui move test

# Deploy to testnet
sui client publish --gas-budget 100000000
```

## Integration with eXpress402

These contracts integrate with the eXpress402 MCP server:
1. Sentifi agent analyzes sentiment via eXpress402 MCP
2. Agent makes trading decisions
3. Executes trades through Sui vaults (these contracts)

## Timeline

- **Jan 30 9am+**: Research Sui/Move patterns
- **Feb 7**: Implemented original contracts
- **All code**: Written after hackathon start

## Team Learning Process

Our teammate studied existing Sui DeFi projects to understand:
- Move language syntax
- Vault architecture patterns
- Capability-based authorization

Then wrote these contracts from scratch, applying learned patterns to our
AI trading use case.
