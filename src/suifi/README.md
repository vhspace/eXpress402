# 🔮 Suifi - Sui Decision Recorder

AI decision recorder for Sui network vault investments using DefiLlama yield data.

## What It Does

- **Fetches** yield data from DefiLlama for Sui chain
- **Analyzes** vaults by APY, TVL, and safety factors
- **Makes** deposit/withdraw decisions based on configurable strategy
- **Records** all decisions for learning and evaluation
- **Evaluates** past decisions to track accuracy

## Architecture

```
DefiLlama API → Scoring → Strategy Decision → Record → Evaluate → Learn
```

## Quick Start

### Run a Decision Cycle

```bash
npm run suifi-demo
# or
npx tsx scripts/suifi-demo.ts
```

This will:
1. Fetch current yields from DefiLlama
2. Score and rank vaults
3. Make a decision (deposit/withdraw/hold)
4. Record the decision to disk

### Evaluate Pending Decisions

```bash
npm run suifi-evaluate
# or
npx tsx scripts/suifi-evaluate.ts
```

This will:
1. Fetch current yields from DefiLlama
2. Compare with recorded decisions
3. Mark decisions as correct/incorrect
4. Update accuracy metrics

### View Metrics

```bash
npm run suifi-metrics
# or
npx tsx scripts/suifi-metrics.ts
```

## Example Output

```
╔════════════════════════════════════════════════════════════════╗
║                    🔮 SUIFI DECISION RECORDER                  ║
║                   Sui Vault AI Decision Tracker                ║
╚════════════════════════════════════════════════════════════════╝

🚀 Starting Suifi Decision Cycle...

📡 Fetching yields from DefiLlama...
✅ Found 20 vaults

🏆 Top Vaults by Score:

  Rank  Project              Pool                APY      TVL        Score   Conf.
  ───── ──────────────────── ─────────────────── ──────── ───────── ─────── ──────
     1  Kriya DEX            SUI Staking         22.3%    $8.3M     54.6    75%
     2  Turbos Finance       USDT-SUI LP         15.5%    $12.5M   41.0    70%
     3  Navi Protocol        USDC Lending        8.5%     $25.0M   27.0    80%

🤖 Analyzing and making decision...

📊 Decision:
  Action:      DEPOSIT
  Project:     Kriya DEX
  Pool:        SUI Staking
  APY:         22.3%
  TVL:         $8.3M
  Confidence:  75%
  Risk:        MEDIUM
  Reason:      High APY (22.3%) with solid TVL ($8.3M)

✅ Decision recorded: suifi-decision-1234567890

📈 All-Time Metrics:
  Total Decisions:      47
  Evaluated:            12
  Accuracy:             70.8%
```

## How Decisions Are Made

### Scoring Formula

```
Score = (APY × 2) + (TVL Score) + (Safety Bonus)

TVL Score:
  < $100K    = 0
  $100K-$1M  = 5
  $1M-$10M   = 10
  $10M-$50M  = 15
  > $50M     = 20

Safety Bonus:
  Stablecoin = +10
  Others     = 0
```

### Decision Logic

```
IF APY >= 15% AND TVL >= $1M AND Score >= 30:
  → DEPOSIT

ELSE IF APY <= 5%:
  → WITHDRAW

ELSE:
  → HOLD
```

### Risk Assessment

```
LOW:
  - Stablecoin
  - TVL > $10M
  - APY < 20%

HIGH:
  - APY > 30%
  - TVL < $500K

MEDIUM:
  - Everything else
```

## Configuration

### Strategy Config

```typescript
{
  minApyForDeposit: 15,      // Minimum APY to trigger deposit
  minTvlUsd: 1000000,         // Minimum TVL requirement
  maxApyForWithdraw: 5,      // Maximum APY to trigger withdraw
  highApyThreshold: 30,      // APY threshold for high risk
  stablecoinBonus: 10,       // Score bonus for stablecoins
  apyWeight: 2,              // Weight for APY in score
  tvlWeight: 1,              // Weight for TVL in score
}
```

### Tracker Config

```typescript
{
  dbPath: './data/suifi-decisions.json',  // Where decisions are stored
  autoSave: true,                          // Auto-save after each record
  evaluationDays: [1, 7, 30]              // Days to evaluate after
}
```

## Data Storage

Decisions are stored in `./data/suifi-decisions.json`:

```json
[
  {
    "decision": {
      "id": "suifi-decision-1234567890",
      "timestamp": "2025-01-15T10:30:00.000Z",
      "action": "deposit",
      "project": "Kriya DEX",
      "pool": "SUI Staking",
      "symbol": "SUI",
      "apyAtDecision": 22.3,
      "tvlAtDecision": 8300000,
      "confidence": 0.75,
      "reason": "High APY with solid TVL",
      "expectedApy": 22.3,
      "riskLevel": "medium",
      "score": 54.6,
      "evaluated": false
    }
  }
```

## Evaluation

Decisions are evaluated after some time by:

1. Fetching current vault data from DefiLlama
2. Comparing current APY/TVL with recorded values
3. Determining if decision was correct:
   - **Deposit**: Correct if APY didn't drop significantly (> -5%)
   - **Withdraw**: Correct if APY dropped
   - **Hold**: Always neutral

## Learning Metrics

Track performance over time:

- **Overall Accuracy**: Percentage of correct decisions
- **By Action**: Accuracy for deposit/withdraw/hold
- **By Project**: Which projects perform best
- **Best Project**: Highest accuracy project
- **Avg Confidence**: Average confidence level
- **Avg APY**: Average APY at decision time

## Project Structure

```
src/suifi/
├── types.ts              # Type definitions
├── providers/
│   └── defillama.ts      # DefiLlama API client
├── strategy.ts           # Decision strategy
├── tracker.ts            # Record & evaluate decisions
├── index.ts              # Main orchestrator
└── README.md             # This file

scripts/
├── suifi-demo.ts         # Run decision cycle
├── suifi-evaluate.ts     # Evaluate pending decisions
└── suifi-metrics.ts      # View all metrics

data/
└── suifi-decisions.json  # Stored decisions
```

## Comparison with Sentifi

| Feature | Sentifi | Suifi |
|---------|---------|-------|
| Data Source | Reddit, News, Price | DefiLlama Yields |
| Decision | Buy/Sell tokens | Deposit/Withdraw vaults |
| Execution | LI.FI → DEX | None (record only) |
| Track | Price prediction | APY prediction |
| Evaluate | 1h, 4h, 24h | Manual trigger |

## Future Enhancements

- [ ] Automated periodic evaluation
- [ ] Multiple strategy support
- [ ] Backtesting on historical data
- [ ] Web dashboard
- [ ] Alert notifications for major APY changes
- [ ] Portfolio optimization suggestions

## License

MIT
