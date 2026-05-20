# Backend Data Layer

## Current Behavior

Redis is the required hot-path serving store for the active backend runtime.
Postgres is the durable analytics store for normalized bars and operational
history from the migration point forward. TimescaleDB is treated as an
optional Postgres extension: the schema boots on plain Railway Postgres first
and enables hypertables/continuous aggregates only when the extension exists.

The backend currently uses:

- Redis for latest bars, RedisTimeSeries bars, sessions, snapshots, active contracts, front-month cache, job status, and subscribed-symbol metadata.
- Local SQLite for short-window recovery state in `runtime/recovery/recovery.sqlite`.
- Postgres/Timescale for canonical `bars_1m` records, operational run history,
  provider fetch outcomes, durable coverage diagnostics, data quality summary
  audits, and future flat-file ingestion.

## Source-Of-Truth Rules

- Latest live market state is served from Redis.
- Durable normalized 1-minute bars are written to Postgres/Timescale when
  `DATABASE_URL` is configured and durable storage is not explicitly disabled.
- Browser bootstrap and live data should be served from backend REST/WebSocket APIs backed by Redis.
- Recovery checkpoint state lives in Redis; local recovery bars/checkpoint internals live in SQLite.
- Active contracts come from Massive first, cached in Redis by product root.
- Front-month resolution is derived from active contracts plus snapshots and cached separately.
- Redis is rebuildable from durable `bars_1m` for the latest-week hot cache.
- Long-window analytics are not part of the required beta runtime yet, but
  backend APIs must expose quality/freshness metadata for future AI tools.
- Range reads include query-time quality metadata: gap count, spike count,
  invalid OHLC count, zero/negative-volume counts, oldest/newest durable bar
  timestamps, and freshness.
- Historical completeness before the durable-store migration point depends on
  provider REST backfill or future Massive futures flat-file ingestion.

## Storage Responsibilities

| Store | Required | Responsibility |
|---|---:|---|
| Redis | yes | latest-week hot data, rolling time series, session state, snapshots, contracts, current job metadata |
| SQLite recovery store | yes in runtime image | local reconnect/backfill recovery support |
| Postgres/Timescale | yes for analytics runtime | durable `bars_1m`, job/recovery/provider/admin operational history, coverage diagnostics, future historical persistence |

## Runtime Writers

- `backend/src/server/api/massive/ws_client.ts`
  Receives upstream live bars and passes normalized bars to the market-data writer.
- `backend/src/services/market_data_writer.ts`
  Coordinates live writes to Redis hot cache, local recovery state, and
  TimescaleDB `bars_1m` when enabled.
- `backend/src/services/durable_bar_writer.ts`
  Owns durable historical/bar-batch writes for provider backfill and future
  flat-file ingestion, so non-live sources write through one typed boundary.
- `backend/src/services/flat_file_ingestion_service.ts`
  Provides the future flat-file entrypoint. It does not parse Massive files yet;
  it routes parsed bars through `durable_bar_writer.ts` with `source=flat_file`.
- `backend/src/server/data/redis_store.ts`
  Owns key construction, bar/session/snapshot/contract writes, range reads, and maintenance.
- `backend/src/server/data/timescale_store.ts`
  Owns durable `bars_1m` upserts/range reads, plain-Postgres schema boot,
  optional Timescale features, ingestion and operational run records, provider
  fetch outcomes, durable coverage stats, and typed inspection queries for latest
  durable bars, provider outcomes, ingestion runs, operational runs, and quality
  summaries. Admin/tool quality reads can persist `data_quality_summaries`
  records for later audit.
- `backend/src/jobs/snapshot_job.ts`
  Writes `snapshot:{symbol}`.
- `backend/src/jobs/front_month_job.ts`
  Writes `cache:front-months`.
- `backend/src/jobs/refresh_subscriptions.ts`
  Rebuilds upstream subscriptions and persists status.
- `backend/src/jobs/clear_daily.ts`
  Runs hot-store maintenance.
- `backend/src/services/recovery_service.ts`
  Coordinates provider backfill, local recovery state, Redis hot-cache rebuild
  writes, and TimescaleDB `bars_1m` backfill upserts.
- `backend/src/services/analytics_tool_service.ts`
  Provides typed read-only/dry-run service contracts for future AI tools:
  latest market state, symbol coverage explanations, range bars with quality
  metadata, provider/backfill status, and safe hot-cache rebuild dry-run
  diagnostics.

## Runtime Readers

- Public REST endpoints in `backend/src/server/api/rest_client.ts`
- Admin endpoints in `backend/src/server/api/rest_client.ts`
- Durable inspection endpoints under `/admin/durable/*` for future tool-safe
  analytics access
- Future AI/tool adapters should call `analyticsToolService` service methods,
  not Redis, Postgres, or route handlers directly.
- WebSocket broadcaster in `backend/src/server/api/rest_client.ts`
- Frontend hub bootstrap code in `frontend/src/lib/hub/*`

## Intentional Gaps

- Redis retention is rolling, not archival.
- Durable analytics are only complete after Railway Postgres is provisioned and
  `DATABASE_URL` is configured in production.
- Provider coverage determines active-contract and front-month quality.
- Coverage diagnostics use subscription state, Redis latest bars, active
  contracts, durable bars, and provider outcomes to classify missing symbols as
  `not_subscribed`, `subscribed_no_live_data`, `provider_no_data`,
  `stale_contract`, or `backfill_pending`.
- Session rules are good enough for beta but still need product-specific calendar hardening.
- Admin exposure is API-key protected, but operational hardening is still tracked as a risk.

See [../specs/backend-data-layer-v1.md](../specs/backend-data-layer-v1.md) for the planned refinement work.
