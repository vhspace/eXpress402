---
name: Get Stock Quote (eXpress402 MCP)
description: Call the paid stock_price tool with Yellow payments.
---

Use this to get a stock quote through the MCP with payments enabled.

1) Ensure the sandbox is funded (dev):
`curl -X POST https://clearnet-sandbox.yellow.com/faucet/requestTokens -H "Content-Type: application/json" -d '{"userAddress":"<YOUR_WALLET>"}'`

2) Start the MCP server (if not running):
`npm run dev`

3) In Cursor, call the tool:
- MCP server: `eXpress402-mcp`
- Tool: `stock_price`
- Arguments: `{ "symbol": "AAPL" }`

If prompted for payment, run `npm run demo` and paste the payment payload into `_meta["x402/payment"]`.

Example `_meta` payload (paste from `npm run demo` output):
```json
{
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
```
