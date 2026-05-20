# Runtime Boundaries

## Required Production Runtime

- Frontend service
- Backend service
- Redis service
- Postgres service via `DATABASE_URL`
- Massive API key
- Supabase auth/profile/subscription setup

## Explicitly Optional Today

- TimescaleDB extension features; plain Postgres is enough to boot
- long-window historical analytics
- self-serve billing completion through Polar
- AI Lab
- backtesting

## Backend Owns

- Massive WebSocket connection
- provider REST calls for contracts and snapshots
- normalization of provider payloads into internal bars/snapshots/contracts
- Redis hot store writes
- durable `bars_1m`, ingestion-run, provider-outcome, and quality-summary writes
- local SQLite recovery cache
- scheduled maintenance and refresh jobs
- public hub REST API
- browser-facing WebSocket fanout
- admin API protected by `HUB_API_KEY`

## Frontend Owns

- auth/session UI
- terminal shell and chart views
- hub bootstrap calls
- hub WebSocket client
- local terminal state
- rendering and interaction

## Redis Owns

- current hot market state
- rolling time-series window
- retained session buckets
- snapshot cache
- active-contract cache
- front-month cache
- job status metadata
- subscribed-symbol metadata

Redis is the backend hot serving layer. It is not the durable analytics source
of record and must remain rebuildable from durable `bars_1m` where possible.

## Postgres/Timescale-Shaped Store Owns

- normalized `bars_1m` from live WebSocket data
- bounded provider backfill writes
- future flat-file ingestion writes
- operational runs
- ingestion runs
- provider fetch outcomes
- data quality summaries

Plain Postgres is acceptable in production. TimescaleDB extension features are
enabled opportunistically when available.

## Source-Verified Backend Spine

- `backend/src/server/index.ts`
- `backend/src/server/api/massive/ws_client.ts`
- `backend/src/server/api/rest_client.ts`
- `backend/src/server/data/redis_store.ts`
- `backend/src/server/data/timescale_store.ts`
- `backend/src/server/data/recovery_store.ts`
- `backend/src/services/durable_bar_writer.ts`
- `backend/src/services/flat_file_ingestion_service.ts`
- `backend/src/services/recovery_service.ts`
- `backend/src/server/job_runtime.ts`
- `backend/src/jobs/*`
- `backend/src/utils/contract_provider.ts`
- `backend/src/utils/front_month_resolver.ts`
