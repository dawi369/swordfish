# Backend Docs

These docs describe current backend behavior verified against `backend/src`.

## Read First

1. [data-layer.md](./data-layer.md)
   Source-of-truth rules and persistence model.
2. [redis-keyspace.md](./redis-keyspace.md)
   Redis keys, data types, writers, readers, and retention.
3. [redis-timescale-bar-flow.md](./redis-timescale-bar-flow.md)
   Current Redis/Postgres structure and the flow of a live bar.
4. [ingestion-pipeline.md](./ingestion-pipeline.md)
   Massive ingestion, normalization, Redis writes, and fanout.
5. [api.md](./api.md)
   Public and admin REST/WebSocket contracts.
6. [operations.md](./operations.md)
   Local startup, checks, and backend-specific operations.

## Reference

- [data-contracts.md](./data-contracts.md)
- [jobs-and-scheduling.md](./jobs-and-scheduling.md)
- [provider-integrations.md](./provider-integrations.md)
- [recovery-and-backfill.md](./recovery-and-backfill.md)

## Source Spine

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
