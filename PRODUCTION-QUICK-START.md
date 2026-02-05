# Production Demo - Quick Start

Run the agentkit demo with real USDC on Base mainnet.

## Prerequisites Checklist

- [ ] Agent wallet has 1-2 USDC on Base
- [ ] Agent wallet has 0.001 ETH on Base (for gas)
- [ ] `.env` file has all wallet keys (from `npm run setup`)

Check balances:
```bash
npx tsx scripts/check-base-balance.ts
```

## One-Command Demo

```bash
npm run demo:production
```

That's it! The script will:
1. Show starting balances
2. Run the demo (agent pays merchant)
3. Merchant withdraws to wallet
4. Show final balances with Basescan links

**Expected result:**
- Agent spends: 0.2 USDC (tools) + ~$2 gas
- Merchant receives: 0.2 USDC in wallet

## Manual Step-by-Step

If you prefer more control:

```bash
# 1. Check balances
npx tsx scripts/check-base-balance.ts

# 2. Run demo on mainnet
YELLOW_ENV=production npm run demo:agentkit

# 3. Merchant withdraw
npm run merchant-offramp -- base

# 4. Verify
npx tsx scripts/check-base-balance.ts
```

## Important Notes

### App Sessions Don't Need Custody Deposit

**Common Misconception:** "I need to deposit to custody first"

**Reality:** App sessions lock funds directly from your unified balance. You DON'T need to:
- Deposit to custody beforehand
- Create channels manually
- Bridge custody → unified

**What you DO need:**
- USDC in unified balance (get via Yellow faucet or send via Yellow Network)
- OR for mainnet: Agent must have unified balance funded

### How to Fund Unified Balance (Production)

**Option 1: Receive payment** (what we're testing!)
- Someone sends you USDC via Yellow Network
- Instantly available in unified balance
- Can use for app sessions

**Option 2: Transfer from another Yellow account**
- Use `merchant-spend` script
- Transfer between Yellow Network accounts
- No blockchain fees

**Option 3: Deposit from wallet** (requires custody)
- Use `agent-onramp` script
- Deposits from Base wallet → Yellow custody
- Then manually bridge custody → unified (Yellow apps UI)

### Merchant Withdrawal (After Demo)

After receiving payment in unified balance, merchant can:

**Immediate:** Keep in unified balance
- Use for future payments
- Transfer to others on Yellow Network
- No blockchain fees

**Later:** Withdraw to wallet
- Run `merchant-offramp` script
- Moves unified → channel → custody → wallet
- Requires gas fees (~$1-2)
- Gets blockchain proof (Basescan)

## Troubleshooting

### "Insufficient balance" error

Your agent wallet needs USDC on Base. Add funds:
```bash
# Buy on Coinbase, withdraw to Base network
# OR bridge from Ethereum: https://bridge.base.org
```

### "Session creation failed"

Check Yellow Network is responding:
```bash
curl https://clearnet.yellow.com/health
```

### "Offramp failed"

Merchant can keep funds in unified balance and:
- Use for future payments
- Transfer to another account
- Retry offramp later after checking balance

## What Gets Proven

✅ Agent pays 0.2 USDC for MCP research tools
✅ Merchant receives 0.2 USDC in wallet
✅ All transactions on Base blockchain (Basescan proof)
✅ SIWx authentication (wallet signatures)
✅ Quorum 2 settlement (multi-sig governance)
✅ Production Yellow Network integration

## Cost

- USDC for session: 1 USDC (get 0.8 back)
- Tools: 0.2 USDC (merchant keeps)
- Gas: ~$2-3 total
- **Net cost: 0.2 USDC + $2-3 gas**

## Full Documentation

See `MAINNET-PRODUCTION-GUIDE.md` for complete details.

## Questions?

1. Check `MAINNET-PRODUCTION-GUIDE.md`
2. Check Yellow Network docs: https://docs.yellow.org
3. Open an issue with error details
