# Recovery And Backfill

## Purpose

Recovery exists to keep live runtime state understandable across restarts and
reconnects. It is not long-term historical storage.

There is no active provider REST backfill path for futures history. Redis and
Postgres/Timescale are filled live. Historical fill waits for Massive futures
flat-file access.

## Components

- `backend/src/services/recovery_service.ts`
  Owns local recovery-store hydration and recovery checkpoints.
- `backend/src/server/data/recovery_store.ts`
  Local SQLite-backed reconnect cache.
- `backend/src/server/data/redis_store.ts`
  Stores recovery checkpoints in Redis.
- `backend/src/server/api/massive/ws_client.ts`
  Buffers live bars during reconnect and flushes those live bars after the
  socket is restored.

## Storage

- Local SQLite path: `runtime/recovery/recovery.sqlite`
- Redis checkpoint index: `meta:index:recovery_checkpoints`
- Redis checkpoint keys: `recovery:checkpoint:{timeframe}:{symbol}`

## Disabled Backfill Endpoint

`POST /admin/recovery/backfill` remains authenticated, but it returns
`410 Gone` with `status=disabled`.

This is deliberate. Futures history should not be repaired through Massive REST
right now. The future historical path is flat-file ingestion into `bars_1m`.

## Boundaries

- Recovery should not be used as an analytics warehouse.
- Reconnect handling should not call provider REST backfill.
- Failed recovery checkpoint/cache writes should degrade continuity, not
  prevent the backend from serving existing Redis data.
- Future flat-file ingestion must write through `DurableBarWriter` and
  `bars_1m`.
