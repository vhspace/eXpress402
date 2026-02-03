# Guide for AI Agents Using eXpress402

## Quick Start

This MCP server provides paid financial tools using x402 v2 with wallet authentication.

### 1. Get a Wallet

You need an EOA wallet (private key based). Generate one:

```bash
npm run generate-wallet
```

This creates `YELLOW_AGENT_PRIVATE_KEY` and `YELLOW_AGENT_ADDRESS` in `.env`.

### 2. Fund Your Wallet

Get test tokens for your agent address (shown after wallet generation).

### 3. Use the MCP Server

```bash
npm run dev  # Start server
```

Available tools:
- `stock_price(symbol)` - Get OHLCV data
- `market_rumors(symbol)` - Get Reddit/Tavily market sentiment

## How Payment Works

**First call to any tool:**

1. Server returns 402 Payment Required with SIWx challenge
2. Your agent signs the message with its wallet
3. Creates Yellow payment session
4. Pays for access
5. Server stores your wallet → session mapping
6. Returns data

**Subsequent calls:**

1. Your agent sends the same signed message
2. Server finds existing session (no payment needed)
3. Returns data instantly

## Authentication Flow

The server uses CAIP-122 SIWx (Sign-In-With-X) for wallet authentication:

1. Server provides a challenge (nonce, domain, resource URI)
2. Agent signs: `${domain} wants you to sign in with your blockchain account: ${address}...`
3. Server verifies signature matches agent address
4. Server checks if wallet has existing session
5. If yes: reuse session. If no: create new session.

## Session Storage

Sessions are stored in Redis (local) or Vercel KV (production):

- Key: `session:${walletAddress}:${resourceUrl}`
- Value: Yellow session ID
- Lookup time: sub-millisecond

## Error Handling

- **402 Payment Required**: Normal on first request. Sign and pay.
- **Nonce replay detected**: Don't reuse old signatures.
- **Redis connection failed**: Check Redis is running (`redis-cli -h redis ping`).

## Example Integration

```typescript
import { privateKeyToAccount } from 'viem/accounts';
import { createSIWxPayload, encodeSIWxHeader } from './x402/siwx/client';

// Your agent wallet
const agent = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);

// On 402 response:
const siwxChallenge = response.extensions['sign-in-with-x'].info;
const siwxInfo = {
  ...siwxChallenge,
  chainId: response.extensions['sign-in-with-x'].supportedChains[0].chainId,
  type: 'eip191' as const,
};

// Sign message
const siwxPayload = await createSIWxPayload(siwxInfo, agent);
const siwxHeader = encodeSIWxHeader(siwxPayload);

// Send with retry:
const result = await mcpClient.callTool(
  { name: 'stock_price', arguments: { symbol: 'AAPL' } },
  { _meta: { 'SIGN-IN-WITH-X': siwxHeader } }
);
```

See `src/siwx-demo.ts` for complete implementation.

## Wallet Requirements

**Supported (for AI agents):**
- EOA with private key (recommended, what we generate)
- viem/ethers programmatic wallets

**Not Supported (require user interaction):**
- MetaMask
- Hardware wallets (Ledger, Trezor)
- Browser extension wallets

## Testing

```bash
# Run SIWx integration demo
npm run demo:siwx

# View stored sessions
redis-cli -h redis keys "session:*"

# Check specific session
redis-cli -h redis get "session:0x...:mcp://tool/stock_price"
```
