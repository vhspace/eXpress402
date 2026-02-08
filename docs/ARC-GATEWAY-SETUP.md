# Arc + Circle Gateway Setup (Arc Testnet)

This project can use **either** Yellow offchain sessions **or** Arc Testnet + Circle Gateway to satisfy x402 payments.

The Arc path uses `scheme: arc-usd-offchain` and verifies payment by checking a **GatewayMinter `AttestationUsed`** event on Arc Testnet.

## What you need from Circle / Arc

### Required for Arc + Gateway (permissionless)

- **Circle faucet funds (Arc Testnet USDC)**: Use the Circle faucet to fund your agent wallet on Arc Testnet. The faucet is required because Arc uses USDC for gas.
  - **Faucet**: `https://faucet.circle.com/`
  - **Network**: Arc Testnet
  - **Token**: USDC
- **Arc Testnet RPC** (public): Default is `https://rpc.testnet.arc.network`.
  - **Override**: `ARC_RPC_URL`

### Not required for Gateway

- **No Circle Developer Console API key is required** for Circle Gateway.
  - Gateway API endpoints are permissionless (no auth headers required).

### Optional (only if you want Circle Wallets dev-controlled wallets)

If you want Circle to custody/manage keys for you (instead of a local EOA private key), you will need:

- A Circle Developer Console account + **API key**
- A **Circle Entity Secret** (for dev-controlled wallets)

This repo’s default agent model uses an **EOA private key** (Viem) and does not require Circle Wallets.

## Contract and domain constants (Arc Testnet)

- **Arc chainId**: `5042002`
- **Gateway domain**: `26`
- **Arc USDC ERC-20 interface** (6 decimals): `0x3600000000000000000000000000000000000000`
- **GatewayWallet**: `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`
- **GatewayMinter**: `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`

## Environment variables

### Required (shared with Yellow config)

The demo server reuses existing env names for wallet identity:

- `YELLOW_AGENT_PRIVATE_KEY`: agent EOA private key (used for SIWx signing and Gateway burn intents)
- `YELLOW_MERCHANT_ADDRESS`: merchant address (the x402 `payTo` recipient)

### Optional Arc overrides

- `ARC_RPC_URL`: Arc Testnet RPC URL override
- `ARC_GATEWAY_MINTER_ADDRESS`: override GatewayMinter address (rare)
- `ARC_USDC_ADDRESS`: override USDC address (rare)
- `PAYMENT_REPLAY_TTL_SECONDS`: TTL for replay protection keys (default: 86400)

## Using the dashboard rail toggle

1. Start the Sentifi demo server.
2. Open the dashboard.
3. Click the **top-right Rail** badge to switch between **YELLOW** and **ARC**.
4. Click **LOGIN**.

### Mock data fallback (optional)

By default, the Sentifi demo does **not** fall back to mock market data for MCP calls.
If you want to allow mock fallback in Yellow mode (e.g. for UI demos without Yellow credentials), set:

- `SENTIFI_ALLOW_MOCK_DATA=true`

In ARC mode, the server will attempt a paid MCP call by:

- Requesting a 402 to get the SIWx challenge and `accepts[]`
- Signing SIWx with your agent EOA
- Requesting a Gateway attestation from `https://gateway-api-testnet.circle.com`
- Calling `GatewayMinter.gatewayMint()` on Arc Testnet to mint USDC to the merchant
- Retrying the MCP call with `_meta['x402/payment']` containing `{ mintTxHash }`

## Funding the Circle Gateway unified balance (Arc Testnet)

Your wallet having onchain USDC is **not enough**. To get a **unified** balance, you must deposit USDC into the **GatewayWallet** contract using `deposit()`.

This repo includes a helper script:

```bash
npx tsx scripts/arc-gateway-deposit.ts 10
```

It will:

- `approve()` Arc USDC to GatewayWallet
- call `GatewayWallet.deposit(usdc, amount)`
- query `POST /v1/balances` to show your unified balance
