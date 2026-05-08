# Data Flow

## Summary

```text
Massive WS/REST
  -> backend normalization
  -> Redis hot store + local recovery cache
  -> backend REST/WebSocket API
  -> frontend hub client
  -> terminal store and chart views
```

## Live Ingestion

1. `backend/src/server/index.ts` boots Redis, recovery, Massive WebSocket, jobs, then the HTTP/WebSocket API.
2. `backend/src/server/api/massive/ws_client.ts` connects to Massive and receives live aggregate messages.
3. Incoming bars are normalized into internal bar objects.
4. `backend/src/server/data/redis_store.ts` writes latest state, RedisTimeSeries fields, stream events, and session metrics.
5. `backend/src/server/api/rest_client.ts` broadcasts stream events to connected browser WebSocket clients.

## Bootstrap Reads

The frontend bootstrap path expects:

- `GET /symbols`
- `GET /snapshots`
- `GET /sessions`
- `GET /bars/range/:symbol`
- hub WebSocket messages from the backend

Frontend docs for the client-side implementation still live in `frontend/docs/data-layer.md`.

## Contract And Front-Month Flow

1. `backend/src/utils/futures_universe.ts` defines the local product universe.
2. `backend/src/utils/contract_provider.ts` fetches active contracts from Massive.
3. `backend/src/utils/cbs/schedule_cb.ts` builds subscriptions from active contracts first, with static schedule fallback.
4. `backend/src/jobs/snapshot_job.ts` refreshes per-contract snapshots.
5. `backend/src/jobs/front_month_job.ts` ranks front-month candidates.
6. `backend/src/utils/front_month_resolver.ts` ranks by session volume, open interest, then expiry.

## Recovery Flow

Short-window recovery uses:

- `backend/src/services/recovery_service.ts`
- `backend/src/server/data/recovery_store.ts`
- `runtime/recovery/recovery.sqlite`

This recovery store is local process state. It is not the long-term historical store.

## Current Known Limits

- Redis retention is intentionally rolling.
- Provider snapshot and active-contract coverage affects front-month confidence.
- TimescaleDB remains in code but is not required for the active beta path.

