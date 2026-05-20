# Backend Operations

## Runtime Summary

- Runtime: Bun
- Required data store: Redis
- Durable analytics store: Postgres, with TimescaleDB features enabled when available
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
# Durable store is enabled by default when DATABASE_URL exists.
# Set either flag only when you intentionally want Redis-only runtime.
# ENABLE_TIMESCALE=false
# DISABLE_DURABLE_STORE=true
DATA_QUALITY_GAP_THRESHOLD_MS=90000
DATA_QUALITY_SPIKE_THRESHOLD_PCT=0.25
HUB_ALLOWED_ORIGINS=http://localhost:3010,https://app.example.com
HUB_ADMIN_ALLOWED_ORIGINS=https://ops.example.com
HUB_PUBLIC_RATE_LIMIT_WINDOW_MS=60000
HUB_PUBLIC_RATE_LIMIT_MAX=240
HUB_ADMIN_RATE_LIMIT_WINDOW_MS=60000
HUB_ADMIN_RATE_LIMIT_MAX=60
HUB_ENABLE_SCHEDULED_JOBS=true
HUB_BOOTSTRAP_FRONT_MONTHS_ON_STARTUP=true
HUB_BOOTSTRAP_SNAPSHOTS_ON_STARTUP=true
HUB_REBUILD_HOT_CACHE_ON_STARTUP=false
SENTRY_DSN=...
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=<git-sha-or-deploy-id>
SENTRY_TRACES_SAMPLE_RATE=0.1
```

## Observability

- Sentry captures startup, job, recovery, and write-path exceptions with backend
  service context. High-value events include tags such as `run_id`, `job_name`,
  `symbol`, `ingestion_source`, and provider/recovery source where available.
- The backend emits structured `metric` log events for critical counters and
  gauges such as operational-run status, admin-command runs, data-write
  failures, coverage stale counts, and spike counts.
- Datadog can ingest those JSON logs without adding an in-process Datadog
  client. Add a direct Datadog client later only if log-derived metrics are not
  enough.
- The intended incident trace is: Sentry event -> `run_id` tag -> durable
  `operational_runs` record -> related provider outcome/symbol metadata.

See [../specs/observability-metrics.md](../specs/observability-metrics.md) for
the log-derived metric catalog and initial Datadog dashboard/monitor contract.

## Local Startup

```bash
docker compose up -d redis
cd backend
bun install
bun run dev
```

To exercise the durable Postgres/Timescale path locally, start the opt-in
durable compose profile and run the integration test against it:

```bash
docker compose --profile durable up -d timescaledb
cd backend
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
  bun run test:timescale
```

This requires Docker/OrbStack to be running. Without it, the durable production
gate must wait for Railway or another reachable Postgres-compatible database.

## Health Checks

```bash
curl http://localhost:3001/health | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/health | jq
```

Healthy enough for serving beta traffic means:

- Redis connected
- Massive WS connected
- Postgres/Timescale connected when `DATABASE_URL` is configured
- job status visible in admin health
- coverage summary classifies missing/stale symbols instead of hiding them

`HUB_REBUILD_HOT_CACHE_ON_STARTUP` is intentionally conservative by default.
Turn it on only after `DATABASE_URL` is configured and the durable `bars_1m`
path has been verified in the target environment. Startup rebuild failures are
recorded as durable operational runs and do not block the process from serving.

## Tests

```bash
cd backend
bun run test:smoke
bun run test:unit
bun run test:redis
bun run test:timescale
bun run test
bunx tsc --noEmit
```

`bun run test` skips integration tests that need local Redis, Postgres/
Timescale, or live provider access. `test:redis` sets `RUN_REDIS_TESTS=1` and
requires a reachable Redis instance. `test:timescale` sets
`RUN_TIMESCALE_TESTS=1` and requires a reachable Postgres or Timescale database.

## Common Checks

```bash
curl http://localhost:3001/symbols | jq
curl http://localhost:3001/sessions | jq
curl http://localhost:3001/snapshots | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/subscriptions | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/coverage | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/contracts/active | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/front-months | jq
curl -X POST -H "X-API-Key: $HUB_API_KEY" "http://localhost:3001/admin/hot-cache/rebuild?dryRun=true" | jq
```

## Production Data-Layer Verification

After Railway Postgres is attached, `DATABASE_URL` is set on `mk3-backend`, and
the backend has restarted, run:

```bash
cd backend
BACKEND_BASE_URL=https://mk3-backend-production.up.railway.app \
HUB_API_KEY=... \
bun run verify:production-data-layer
```

This verifies the production acceptance gates for durable storage:

- `/health` reports the durable store connected
- `/health` reports Redis hot serving connected
- `/health` reports the Massive websocket connected
- `/admin/health` reports durable storage enabled and connected
- `/admin/durable/symbols` finds `bars_1m` rows
- `/admin/durable/bars/latest?source=live_ws` finds at least one recent live row
- `/admin/coverage` reports durable symbol counts
- `/admin/durable/provider-outcomes` has useful `success` or `empty` backfill/provider outcomes
- `/admin/durable/ingestion-runs` has successful provider/flat-file/recovery ingestion audit rows with bars
- `hot-cache-rebuild-dry-run` can hydrate bars from durable storage
