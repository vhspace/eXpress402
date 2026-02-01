# eXpress402

Hackathon demo MCP server implementing x402 v2 payments with Yellow off-chain settlement (Nitro RPC). Exposes paid financial tools backed by real data sources (no mocks).

## Architecture sketch

![x402 v2 + Yellow offchain MCP architecture](docs/assets/x402-yellow-architecture.png)

## Cursor MCP config

Add this server to `.cursor/mcp.json`:

```json
"eXpress402-mcp": {
  "command": "npm",
  "args": ["run", "dev"],
  "env": {
    "YELLOW_MERCHANT_ADDRESS": "${env:YELLOW_MERCHANT_ADDRESS}",
    "YELLOW_MERCHANT_PRIVATE_KEY": "${env:YELLOW_MERCHANT_PRIVATE_KEY}",
    "YELLOW_CLEARNODE_URL": "${env:YELLOW_CLEARNODE_URL}",
    "YELLOW_ASSET_SYMBOL": "${env:YELLOW_ASSET_SYMBOL}",
    "YELLOW_PRICE_PER_CALL": "${env:YELLOW_PRICE_PER_CALL}",
    "YELLOW_NETWORK": "${env:YELLOW_NETWORK}",
    "YELLOW_MAX_TIMEOUT_SECONDS": "${env:YELLOW_MAX_TIMEOUT_SECONDS}",
    "YELLOW_AGENT_ADDRESS": "${env:YELLOW_AGENT_ADDRESS}",
    "TAVILY_API_KEY": "${env:TAVILY_API_KEY}",
    "REDDIT_USER_AGENT": "${env:REDDIT_USER_AGENT}",
    "YELLOW_DEBUG": "${env:YELLOW_DEBUG}"
  }
}
```

Add to Cursor:

[![Add eXpress402-mcp to Cursor](https://cursor.com/deeplink/mcp-install-dark.png)](cursor://anysphere.cursor-deeplink/mcp/install?name=eXpress402-mcp&config=eyJjb21tYW5kIjoibnBtIiwiYXJncyI6WyJydW4iLCJkZXYiXSwiZW52Ijp7IllFTExPV19NRVJDSEFOVF9BRERSRVNTIjoiJHtlbnY6WUVMTE9XX01FUkNIQU5UX0FERFJFU1N9IiwiWUVMTE9XX01FUkNIQU5UX1BSSVZBVEVfS0VZIjoiJHtlbnY6WUVMTE9XX01FUkNIQU5UX1BSSVZBVEVfS0VZfSIsIllFTExPV19DTEVBUk5PREVfVVJMIjoiJHtlbnY6WUVMTE9XX0NMRUFSTk9ERV9VUkx9IiwiWUVMTE9XX0FTU0VUX1NZTUJPTCI6IiR7ZW52OllFTExPV19BU1NFVF9TWU1CT0x9IiwiWUVMTE9XX1BSSUNFX1BFUl9DQUxMIjoiJHtlbnY6WUVMTE9XX1BSSUNFX1BFUl9DQUxMfSIsIllFTExPV19ORVRXT1JLIjoiJHtlbnY6WUVMTE9XX05FVFdPUkt9IiwiWUVMTE9XX01BWF9USU1FT1VUX1NFQ09ORFMiOiIke2VudjpZRUxMT1dfTUFYX1RJTUVPVVRfU0VDT05EU30iLCJZRUxMT1dfQUdFTlRfQUREUkVTUyI6IiR7ZW52OllFTExPV19BR0VOVF9BRERSRVNTfSIsIlRBVklMWV9BUElfS0VZIjoiJHtlbnY6VEFWSUxZX0FQSV9LRVl9IiwiUkVERElUX1VTRVJfQUdFTlQiOiIke2VudjpSRURESVRfVVNFUl9BR0VOVH0iLCJZRUxMT1dfREVCVUciOiIke2VudjpZRUxMT1dfREVCVUd9In19)

Cursor command for stock quotes (dev workflow): `.cursor/commands/get-stock-quote.md`

## Claude MCP config (API)

Claude’s MCP support expects **URL-based** servers in the API request (`mcp_servers`), not stdio. To use this server with Claude, you’d need to host it behind an HTTP/SSE MCP endpoint.

Example request fragment:

```json
{
  "mcp_servers": [
    {
      "name": "eXpress402-mcp",
      "type": "url",
      "url": "https://your-hosted-mcp.example.com/mcp"
    }
  ]
}
```

No official “Add to Claude” button/deeplink is documented yet. Claude MCP servers are configured per API request. See Anthropic docs for `mcp_servers`: [https://platform.claude.com/docs/en/api/beta](https://platform.claude.com/docs/en/api/beta)

## Billing model (offchain default)

- **Default**: prepaid app-session billing (faster for agents). The client passes `_meta["x402/yellow"]` with an `appSessionId` and optional `payer`. The server queries Yellow ledger balances for that session and decrements usage per call.
- **Fallback**: per-call Yellow transfer receipts via `_meta["x402/payment"]` and ledger verification.
- **Depletion**: if the session balance is below `YELLOW_PRICE_PER_CALL`, the server attempts to close/refund the session (requires `YELLOW_MERCHANT_PRIVATE_KEY`) and returns 402 with `errorReason: "insufficient_balance"`.

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
- Yellow clearnode access:
  - Sandbox: `wss://clearnet-sandbox.yellow.com/ws`
  - Production: `wss://clearnet.yellow.com/ws`
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

- `YELLOW_ENV` (default: inferred from `YELLOW_CLEARNODE_URL`, `development` if sandbox)
- `YELLOW_CLEARNODE_URL` (default: `wss://clearnet-sandbox.yellow.com/ws` for dev, `wss://clearnet.yellow.com/ws` for prod)
- `YELLOW_ASSET_SYMBOL` (default: `ytest.usd` for dev, `usdc` for prod)
- `YELLOW_PRICE_PER_CALL` (default: `0.1`)
- `YELLOW_TOOL_PRICES` (optional JSON map, e.g. `{"stock_price":"0.05","market_rumors":"0.2"}`)
- `YELLOW_NETWORK` (default: `yellow:sandbox` for dev, `yellow:mainnet` for prod)
- `YELLOW_MAX_TIMEOUT_SECONDS` (default: `60`)
- `REDDIT_USER_AGENT` (default: `eXpress402-mcp/0.1`)
- `YELLOW_AUTH_DOMAIN` (default: `Nitrolite`)
- `YELLOW_DEBUG` (set to `true` to log raw Nitro RPC traffic)

For demo client:

- `YELLOW_AGENT_PRIVATE_KEY` - agent private key for signing Yellow Nitro RPC requests
- `YELLOW_AGENT_ADDRESS` - optional agent address (informational only)
- `YELLOW_SESSION_PRIVATE_KEY` - optional private key used by the server to read app-session balances (defaults to agent key)

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

## Demo: end-to-end paid MCP flow

This demo script shows a full paid flow:
1) prints off-chain balances,
2) calls MCP tools with Yellow payments,
3) prints results,
4) shows balances decreasing,
5) optionally refunds from the merchant wallet to close out.

Note: the refund step requires `YELLOW_MERCHANT_PRIVATE_KEY`; otherwise it is skipped.

In dev, fund your Unified Balance via the sandbox faucet (`ytest.usd`). In prod, deposit on-chain into Yellow custody before calling paid tools.

Example per-tool pricing:

```bash
export YELLOW_TOOL_PRICES='{"stock_price":"0.05","market_rumors":"0.2"}'
```

```bash
npm run demo
```

## E2E paid tools test

Run a full paid flow (stock quote + market rumors) against the MCP:

```bash
npm run e2e:paid-tools
```

This script:
1. Creates a Yellow transfer receipt.
2. Calls `stock_price` with the payment payload.
3. Creates a second receipt and calls `market_rumors`.

## Production deposit flow (overview)

In production, the Yellow clearnode expects funds to exist in the **Custody contract** on your target chain.
The flow is:

1. **Deposit on-chain tokens** (e.g., USDC) into Yellow’s custody contract for your chain.
2. **Open or reuse a channel** for that chain + asset.
3. **Resize the channel** using `resize_amount` (custody-funded).
4. **Transfer off-chain** and attach the resulting receipt as `_meta["x402/payment"]`.

Notes:
- Custody contract addresses and supported token addresses are environment-specific.
- If you only have a Unified Balance (sandbox faucet), use `allocate_amount` instead of `resize_amount`.

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
        "asset": "ytest.usd",
          "payTo": "0xMerchantAddress",
          "maxTimeoutSeconds": 60,
          "extra": { "settlement": "yellow" }
        },
        "payload": {
          "transferId": "12345",
          "payer": "0xBuyerAddress",
          "amount": "0.1",
          "asset": "ytest.usd",
          "to": "0xMerchantAddress"
        }
      }
    }
  }
}
```

## Extension doc

See `docs/x402-yellow-extension.md` for the extension schema and examples.
