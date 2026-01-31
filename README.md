# x402 + Yellow MCP Demo

Hackathon demo MCP server implementing x402 v2 payments with Yellow off-chain settlement (Nitro RPC). Exposes paid financial tools backed by real data sources (no mocks).

## What this provides

- **Paid MCP tools**:
  - `stock_price` - latest OHLCV from Stooq CSV
  - `market_rumors` - Reddit JSON + Tavily Search results
- **x402 v2 MCP transport**: payment required via JSON-RPC error `code: 402`, payment payload via `_meta["x402/payment"]`.
- **Yellow off-chain settlement**: verify transfers via the hosted sandbox clearnode.

## Data sources (no mocks)

- Stooq CSV: `https://stooq.com/q/d/l/`
- Reddit JSON: `https://www.reddit.com/r/stocks/search.json`
- Tavily Search API: `https://api.tavily.com/search`

## Requirements

- Node.js 20+
- Yellow sandbox clearnode access: `wss://clearnet-sandbox.yellow.com/ws`
- Tavily API key set in shell env

## Setup

```bash
npm install
```

## Environment variables

Required:

- `YELLOW_MERCHANT_ADDRESS` - recipient wallet address for off-chain transfers
- `TAVILY_API_KEY` - Tavily API key (from your shell env)

Optional (defaults shown):

- `YELLOW_CLEARNODE_URL` (default: `wss://clearnet-sandbox.yellow.com/ws`)
- `YELLOW_ASSET_SYMBOL` (default: `usdc`)
- `YELLOW_PRICE_PER_CALL` (default: `0.1`)
- `YELLOW_NETWORK` (default: `yellow:sandbox`)
- `YELLOW_MAX_TIMEOUT_SECONDS` (default: `60`)
- `REDDIT_USER_AGENT` (default: `x402-yellow-mcp/0.1`)
- `YELLOW_AUTH_DOMAIN` (default: `Nitrolite`)
- `YELLOW_DEBUG` (set to `true` to log raw Nitro RPC traffic)

For demo client:

- `YELLOW_AGENT_PRIVATE_KEY` - agent private key for signing Yellow Nitro RPC requests
- `YELLOW_AGENT_ADDRESS` - optional agent address (informational only)

For merchant spend (optional):

- `YELLOW_MERCHANT_PRIVATE_KEY` - private key for the merchant wallet (to spend received funds)

For app-session shared budget (stretch):

- `YELLOW_APP_SESSION_PARTICIPANTS` - comma-separated addresses
- `YELLOW_APP_SESSION_ALLOCATIONS` - JSON map of address to amount

## Run the MCP server

```bash
npm run dev
```

The server listens on stdio. Do not log to stdout.

## Demo: generate a payment payload

This script performs a Yellow off-chain transfer and prints the `PaymentPayload` you can attach to an MCP tool call.

```bash
npm run demo
```

## Merchant spend (optional)

Send funds from the merchant wallet to another address:

```bash
npm run merchant-spend -- 0xDestinationAddress 0.05
```

## App session init (stretch)

Create a shared-budget app session:

```bash
export YELLOW_APP_SESSION_PARTICIPANTS="0xAgent1,0xAgent2"
export YELLOW_APP_SESSION_ALLOCATIONS='{"0xAgent1":"5000000","0xAgent2":"5000000"}'
npm run app-session-init
```

## Example MCP tool call (JSON-RPC)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "stock_price",
    "arguments": { "symbol": "AAPL" },
    "_meta": {
      "x402/payment": {
        "x402Version": 2,
        "accepted": {
          "scheme": "yellow-offchain",
          "network": "yellow:sandbox",
          "amount": "0.1",
          "asset": "usdc",
          "payTo": "0xMerchantAddress",
          "maxTimeoutSeconds": 60,
          "extra": { "settlement": "yellow" }
        },
        "payload": {
          "transferId": "12345",
          "payer": "0xBuyerAddress",
          "amount": "0.1",
          "asset": "usdc",
          "to": "0xMerchantAddress"
        }
      }
    }
  }
}
```

## Extension doc

See `docs/x402-yellow-extension.md` for the extension schema and examples.
