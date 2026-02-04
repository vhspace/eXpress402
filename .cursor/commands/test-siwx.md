---
description: Test SIWx session flow
---

# Test SIWx Integration

Run complete integration test showing:
- First request: SIWx authentication + Yellow session creation
- Subsequent request: Session reuse without payment

```bash
npm run demo:siwx
```

To verify sessions are stored:
```bash
redis-cli -h redis keys "session:*"
```

To view specific session:
```bash
redis-cli -h redis get "session:0x...:{resource-url}"
```
