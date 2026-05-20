# Backend Data Layer V1

## Status

Draft

## Goal

Refine the backend/data layer into a production-quality beta runtime with explicit source-of-truth rules, typed contracts, predictable Redis behavior, recovery semantics, and operational checks.

## Non-Goals

- Full historical warehouse.
- Replacing Redis as the hot serving/cache layer.
- Paid billing launch.
- AI Lab or backtesting data expansion.

## Current Behavior

- Redis is the required hot-path store.
- RedisTimeSeries stores rolling bars by symbol/timeframe/field.
- Redis hashes store latest bars, sessions, and snapshots.
- Redis JSON strings store active-contract and front-month caches.
- SQLite local recovery store supports reconnect/backfill behavior.
- Postgres is the durable analytics store when `DATABASE_URL` is configured.
- TimescaleDB features are optional and enabled only when available; the schema
  must boot on plain Postgres.

## Target Behavior

- Redis keyspace documented and covered by focused tests.
- API response contracts documented and stable.
- Session semantics explicit enough to reason about product behavior.
- Recovery/backfill can be manually triggered and safely observed.
- Provider limitations are represented as confidence/status, not hidden as generic failures.
- Admin endpoints are clearly separated from public endpoints.
- Future AI/tool callers use typed backend services, not direct Redis/Postgres
  access.
- Redis remains the hot serving layer, while durable `bars_1m` and operational
  records make Redis rebuildable and incident history inspectable.

## Workstreams

### 1. Redis Contract Hardening

- verify every key writer/reader
- add tests for key retention and maintenance
- document TTL/retention where code enforces it
- make index sets part of the contract

### 2. API Contract Hardening

- define response shapes for public endpoints
- define admin-only response shapes
- document errors and degraded states
- add tests for endpoint contracts

### 3. Recovery And Backfill

- clarify checkpoint lifecycle
- test manual backfill path
- define acceptable behavior when provider backfill fails
- expose enough operator detail to debug gaps

### 4. Provider Quality

- make active-contract fetch status observable
- make snapshot/front-month confidence explicit
- separate no-data from provider-error from stale-cache cases

### 5. Operations

- add runbooks for Redis, provider outage, failed deploy, and stale market data
- standardize local and Railway verification commands
- decide which admin endpoints are safe on the public backend host

### 6. Tool-Safe Analytics Contracts

- expose latest market state through a service function
- expose symbol coverage and missing/stale explanations through a service function
- expose range bars with quality metadata through a service function
- expose provider/backfill outcomes through a service function
- allow only safe dry-run diagnostics from tool-facing contracts
- keep admin mutations behind authenticated routes and operational-run audit

## Verification

Minimum local checks:

```bash
cd backend
bunx tsc --noEmit --skipLibCheck
bun run test:smoke
```

Minimum runtime checks:

```bash
curl http://localhost:3001/health | jq
curl http://localhost:3001/symbols | jq
curl http://localhost:3001/sessions | jq
curl http://localhost:3001/snapshots | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/health | jq
```

Production durable-store verification after Railway Postgres is attached:

```bash
cd backend
BACKEND_BASE_URL=https://mk3-backend-production.up.railway.app \
HUB_API_KEY=... \
bun run verify:production-data-layer
```

## Open Questions

- What exact Redis retention window is acceptable for beta charts?
- Should admin endpoints remain on the public backend domain?
- Should beta access be manual Pro provisioning or a dedicated beta flag?
- What is the minimum provider-data confidence required to display front-month labels?
