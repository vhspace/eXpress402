# Deploy on Railway

This repo includes Railway configuration for the Sentifi demo server.

## What runs

- Start command: `npm run demo:sentifi` (see `railway.toml`)

## Storage

The server expects a Redis-compatible KV for session and replay protection storage.

- Local development: Redis in the devcontainer
- Hosted: provide a Redis URL via environment variables used by `src/x402/siwx/storage.ts`

## Notes

- `railway.toml` defines the start command
- `nixpacks.toml` defines the build steps

