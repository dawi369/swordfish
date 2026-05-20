# Data Layer Migration Plan

## Current State

Redis is currently the beta hot-path store, but it is carrying too many
responsibilities: live serving state, rolling history, cache state, job status,
recovery checkpoints, snapshots, active contracts, front-month cache, and admin
diagnostics.

The target migration is not a simple database swap. The target is a clearer
split:

- Redis remains the hot serving/cache layer for the latest week, live stream,
  latest bars, and rebuildable projections.
- Postgres becomes the durable truth for normalized bars and operational
  history from the migration point forward. TimescaleDB is an upgrade path
  when available, not a hard boot dependency.
- Massive REST remains the bounded recovery/backfill source until futures flat
  files are available.
- A future flat-file importer should write into the same TimescaleDB schema; it
  should not change the runtime data model.

The backend is intentionally a single writer for live market data because the
provider allows only one Massive WebSocket connection. That simplifies
coordination, but it does not remove the need for durable job/recovery state and
explicit Redis freshness semantics.

## Architecture Principles

- Redis data must be treated as hot, rebuildable, and freshness-scored.
- Postgres/Timescale should receive the hot week too, not only older history.
- Redis latest-week state should be rebuildable from durable `bars_1m` after restart.
- Job runs, recovery runs, provider fetch outcomes, and admin actions should be
  durable enough to explain what happened after the fact.
- Missing pre-migration history is acceptable if the product clearly represents
  it as unavailable or backfill-pending.
- Massive futures flat-file availability should improve historical completeness,
  not determine runtime correctness.

## Target Ownership

| Data | Durable owner | Hot/cache owner | Notes |
|---|---|---|---|
| Live normalized 1m bars | Postgres/Timescale | Redis | Redis serves latest week; durable `bars_1m` is canonical from migration forward. |
| Latest bar by symbol | TimescaleDB-derived/live write | Redis | Redis value must expose timestamp/freshness. |
| RedisTimeSeries chart cache | Postgres/Timescale | Redis | Rebuild latest week from durable `bars_1m` on startup or repair. |
| Session projections | Rebuildable from bars | Redis | Avoid double-counting recovered/replayed bars. |
| Provider snapshots | Postgres/Timescale metadata table | Redis | Redis cache should include source, updatedAt, expiresAt/status. |
| Active contracts | Postgres table/history | Redis | Preserve current active set plus provider outcome. |
| Front-month decisions | Postgres table/history | Redis | Store candidates/confidence/reason durably. |
| Job status | Postgres job_runs | Redis optional current status | Do not rely only on one mutable Redis status blob. |
| Recovery runs/checkpoints | Postgres recovery tables | Redis optional checkpoint cache | SQLite can be retired after Timescale recovery is stable. |
| Admin actions | Postgres audit table | Redis optional recent cache | Manual maintenance actions need an audit trail. |

## Phases

### Phase 1. Document And Verify

- update docs to reflect Redis hot-cache plus Timescale durable ownership
- document stale/fresh/empty semantics for public and admin APIs
- identify which existing Redis keys become rebuildable projections

### Phase 2. Durable Runtime Spine

- add Postgres/Timescale-compatible `bars_1m` durable write/read path
- write live normalized bars to durable storage before or alongside Redis
- add latest-week Redis rebuild from durable storage
- add durable `job_runs`, `recovery_runs`, provider fetch outcomes, and admin
  audit events

### Phase 3. Redis Hot-Cache Hardening

- add TTL/freshness policy for cache families
- keep RedisTimeSeries failure from making latest-bar state ambiguous
- keep startup hot-cache rebuild opt-in with `HUB_REBUILD_HOT_CACHE_ON_STARTUP`
  until the production durable store is verified
- reconcile Redis index sets and dangling cache keys
- make recovered/replayed bars idempotent for session projections

### Phase 4. Provider Backfill

- use Massive REST for bounded startup/reconnect/manual backfill
- persist backfill results per symbol
- represent missing or unavailable history explicitly in API responses
- prepare flat-file importer interface for future Massive futures flat files
  through `backend/src/services/flat_file_ingestion_service.ts`; parsing is still
  a future slice, but parsed bars already have a stable durable boundary

### Phase 5. Product Semantics

- refine session calendar behavior
- refine front-month confidence behavior
- define chart fallback behavior across Redis, TimescaleDB, and provider backfill

## Initial Implementation Order

1. Add durable job/recovery/admin run tables or a small Postgres-backed
   operational store.
2. Add Postgres/Timescale-compatible `bars_1m` canonical schema and idempotent upserts.
3. Route live bar writes through a single market-data write boundary that writes
   Timescale, Redis, projections, and stream output with explicit failure state.
4. Add latest-week Redis rebuild from Timescale.
5. Change admin health to show service status, data freshness, provider status,
   and job status separately.

## Stop Conditions

- Do not remove Redis latest-week serving until durable read paths are tested
  and startup rebuild is reliable.
- Do not claim historical completeness before a flat-file importer or a verified
  REST backfill has populated the requested range.
- Do not use Redis job status as the only explanation for production incidents.
