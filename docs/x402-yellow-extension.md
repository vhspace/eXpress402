# x402 Extension: yellow

This document defines a hackathon extension that enables x402 v2 clients and servers to use Yellow Network's off-chain settlement (Nitro RPC) for bulk payments.

## Summary

The `yellow` extension lets an agent opt into Yellow off-chain settlement as an alternative to per-call facilitator transactions. The server advertises `extensions.yellow` in the `PaymentRequired` response, and the client echoes it in the `PaymentPayload` along with a transfer receipt from the clearnode.

This extension does not change core x402 v2 fields. It adds additional data under `extensions.yellow`.

## PaymentRequired

Servers include the extension in the `extensions` object. The `info` field describes the clearnode and pricing for the bulk settlement flow.

Example:

```json
{
  "x402Version": 2,
  "resource": {
    "url": "mcp://tool/stock_price",
    "description": "Paid tool: stock_price",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "yellow-offchain",
      "network": "yellow:sandbox",
      "amount": "0.1",
      "asset": "usdc",
      "payTo": "0xMerchantAddress",
      "maxTimeoutSeconds": 60,
      "extra": {
        "settlement": "yellow"
      }
    }
  ],
  "extensions": {
    "yellow": {
      "info": {
        "clearnodeUrl": "wss://clearnet-sandbox.yellow.com/ws",
        "protocolVersion": "NitroRPC/0.4",
        "asset": "usdc",
        "pricePerCall": "0.1"
      },
      "schema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "clearnodeUrl": { "type": "string" },
          "protocolVersion": { "type": "string" },
          "asset": { "type": "string" },
          "pricePerCall": { "type": "string" },
          "transferId": { "type": ["number", "string"] },
          "payer": { "type": "string" }
        },
        "required": ["clearnodeUrl", "protocolVersion", "asset", "pricePerCall"],
        "additionalProperties": true
      }
    }
  }
}
```

## PaymentPayload (per-call fallback)

Clients include a transfer receipt in the `payload` field and mirror the `yellow` extension. This is the per-call fallback path.

Example:

```json
{
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
  },
  "extensions": {
    "yellow": {
      "info": {
        "clearnodeUrl": "wss://clearnet-sandbox.yellow.com/ws",
        "protocolVersion": "NitroRPC/0.4",
        "asset": "usdc",
        "pricePerCall": "0.1",
        "transferId": "12345",
        "payer": "0xBuyerAddress"
      },
      "schema": { "$schema": "https://json-schema.org/draft/2020-12/schema" }
    }
  }
}
```

## Notes

- This extension is intended for demos and experimentation.
- Servers should verify per-call transfers using `get_ledger_transactions` on the clearnode.
- For prepaid app sessions, clients pass `_meta["x402/yellow"]` with:
  - `appSessionId` (required)
  - `payer` (optional, used for close/refund)
- Servers query `get_ledger_balances` for the session account and debit per call. If the balance is insufficient, they return 402 and may attempt `close_app_session` to refund remaining allocation.
- Use the hosted sandbox clearnode for testing: `wss://clearnet-sandbox.yellow.com/ws`.
