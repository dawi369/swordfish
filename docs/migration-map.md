# Docs Migration Map

This file tracks how existing docs were folded into the new structure.

After migration, the old duplicate docs were deleted so the root `docs/` tree is the source of truth.

| Current doc | Destination | Action |
|---|---|---|
| `README.md` | `docs/README.md`, `docs/architecture/system-context.md` | Repo overview folded into docs index and system context |
| `ARCHITECTURE.md` | `docs/architecture/README.md` | Replaced by architecture index |
| `docs/repo-map.md` | `docs/architecture/system-context.md`, `docs/architecture/runtime-boundaries.md` | Split by system map and ownership boundaries |
| `docs/railway.md` | `docs/runbooks/railway-deploy.md`, `docs/architecture/deployment-topology.md` | Split by operator procedure and deployment model |
| `docs/redis-beta-readiness.md` | `docs/roadmap/known-risks.md`, `docs/specs/backend-data-layer-v1.md` | Folded into risks and backend refinement spec |
| `docs/time_series_redis.md` | `docs/backend/redis-keyspace.md`, `docs/specs/backend-data-layer-v1.md` | Current keyspace verified; rollout goals moved to spec |
| `docs/candle.md` | `frontend/docs/terminal.md` | Frontend UI-specific note remains service-local |
| `backend/docs/system-overview.md` | `docs/backend/README.md`, `docs/architecture/data-flow.md` | Split by backend map and cross-service flow |
| `backend/docs/api-reference.md` | `docs/backend/api.md` | Migrated and source-verified |
| `backend/docs/operations.md` | `docs/backend/operations.md`, `docs/runbooks/railway-deploy.md` | Split by local/backend ops and Railway deploy ops |
| `backend/docs/redis.md` | `docs/backend/redis-keyspace.md` | Migrated and source-verified |
| `backend/docs/database-structures.md` | `docs/backend/data-contracts.md` | Migrated and grouped as contracts |
| `backend/docs/futures-contract-management.md` | `docs/backend/provider-integrations.md`, `docs/backend/jobs-and-scheduling.md` | Split by provider/contract behavior and scheduled jobs |
| `backend/docs/concerns/*` | `docs/roadmap/known-risks.md` | Folded into tracked risks |
| `frontend/docs/*` | unchanged for now | Frontend implementation docs stay service-local until frontend refactor work starts |
