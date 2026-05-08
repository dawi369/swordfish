# Recovery And Backfill

## Purpose

Recovery exists to reduce gaps after reconnects and restarts. It is not long-term historical storage.

## Components

- `backend/src/services/recovery_service.ts`
  Orchestrates recovery and provider backfill.
- `backend/src/server/data/recovery_store.ts`
  Local SQLite-backed recovery cache.
- `backend/src/server/data/redis_store.ts`
  Stores recovery checkpoints in Redis.

## Storage

- Local SQLite path: `runtime/recovery/recovery.sqlite`
- Redis checkpoint index: `meta:index:recovery_checkpoints`
- Redis checkpoint keys: `recovery:checkpoint:{symbol}`

## Manual Backfill

```bash
curl -X POST -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/recovery/backfill | jq
```

This runs provider backfill for currently subscribed symbols.

## Boundaries

- Recovery should not be used as an analytics warehouse.
- Recovery depends on provider historical availability.
- Current-minute exclusion is used for manual provider backfill to avoid unstable partial bars.
- A failed recovery path should degrade data continuity, not prevent the backend from serving existing Redis data.

