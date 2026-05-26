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
HUB_DISABLE_PROVIDER_CONNECTION=false
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
  gauges such as operational-run status, admin-command runs, direct
  admin-action runs, data-write failures, coverage stale counts, and spike
  counts.
- Redis client errors emit `swordfish.redis.client_error`; Sentry captures are
  throttled so a Redis outage remains visible without flooding Sentry.
- Contract-provider calls emit `swordfish.provider_contract_fetch.*` metrics and
  Sentry context for HTTP and network failures.
- Direct admin mutations are recorded as durable `admin_action` operational
  runs and emit `swordfish.admin_action.*` metrics. This includes manual Redis
  clear, manual refresh triggers, disabled recovery backfill, and hot-cache
  rebuilds.
- Datadog can ingest those JSON logs without adding an in-process Datadog
  client. Add a direct Datadog client later only if log-derived metrics are not
  enough.
- The intended incident trace is: Sentry event -> `run_id` tag -> durable
  `operational_runs` record -> related provider outcome/symbol metadata.

See [../specs/observability-metrics.md](../specs/observability-metrics.md) for
the log-derived metric catalog and initial Datadog dashboard/monitor contract.

## Admin Security

- Admin routes require `X-API-Key: $HUB_API_KEY` or
  `Authorization: Bearer $HUB_API_KEY`.
- Browser-origin admin requests are allowed only from
  `HUB_ADMIN_ALLOWED_ORIGINS`. This allowlist is independent from public
  `HUB_ALLOWED_ORIGINS`.
- No-origin CLI/server requests are allowed through the API key path.
- Admin requests use the admin rate-limit bucket, controlled by
  `HUB_ADMIN_RATE_LIMIT_WINDOW_MS` and `HUB_ADMIN_RATE_LIMIT_MAX`.

## Local Startup

```bash
docker compose up -d redis
cd backend
bun install
bun run dev
```

If another local project already owns port `6379`, run an isolated Redis Stack
container on another port for backend integration tests:

```bash
docker run -d --name swordfish-redis-test -p 6380:6379 redis/redis-stack-server:latest
cd backend
REDIS_PORT=6380 bun run test:redis
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

For local infrastructure smoke tests that should not consume the account's one
Massive WebSocket connection, start the backend with
`HUB_DISABLE_PROVIDER_CONNECTION=true`. This mode is for Redis/Postgres health
validation only: `/health`, `/admin/health`, and `/admin/ops` should work, but
`massiveWs` will correctly report `disconnected` and no live ingestion,
subscription refresh, or provider recovery is expected.

Example durable health-only smoke:

```bash
cd backend
HUB_PORT=4001 \
REDIS_PORT=6380 \
ENABLE_TIMESCALE=true \
DISABLE_DURABLE_STORE=false \
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
HUB_DISABLE_PROVIDER_CONNECTION=true \
HUB_ENABLE_SCHEDULED_JOBS=false \
HUB_BOOTSTRAP_FRONT_MONTHS_ON_STARTUP=false \
HUB_BOOTSTRAP_SNAPSHOTS_ON_STARTUP=false \
HUB_REBUILD_HOT_CACHE_ON_STARTUP=false \
bun run start
```

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

After Railway Postgres is attached, `DATABASE_URL` is set on `swordfish-backend`, and
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
- `/admin/recovery/backfill` returns `410` because provider REST backfill is disabled
- future `/admin/durable/ingestion-runs` rows for historical fill come from flat-file ingestion, not provider REST backfill
- `hot-cache-rebuild-dry-run` can hydrate bars from durable storage
