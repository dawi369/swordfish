# Backend Data Layer

## Current Behavior

Redis is the required hot-path source of truth for the active backend runtime.

The backend currently uses:

- Redis for latest bars, RedisTimeSeries bars, sessions, snapshots, active contracts, front-month cache, job status, and subscribed-symbol metadata.
- Local SQLite for short-window recovery state in `runtime/recovery/recovery.sqlite`.
- TimescaleDB code as a deferred historical-store abstraction. It is not required unless explicitly enabled.

## Source-Of-Truth Rules

- Latest live market state lives in Redis.
- Browser bootstrap and live data should be served from backend REST/WebSocket APIs backed by Redis.
- Recovery checkpoint state lives in Redis; local recovery bars/checkpoint internals live in SQLite.
- Active contracts come from Massive first, cached in Redis by product root.
- Front-month resolution is derived from active contracts plus snapshots and cached separately.
- Long-window analytics are not part of the required beta runtime.

## Storage Responsibilities

| Store | Required | Responsibility |
|---|---:|---|
| Redis | yes | hot data, rolling time series, session state, snapshots, contracts, job metadata |
| SQLite recovery store | yes in runtime image | local reconnect/backfill recovery support |
| TimescaleDB | no | deferred historical persistence |

## Runtime Writers

- `backend/src/server/api/massive/ws_client.ts`
  Receives upstream live bars and calls Redis write paths.
- `backend/src/server/data/redis_store.ts`
  Owns key construction, bar/session/snapshot/contract writes, range reads, and maintenance.
- `backend/src/jobs/snapshot_job.ts`
  Writes `snapshot:{symbol}`.
- `backend/src/jobs/front_month_job.ts`
  Writes `cache:front-months`.
- `backend/src/jobs/refresh_subscriptions.ts`
  Rebuilds upstream subscriptions and persists status.
- `backend/src/jobs/clear_daily.ts`
  Runs hot-store maintenance.
- `backend/src/services/recovery_service.ts`
  Coordinates provider backfill and local recovery state.

## Runtime Readers

- Public REST endpoints in `backend/src/server/api/rest_client.ts`
- Admin endpoints in `backend/src/server/api/rest_client.ts`
- WebSocket broadcaster in `backend/src/server/api/rest_client.ts`
- Frontend hub bootstrap code in `frontend/src/lib/hub/*`

## Intentional Gaps

- Redis retention is rolling, not archival.
- Provider coverage determines active-contract and front-month quality.
- Session rules are good enough for beta but still need product-specific calendar hardening.
- Admin exposure is API-key protected, but operational hardening is still tracked as a risk.

See [../specs/backend-data-layer-v1.md](../specs/backend-data-layer-v1.md) for the planned refinement work.

