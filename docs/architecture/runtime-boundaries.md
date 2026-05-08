# Runtime Boundaries

## Required Runtime For Redis-Only Beta

- Frontend service
- Backend service
- Redis service
- Massive API key
- Supabase auth/profile/subscription setup

## Explicitly Optional Today

- TimescaleDB
- long-window historical analytics
- self-serve billing completion
- AI Lab
- backtesting

## Backend Owns

- Massive WebSocket connection
- provider REST calls for contracts and snapshots
- normalization of provider payloads into internal bars/snapshots/contracts
- Redis hot store writes
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

Redis is the backend hot-path source of truth. It is not a durable long-term warehouse.

## Source-Verified Backend Spine

- `backend/src/server/index.ts`
- `backend/src/server/api/massive/ws_client.ts`
- `backend/src/server/api/rest_client.ts`
- `backend/src/server/data/redis_store.ts`
- `backend/src/server/data/recovery_store.ts`
- `backend/src/services/recovery_service.ts`
- `backend/src/server/job_runtime.ts`
- `backend/src/jobs/*`
- `backend/src/utils/contract_provider.ts`
- `backend/src/utils/front_month_resolver.ts`

