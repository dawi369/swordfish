# System Context

MK3 is a monorepo for the Swordfish futures terminal.

## Services

- `frontend/`
  Next.js app for marketing, auth, waitlist, billing/settings scaffolding, and the `/terminal` product surface.
- `backend/`
  Bun market-data hub. It connects to Massive futures APIs, writes hot data to Redis, runs maintenance jobs, and serves REST/WebSocket data to the frontend.
- Redis
  Required hot-path datastore for latest bars, RedisTimeSeries history, sessions, snapshots, active contracts, front-month cache, and runtime metadata.
- Supabase
  Frontend auth/profile/subscription state.
- Railway
  Intended production host for frontend, backend, and Redis.
- Massive
  Upstream futures market-data provider.

## Repo Ownership

- Product UI and hub client: `frontend/src`
- Backend runtime and data layer: `backend/src`
- Cross-service docs and operating model: `docs`
- Service-specific implementation docs that are not yet migrated: `frontend/docs`

## Current Focus

The next engineering phase is backend and data-layer refinement. The docs source of truth for that work is:

- [../backend/data-layer.md](../backend/data-layer.md)
- [../backend/redis-keyspace.md](../backend/redis-keyspace.md)
- [../specs/backend-data-layer-v1.md](../specs/backend-data-layer-v1.md)

