# 🔮 Suifi Yellow Payment Integration

## 📋 Apa yang Baru?

Integrasi **Yellow Network Payment** ke Suifi untuk:
- ✅ Memonetize akses API Suifi
- ✅ Mencegah abuse dengan rate limiting
- ✅ Pembayaran off-chain (gas fee murah)
- ✅ Free calls allowance (5 calls gratis per session)

---

## 🏗️ Arsitektur

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    YELLOW PAYMENT FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. CREATE SESSION                                                           │
│     Agent & Merchant sign quorum 2                                         │
│     Deposit 11.0 ytest.usd (sandbox)                                     │
│     ↓                                                                         │
│  2. API CALLS                                                                │
│     Call 1-5: FREE                                                          │
│     Call 6+: ~1.0 ytest.usd per call                                       │
│     ↓                                                                         │
│  3. CLOSE SESSION                                                            │
│     Remaining balance returned to agent                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 File Baru

```
src/suifi/
├── config.ts                    ✅ Yellow configuration + pricing
├── yellow/
│   ├── index.ts                 ✅ ExportYellow components
│   ├── session.ts               ✅ Session manager
│   └── mcp-server.ts            ✅ MCP server with payment check

scripts/
└── suifi-yellow-demo.ts        ✅ Demo script
```

---

## 🚀 Cara Pakai

### Mode 1: Mock Mode (Tanpa Yellow Credentials)

```bash
npm run suifi-yellow
```

Output:
```
╔════════════════════════════════════════════════════════════════╗
║              🔮 SUIFI + YELLOW NETWORK INTEGRATION                 ║
║           AI Decision Recorder with Payment Protection              ║
╚════════════════════════════════════════════════════════════════╝

📋 Step 1: Loading configuration...
⚠️  Yellow credentials not configured
   → Will use mock mode

💰 Step 3: Create payment session (mocked)
   Session ID: mock-session-12345
   Initial deposit: 11.0 ytest.usd (mocked)

🔧 Step 4: Testing MCP tools (mocked)
🔧 Tool: get_top_vaults (call #1 - FREE)
   ✅ Found 20 vaults (FREE)

🔧 Tool: get_vault_decision (call #2 - FREE)
   ✅ Decision: DEPOSIT to Turbos Finance (FREE)
```

### Mode 2: Live Mode (Dengan Yellow Credentials)

```bash
# Set environment variables
export YELLOW_AGENT_PRIVATE_KEY=0x...
export YELLOW_MERCHANT_ADDRESS=0x...
export YELLOW_MERCHANT_PRIVATE_KEY=0x...

npm run suifi-yellow
```

---

## 🔧 MCP Tools

### Tool 1: `check_session`

Cek status session dan remaining quota.

```json
{
  "hasSession": true,
  "sessionId": "0x123...",
  "callsUsed": 2,
  "callsRemaining": 9,
  "isExpired": false,
  "isExhausted": false
}
```

### Tool 2: `create_session`

Buat payment session baru.

```json
{
  "success": true,
  "sessionId": "0x456...",
  "initialAmount": 11.0,
  "assetSymbol": "ytest.usd"
}
```

### Tool 3: `get_top_vaults`

Ambil top vaults (requires payment).

**Input:**
```json
{
  "limit": 20,
  "minTvl": 100000
}
```

**Output:**
```json
{
  "success": true,
  "count": 20,
  "vaults": [
    {
      "rank": 1,
      "project": "Kriya DEX",
      "apy": 22.3,
      "tvlUsd": 8300000
    }
  ]
}
```

### Tool 4: `get_vault_decision`

Dapatkan keputusan AI (requires payment).

**Output:**
```json
{
  "success": true,
  "decision": {
    "action": "deposit",
    "project": "Kriya DEX",
    "apy": 22.3,
    "confidence": 0.75
  }
}
```

### Tool 5: `close_session`

Tutup session dan kembalikan dana.

```json
{
  "success": true,
  "message": "Session closed successfully"
}
```

---

## 💰 Model Harga

| Tier | Calls | Harga |
|------|-------|-------|
| **Free** | 5 calls pertama | Gratis |
| **Paid** | Call ke-6 dst | ~1.0 ytest.usd per call |

---

## 🔐 Environment Variables

```bash
# Yellow Network (wajib untuk live mode)
YELLOW_AGENT_PRIVATE_KEY=0x...
YELLOW_MERCHANT_ADDRESS=0x...
YELLOW_MERCHANT_PRIVATE_KEY=0x...
YELLOW_CLEARNODE_URL=wss://clearnet-sandbox.yellow.com/ws
YELLOW_ASSET_SYMBOL=ytest.usd

# Pricing (opsional)
SUIFI_PRICE_PER_CALL=1.0
SUIFI_FREE_CALLS=5
SUIFI_SESSION_DEPOSIT=11.0

# Strategy (opsional)
SUIFI_MIN_APY=10
SUIFI_MIN_TVL=100000
SUIFI_MAX_WITHDRAW_APY=3

# Database (opsional)
SUIFI_DB_PATH=./data/suifi-decisions.json
```

---

## 📊 Flow Lengkap

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        USER FLOW                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. User calls create_session                                            │
│     ├─ Agent signs session request                                        │
│     ├─ Merchant signs session request                                   │
│     ├─ Submit to Yellow Network                                         │
│     └─ Session created with 11.0 ytest.usd deposit                     │
│                                                                             │
│  2. User calls get_top_vaults (call #1)                                 │
│     ├─ Check session: Valid ✓                                           │
│     ├─ Check quota: 0/5 used (FREE) ✓                                   │
│     ├─ Fetch from DefiLlama                                            │
│     └─ Return vault data (FREE)                                          │
│                                                                             │
│  3. User calls get_vault_decision (call #2)                               │
│     ├─ Check session: Valid ✓                                           │
│     ├─ Check quota: 1/5 used (FREE) ✓                                   │
│     ├─ AI analyzes vaults                                                │
│     └─ Return decision (FREE)                                            │
│                                                                             │
│  ... (3 more free calls) ...                                                │
│                                                                             │
│  6. User calls get_top_vaults (call #6)                                  │
│     ├─ Check session: Valid ✓                                           │
│     ├─ Check quota: 6/5 used (EXHAUSTED FREE)                            │
│     ├─ Check balance: ~10.5 ytest.usd                                   │
│     ├─ Consume ~1.0 ytest.usd                                            │
│     ├─ Fetch from DefiLlama                                            │
│     └─ Return vault data (PAID)                                           │
│                                                                             │
│  7. User calls close_session                                            │
│     ├─ Agent signs close request                                         │
│     ├─ Merchant signs close request                                    │
│     ├─ Submit to Yellow Network                                         │
│     └─ Remaining ~10.0 ytest.usd returned to agent                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔍 Perbandingan dengan Sentifi

| Fitur | Sentifi | Suifi |
|--------|---------|-------|
| **Purpose** | Market research API | Vault decision API |
| **Payment per call** | ~1.15 ytest.usd | ~1.0 ytest.usd |
| **Free calls** | 0 | 5 |
| **Session deposit** | 11.0 ytest.usd | 11.0 ytest.usd |
| **Quorum** | 2 (agent + merchant) | 2 (agent + merchant) |
| **Data source** | MCP tools (Reddit, News) | DefiLlama API |

---

## 🎯 Use Cases

1. **AI Researcher**
   - Butuh analisis yield Sui secara rutin
   - Bayar sekali, pakai berkali-kali

2. **Trading Bot**
   - Integrasi ke trading bot
   - Auto-decision based on APY

3. **DeFi Dashboard**
   - Display yield data dengan monetization
   - User bayar untuk akses premium

4. **API Service**
   - Jual yield data API
   - Revenue sharing dengan Yellow Network

---

## 🤖 Auto-Evaluation (Implemented)

Suifi sekarang memiliki fitur **auto-evaluation** yang mengevaluasi keputusan secara otomatis setelah time horizon tercapai.

### Fitur Auto-Evaluation

**Evaluation Windows:** 1 hari, 7 hari, 30 hari

**Cron Schedule:** Default setiap jam (`0 * * * *`)

**Logic Evaluation:**
- **Deposit** → Benar jika APY stabil (+/- 5%)
- **Withdraw** → Benar jika APY turun
- **Hold** → Selalu neutral

### Cara Pakai

```typescript
import { createSuifiRecorder } from './src/suifi/index.js';

const recorder = createSuifiRecorder();

// Start auto-evaluator cron job
recorder.startAutoEvaluator();

// Atau trigger manual
await recorder.evaluatePending();

// Stop auto-evaluator
recorder.stopAutoEvaluator();

// Cek stats
const stats = recorder.getAutoEvalStats();
console.log(stats);
// {
//   totalDecisions: 10,
//   evaluatedDecisions: 7,
//   pendingDecisions: 3,
//   evaluationCount: 12,
//   byHorizon: { '1': 4, '7': 5, '30': 3 }
// }
```

### Demo Script

```bash
npm run suifi-auto-eval
```

Output:
```
╔════════════════════════════════════════════════════════════════╗
║              🔮 SUIFI AUTO-EVALUATOR DEMO                        ║
║           Track Decision Accuracy Over Time                     ║
╚════════════════════════════════════════════════════════════════╝

📊 Step 1: Creating sample decisions...
✅ DEPOSIT  at 15.5% APY (2026-02-05) → mock-decisio...
✅ DEPOSIT  at 18.2% APY (2026-01-30) → mock-decisio...

🔍 Step 3: Running auto-evaluation...
🔍 Evaluating 4 pending decisions...
✅ Evaluated 2 decision(s)

📈 Overall Metrics...
Total Decisions:      5
Evaluated:            3
Correct:              2
Incorrect:            1
Accuracy:             66.7%
```

---

## 🚀 Next Steps

Fitur yang bisa ditambahkan:

1. ~~**Auto-evaluation**~~ ✅ **DONE** - Evaluasi otomatis setelah 1/7/30 hari
2. **Strategy Registry** - Multiple strategies (conservative, aggressive, dll)
3. **Dashboard** - HTTP server dengan visualisasi real-time
4. **Circuit Breaker** - Stop jika accuracy drop
5. **Provider Registry** - Multiple yield data sources

---

## 📝 Catatan Penting

- ⚠️ **Sandbox Mode** - Default menggunakan testnet (ytest.usd)
- ⚠️ **Quorum 2** - Agent dan merchant harus sign semua operasi
- ⚠️ **Session TTL** - Session expire setelah 1 jam
- ⚠️ **Non-refundable** - Deposit tidak bisa di-refund (tapi balance dikembalikan saat close)

---

## 🔗 Links

- Yellow Network: https://yellow.org
- x402 Protocol: https://x402.org
- DefiLlama: https://defillama.com
