---
description: Generate new AI agent wallet
---

# Generate AI Agent Wallet

Creates a new EOA wallet for your AI agent:

```bash
npm run generate-wallet
```

This will:
1. Generate random private key
2. Derive public address
3. Update .env with keys
4. Show wallet details

Security: Private key is stored in .env (git-ignored). Never commit this file.

To use a different wallet, run this command again (overwrites existing wallet).
