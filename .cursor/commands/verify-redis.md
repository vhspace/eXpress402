---
description: Verify Redis/KV connection
---

# Verify Redis Connection

Check if Redis is running and accessible:

```bash
redis-cli -h redis ping
```

Expected output: PONG

To view all stored sessions:
```bash
redis-cli -h redis keys "session:*"
```

To check a specific session:
```bash
redis-cli -h redis get "session:{wallet-address}:{resource-url}"
```

If Redis is not running:
- DevContainer: rebuild container
- Local: docker run -d -p 6379:6379 redis:7-alpine
