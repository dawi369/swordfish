# MK3 Backend (Bun)

Real-time futures data backend using Massive futures APIs.

## Prerequisites

- [Bun](https://bun.sh) v1.3.3+
- Redis (Docker or local)
- Valid Massive API key
- Optional Postgres/Timescale-compatible durable store via `DATABASE_URL`

## Quick Start

```bash
# Install dependencies
bun install

# Development (with hot reload)
bun run dev

# Production
bun run start
```

## Configuration

Create `.env` file:

```bash
MASSIVE_API_KEY=your_key_here
HUB_HOST=::
REDIS_HOST=localhost
REDIS_PORT=6379
HUB_PORT=3001
HUB_API_KEY=dev_only_secret
# HUB_ALLOWED_ORIGINS=http://localhost:3010,https://app.example.com
# HUB_ADMIN_ALLOWED_ORIGINS=https://ops.example.com
# HUB_PUBLIC_RATE_LIMIT_WINDOW_MS=60000
# HUB_PUBLIC_RATE_LIMIT_MAX=240
# HUB_ADMIN_RATE_LIMIT_WINDOW_MS=60000
# HUB_ADMIN_RATE_LIMIT_MAX=60
# HUB_ENABLE_SCHEDULED_JOBS=true
# HUB_BOOTSTRAP_SNAPSHOTS_ON_STARTUP=true
# HUB_BOOTSTRAP_FRONT_MONTHS_ON_STARTUP=true
# DATABASE_URL=postgres://...  # Enables durable bars_1m and operational history
# ENABLE_TIMESCALE=false       # Optional Redis-only fallback when intentionally disabling durable store
# DISABLE_DURABLE_STORE=true   # Optional Redis-only fallback
# HUB_REBUILD_HOT_CACHE_ON_STARTUP=false
# DATA_QUALITY_GAP_THRESHOLD_MS=90000
# DATA_QUALITY_SPIKE_THRESHOLD_PCT=0.25
```

Scheduled jobs are enabled by default. On startup, the backend now bootstraps stale or missing snapshot and front-month caches before serving traffic.
Durable storage is enabled by default when `DATABASE_URL` exists; Redis remains
the hot serving/cache layer and can be rebuilt from durable `bars_1m` after the
durable path is verified.

## Test the API

```bash
# Health check
curl http://localhost:3001/health | jq

# Public health
curl http://localhost:3001/health | jq

# Subscriptions
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/subscriptions | jq

# Cached active contracts per product
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/contracts/active | jq

# Front-month resolution
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/front-months | jq

# Latest bars
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/bars/latest | jq

# Durable analytics inspection
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/durable/symbols | jq
curl -H "X-API-Key: $HUB_API_KEY" "http://localhost:3001/admin/durable/provider-outcomes?limit=10" | jq
curl -H "X-API-Key: $HUB_API_KEY" "http://localhost:3001/admin/durable/ingestion-runs?limit=10" | jq

# Current trading-session bars
curl http://localhost:3001/bars/session/ESM6 | jq

# Retained session history
curl http://localhost:3001/sessions/week/ESM6 | jq
```

## Documentation

Start here:

- [../docs/backend/README.md](../docs/backend/README.md)
- [../docs/backend/operations.md](../docs/backend/operations.md)
- [../docs/backend/api.md](../docs/backend/api.md)
- [../docs/architecture/data-flow.md](../docs/architecture/data-flow.md)

## Production Data-Layer Verification

After Railway Postgres is attached and `DATABASE_URL` is set on `mk3-backend`:

```bash
BACKEND_BASE_URL=https://mk3-backend-production.up.railway.app \
HUB_API_KEY=... \
bun run verify:production-data-layer
```

## Tests

```bash
bunx tsc --noEmit --skipLibCheck
bun run test:smoke
bun run test
```

`bun run test` skips integration checks that need local Redis, Postgres/
Timescale, or live provider access. Use `bun run test:redis` with a reachable
Redis instance and `bun run test:timescale` with a reachable database for those
runtime-backed checks.

For a local durable-store check, start the opt-in Timescale/Postgres service
from the repo root, then run the Timescale test script:

```bash
docker compose --profile durable up -d timescaledb
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
  bun run test:timescale
```

This requires Docker/OrbStack to be running.

## Troubleshooting

**Server won't start:**
1. Check Redis: `docker ps`
2. Verify `.env` file with `MASSIVE_API_KEY`
3. Check Bun version: `bun --version`

**No data flowing:**
1. Verify market hours (Mon-Fri, not 5pm-6pm ET)
2. Check subscriptions: `curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/subscriptions`
3. Inspect cached contract universe: `curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/contracts/active`
