# MK3 Backend (Bun)

Real-time futures data backend using Massive futures APIs.

## Prerequisites

- [Bun](https://bun.sh) v1.3.3+
- Redis (Docker or local)
- Valid Massive API key
- TimescaleDB is paused until futures flat-file or equivalent historical access is available

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
# DATABASE_URL=postgres://...  # Optional, reserved for future historical storage
# ENABLE_TIMESCALE=true        # Optional opt-in; disabled by default for now
```

Scheduled jobs are enabled by default. On startup, the backend now bootstraps stale or missing snapshot and front-month caches before serving traffic.

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

## Troubleshooting

**Server won't start:**
1. Check Redis: `docker ps`
2. Verify `.env` file with `MASSIVE_API_KEY`
3. Check Bun version: `bun --version`

**No data flowing:**
1. Verify market hours (Mon-Fri, not 5pm-6pm ET)
2. Check subscriptions: `curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/subscriptions`
3. Inspect cached contract universe: `curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/contracts/active`
