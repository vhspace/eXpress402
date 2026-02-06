# Demo Commands Reference

Quick reference for all demo commands in eXpress402.

## Primary Demos

### `npm run demo` - AgentKit Trading Demo (Default)

**What it does:** Full AI agent demo with Claude reasoning, market research, and payment flow

**Mode:** Sandbox (development) by default

**Flow:**
1. Agent creates Yellow Network app session (quorum 2)
2. Agent authenticates with SIWx (wallet signature)
3. Agent queries stock_price tool (0.1 ytest.usd)
4. Agent queries market_rumors tool (0.1 ytest.usd)
5. AI agent makes trade decision based on data
6. Session closes with quorum 2 settlement
7. Merchant receives payment in unified balance
8. Merchant offramp to wallet (optional)

**Requirements:**
- Agent wallet funded (via Yellow faucet in sandbox)
- Redis running (auto-started in devcontainer)

**Run as production:**
```bash
YELLOW_ENV=production npm run demo
```

---

### `npm run demo:production` - Automated Production Flow

**What it does:** Complete production demo with real USDC on Base mainnet

**Mode:** Production (Base mainnet)

**Flow:**
1. Checks starting balances
2. Runs agentkit demo with production config
3. Merchant offramp to wallet
4. Verifies final balances
5. Shows Basescan transaction links

**Requirements:**
- Agent has 1+ USDC in unified balance (Base)
- Agent has 0.001 ETH for gas (Base)
- Confirmation prompt (safety check)

**Interactive:** Asks for confirmation before proceeding with real money

---

## Additional Demos

### `npm run demo:siwx` - SIWx Integration Test

**What it does:** Tests SIWx authentication and session reuse

**Focus:** Wallet-based authentication without full AI agent

**Good for:** Testing auth flow independently

---

### `npm run demo:client` - Legacy Client Demo

**What it does:** Original x402 payment flow demo

**Note:** Replaced by agentkit demo as primary demo

**Good for:** Testing basic x402 without AI agent features

---

### `npm run minimal-session` - Minimal Quorum 2 Demo

**What it does:** Demonstrates quorum 2 governance

**Focus:** App session creation and closure with dual signatures

**Good for:** Understanding the signing mechanics

---

## Development Commands

### `npm run check-production` - Production Readiness Check

**What it does:** Comprehensive diagnostic tool

**Checks:**
- Wallet balances (on-chain)
- Custody balances (on-chain ledger)
- Unified balances (off-chain Yellow Network)
- Yellow Network connectivity
- Production readiness summary

**Output:** Clear action items if not ready

---

### `npm run setup` - Complete Dev Setup

**What it does:** Automated setup for sandbox development

**Steps:**
1. Generates agent wallet
2. Generates merchant wallet
3. Requests tokens from Yellow faucet
4. Installs dependencies

**Run once:** After cloning or resetting environment

---

## Mode Control

### Sandbox (Development) - Default

```bash
# All these run in sandbox mode:
npm run demo
npm run demo:siwx
npm run minimal-session
```

**Characteristics:**
- Clearnode: `wss://clearnet-sandbox.yellow.com/ws`
- Asset: `ytest.usd` (test tokens)
- Network: Sepolia testnet
- Chain ID: `eip155:84532`
- Funding: Yellow faucet (free)

### Production (Mainnet)

```bash
# Explicit production mode:
YELLOW_ENV=production npm run demo

# Or use automated script:
npm run demo:production
```

**Characteristics:**
- Clearnode: `wss://clearnet.yellow.com/ws`
- Asset: `usdc` (real USDC)
- Network: Base mainnet
- Chain ID: `eip155:8453`
- Funding: Buy on exchange ($)

---

## Quick Workflows

### First Time Setup (Sandbox)

```bash
npm run setup          # Auto-generates wallets, funds from faucet
npm run demo           # Run agentkit demo
```

### Daily Development (Sandbox)

```bash
npm run demo           # Test changes with agentkit demo
npm test               # Run unit tests
npm run lint           # Check code quality
```

### Production Testing

```bash
# 1. Check readiness
npm run check-production

# 2. Fund agent if needed
npm run agent-onramp -- 1 base

# 3. Run production demo
npm run demo:production

# 4. Verify results
npm run check-production
```

### Manual Production Flow

```bash
# Step by step control:
npm run check-production                    # Pre-check
YELLOW_ENV=production npm run demo          # Run demo
npm run merchant-offramp -- base            # Merchant withdraw
npm run check-production                    # Post-check
```

---

## Troubleshooting Commands

### Check Balances

```bash
# Production (Base mainnet)
npx tsx scripts/check-base-balance.ts

# Production comprehensive
npm run check-production

# Sandbox (via merchant-spend)
npm run merchant-spend -- 0x0 0  # Shows balance in error
```

### Check Mode

```bash
# Demo shows mode at startup:
npm run demo

# Output will show:
# Mode: DEVELOPMENT (sandbox)
# or
# Mode: PRODUCTION (mainnet)
```

### Force Specific Mode

```bash
# Force sandbox
YELLOW_ENV=development npm run demo

# Force production
YELLOW_ENV=production npm run demo

# Via URL
YELLOW_CLEARNODE_URL=wss://clearnet-sandbox.yellow.com/ws npm run demo
```

---

## Environment Variables

### Mode Control

```bash
YELLOW_ENV=production              # Force production mode
YELLOW_ENV=development             # Force sandbox mode
YELLOW_CLEARNODE_URL=<url>         # Auto-detect from URL
```

### Configuration

```bash
YELLOW_AGENT_PRIVATE_KEY=0x...     # Agent wallet (auto-generated)
YELLOW_MERCHANT_PRIVATE_KEY=0x...  # Merchant wallet (auto-generated)
ANTHROPIC_API_KEY=sk-...           # For real Claude AI (optional)
VERBOSE_LOGGING=true               # Detailed logs
```

---

## Summary

**For new users:** `npm run setup` → `npm run demo`

**For development:** `npm run demo` (tests changes in sandbox)

**For production:** `npm run demo:production` (full automated flow)

**For debugging:** `npm run check-production` (diagnostic tool)

**Legacy demos:** Available but agentkit is now primary demo
