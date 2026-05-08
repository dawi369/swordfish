# Backend Data Layer V1

## Status

Draft

## Goal

Refine the backend/data layer into a production-quality beta runtime with explicit source-of-truth rules, typed contracts, predictable Redis behavior, recovery semantics, and operational checks.

## Non-Goals

- Full historical warehouse.
- TimescaleDB migration.
- Paid billing launch.
- AI Lab or backtesting data expansion.

## Current Behavior

- Redis is the required hot-path store.
- RedisTimeSeries stores rolling bars by symbol/timeframe/field.
- Redis hashes store latest bars, sessions, and snapshots.
- Redis JSON strings store active-contract and front-month caches.
- SQLite local recovery store supports reconnect/backfill behavior.
- TimescaleDB remains optional/deferred.

## Target Behavior

- Redis keyspace documented and covered by focused tests.
- API response contracts documented and stable.
- Session semantics explicit enough to reason about product behavior.
- Recovery/backfill can be manually triggered and safely observed.
- Provider limitations are represented as confidence/status, not hidden as generic failures.
- Admin endpoints are clearly separated from public endpoints.

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

## Verification

Minimum local checks:

```bash
cd backend
bunx tsc --noEmit
bun run test:unit
bun run test:redis
```

Minimum runtime checks:

```bash
curl http://localhost:3001/health | jq
curl http://localhost:3001/symbols | jq
curl http://localhost:3001/sessions | jq
curl http://localhost:3001/snapshots | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/health | jq
```

## Open Questions

- What exact Redis retention window is acceptable for beta charts?
- Should admin endpoints remain on the public backend domain?
- Should beta access be manual Pro provisioning or a dedicated beta flag?
- What is the minimum provider-data confidence required to display front-month labels?

