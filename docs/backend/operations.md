# Backend Operations

## Runtime Summary

- Runtime: Bun
- Required data store: Redis
- Optional historical store: TimescaleDB
- Upstream provider: Massive
- API server: Bun HTTP/WebSocket on `HUB_HOST`/`HUB_PORT`

## Required Environment

```bash
MASSIVE_API_KEY=...
MASSIVE_API_URL=https://api.massive.com
HUB_HOST=::
HUB_PORT=3001
HUB_API_KEY=...
REDIS_HOST=localhost
REDIS_PORT=6379
# or REDIS_URL=redis://default:password@host:6379
```

Optional:

```bash
DATABASE_URL=postgres://...
ENABLE_TIMESCALE=true
HUB_ALLOWED_ORIGINS=http://localhost:3010,https://app.example.com
HUB_ADMIN_ALLOWED_ORIGINS=https://ops.example.com
HUB_PUBLIC_RATE_LIMIT_WINDOW_MS=60000
HUB_PUBLIC_RATE_LIMIT_MAX=240
HUB_ADMIN_RATE_LIMIT_WINDOW_MS=60000
HUB_ADMIN_RATE_LIMIT_MAX=60
HUB_ENABLE_SCHEDULED_JOBS=true
HUB_BOOTSTRAP_FRONT_MONTHS_ON_STARTUP=true
HUB_BOOTSTRAP_SNAPSHOTS_ON_STARTUP=true
```

## Local Startup

```bash
docker compose up -d redis
cd backend
bun install
bun run dev
```

## Health Checks

```bash
curl http://localhost:3001/health | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/health | jq
```

Healthy enough for serving beta traffic means:

- Redis connected
- Massive WS connected
- TimescaleDB disabled or connected
- job status visible in admin health

## Tests

```bash
cd backend
bun run test:unit
bun run test:redis
bun run test
bunx tsc --noEmit
```

`test:redis` requires a reachable Redis instance.

## Common Checks

```bash
curl http://localhost:3001/symbols | jq
curl http://localhost:3001/sessions | jq
curl http://localhost:3001/snapshots | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/subscriptions | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/contracts/active | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/front-months | jq
```

