# Swordfish Backend Production Goal

## Outcome

Build the Swordfish backend into a production-ready market-data runtime for an
analytics-heavy and AI-heavy product.

The backend should:

- run one live Massive WebSocket connection by design
- write live bars into Redis for hot product UX
- write live 1-minute bars into Postgres/Timescale-shaped durable storage
- use `bars_1m` as the canonical durable bar table
- use Trigger.dev for production recurring schedules
- expose operator diagnostics that explain provider, Redis, durable-store, job,
  and freshness state
- keep future historical backfill behind a flat-file ingestion boundary once
  Massive futures flat files are available

This file is the canonical current backend contract. When architecture changes,
update this file first, then code and docs.

## Hard Constraints

### One Live Provider Owner

Massive allows this account to use one live WebSocket connection. Swordfish
therefore has one live writer:

- the backend process owns the Massive WebSocket
- `MassiveWSClient` receives live provider bars
- `MarketDataWriter` fans out normalized bars
- Redis, Postgres/Timescale, REST, and browser WebSocket clients are downstream
  readers/projections
- Trigger.dev must not create a second live market-data owner
- frontend clients and future AI tools must never call Massive directly

Scaling happens behind this writer boundary, not by adding competing live
provider connections.

### No Backfill For Now

There is no production backfill path right now.

Do not use Massive REST provider backfill for futures history. It has produced
provider access and rate-limit failures before, and it is no longer part of the
current production architecture.

Historical fill will be added later through Massive futures flat files once
that access exists. Until then:

- Timescale/Postgres is filled live
- Redis is filled live
- missing historical ranges are honest empty or partial states
- no job should pretend to repair futures history through REST backfill
- flat-file ingestion code may exist as a future boundary, but it should not be
  treated as active production coverage

### Production First

There are no users yet, so production is the validation environment. Local
tests still matter for fast regression checks, but the acceptance gate is
production evidence on Railway and Trigger.dev.

It is acceptable to throw away existing production bar data and start fresh.
The important thing now is a clean live-write architecture and current evidence
that new bars are flowing correctly.

## Runtime Architecture

### Data Flow

```text
Massive live WebSocket
  -> MassiveWSClient
  -> normalized Bar
  -> MarketDataWriter
       -> Redis hot projections
       -> DurableBarWriter
            -> Postgres/Timescale bars_1m
       -> backend WebSocket fanout
  -> REST/admin/tool read services
       -> Redis for hot/live UX
       -> bars_1m for durable 1m history and analytics
```

### Redis Role

Redis is the hot product-serving layer. It is fast, temporary, and rebuildable.
It is not historical truth.

Redis should store:

- latest bar per active/open ticker
- temporary 1-second bars for the currently open ticker only
- one rolling week of 1-minute bars for fast charts and lightweight analytics
- live session state used by the frontend
- snapshots and front-month/current-contract cache
- subscription and coverage projection state
- job status and short-lived operator state

Redis retention contract:

- 1-second bars are temporary and exist to make the open ticker feel live
- 1-second bars older than the live window should expire
- anything one minute or more in the past should be represented as 1-minute
  bars only
- 1-minute Redis bars should retain one rolling week
- Redis may be wiped weekly without data-loss concerns because durable 1-minute
  history lives in Postgres/Timescale

Open implementation detail to lock in during the Redis hardening slice:

- open-ticker 1-second bars retain for 60 seconds
- open-ticker switching does not need to delete old 1-second keys immediately;
  retention handles cleanup
- Redis 1-minute bars retain for one rolling week

### Postgres/Timescale Role

Postgres is the durable analytics store. Timescale features are useful when
available, but the schema must boot on plain Postgres too.

Durable bar contract:

- `bars_1m` is the canonical durable bar table
- live WebSocket writes upsert into `bars_1m` with `source=live_ws`
- durable writes are idempotent by `(symbol, ts)`
- old/general `bars` is legacy and should be removed from new write paths
- analytics, backtesting, AI tools, and admin durability checks read from
  `bars_1m`
- production may discard previous bar data and start fresh with new live bars

Durable operational contract:

- operational runs should be durable enough for incident review
- Trigger/job runs should have durable status where practical
- provider/durable/Redis failure paths should emit telemetry and Sentry context
- admin actions that mutate runtime state should be auditable

No stale-contract deletion is required in Timescale/Postgres. We keep durable
history for analytics and future backtesting. Redis contract/front-month caches
are temporary and weekly-wipe tolerant.

## Service Boundaries

Primary source paths:

- `backend/src/server/index.ts`
- `backend/src/server/api/massive/ws_client.ts`
- `backend/src/services/market_data_writer.ts`
- `backend/src/services/durable_bar_writer.ts`
- `backend/src/server/data/redis_store.ts`
- `backend/src/server/data/timescale_store.ts`
- `backend/src/server/api/rest_client.ts`
- `backend/src/services/analytics_tool_service.ts`
- `backend/src/server/job_runtime.ts`
- `backend/src/jobs/*`
- `backend/src/trigger/scheduled_jobs.ts`
- `backend/src/utils/sentry.ts`
- `backend/src/utils/telemetry.ts`

Boundary rules:

- transport code receives provider events; it does not own persistence policy
- `MarketDataWriter` owns live fanout across Redis, durable storage, and
  failure reporting
- `DurableBarWriter` owns durable bar batches for live and future flat-file
  ingestion
- `MarketDataRepository`/tool services own read fallback and response metadata
- route handlers call service contracts; they should not grow raw Redis or SQL
  behavior
- Trigger tasks call backend admin endpoints; they own production schedules but
  do not import backend runtime singletons, duplicate business logic, or
  instantiate live WebSocket ownership

## Trigger.dev Production Contract

Production recurring schedules should be owned by Trigger.dev once validated.

Current Trigger project setup page says:

```bash
npx trigger.dev@latest init -p proj_zxdiyvcgdmoxjfnbyzzh
pnpm dlx trigger.dev@latest dev
```

Repo-local preferred command for dev validation:

```bash
cd backend
pnpm dlx trigger.dev@latest dev
```

Production schedule contract:

- Trigger.dev owns recurring production schedules
- backend local cron duplication should be disabled in production with
  `HUB_ENABLE_SCHEDULED_JOBS=false` once Trigger schedules are live
- startup hydration remains separate from recurring schedules
- production Trigger tasks are backend-bound admin callbacks because the
  Railway backend owns Redis, provider clients, durable stores, and the running
  live client
- Trigger tasks must not open a live Massive WebSocket

Required Trigger validation:

- authenticate the Trigger CLI
- initialize or bind the backend to project `proj_zxdiyvcgdmoxjfnbyzzh`
- verify Trigger dev can load the task files
- deploy production Trigger tasks
- verify schedules in the Trigger dashboard
- manually run at least one production task and confirm telemetry/Sentry/job
  status output

## Workstreams

### P0. Rewrite Docs Around The Current Contract

Goal: remove stale architecture assumptions and make the live-only data path
obvious.

Tasks:

- update backend docs to say no REST backfill is active
- add a dedicated Redis/Timescale structure document
- document the flow of a bar from Massive WebSocket to Redis and `bars_1m`
- document Redis 1-second temporary open-ticker bars
- document Redis one-week 1-minute hot cache
- document `bars_1m` as canonical durable truth
- mark old/general `bars` as legacy and remove it from the intended path

Acceptance:

- a new markdown document details Redis keys, durable tables, and bar flow
- no current doc describes provider REST backfill as the production repair path
- `goal.md` and backend docs agree

### P0. Remove Active Backfill Behavior

Goal: make it impossible for production runtime to silently use provider REST
backfill as the current history repair mechanism.

Tasks:

- inspect startup, reconnect, recovery, admin, and job paths for backfill calls
- disable or remove automatic provider REST backfill behavior
- keep future flat-file ingestion boundaries clearly inactive until files exist
- update coverage statuses so missing history is honest and not framed as
  pending REST backfill
- adjust tests around recovery/backfill wording and behavior

Acceptance:

- production boot does not start provider REST history repair
- reconnect behavior does not call REST backfill for futures history
- admin surfaces do not advertise REST backfill as the current solution
- tests cover the disabled/no-backfill contract

### P0. Make Redis Retention Match Product UX

Goal: Redis gives the frontend a lively open-ticker experience without becoming
durable history.

Tasks:

- add or tighten Redis key families for open-ticker 1-second bars
- retain temporary 1-second bars only for the open ticker/live window
- retain one rolling week of 1-minute Redis bars
- ensure older chart/history reads use 1-minute bars, not stale 1-second data
- document and test retention/index cleanup

Acceptance:

- open ticker can receive live second updates
- one-minute-or-older data is represented by 1-minute bars only
- Redis can be wiped weekly without losing durable analytics data
- `bun run test:redis` covers the retention contract with reachable Redis

### P0. Make `bars_1m` The Only Durable Bar Path

Goal: new durable market data writes go only to `bars_1m`.

Tasks:

- inspect all references to legacy `bars`
- remove legacy `bars` creation/write/read paths if no longer needed
- if a production migration is needed, prefer a fresh-start migration over
  preserving old bar data
- verify live WebSocket writes upsert `source=live_ws` rows into `bars_1m`
- keep Timescale extension features optional

Acceptance:

- no active runtime writer targets legacy `bars`
- production durable verification shows current `bars_1m` rows with
  `source=live_ws`
- analytics/backtesting read path points at `bars_1m`
- `bun run test:timescale` passes against reachable Postgres/Timescale

### P0. Finish Trigger.dev And Railway Production Validation

Goal: prove the scheduled-job and data-layer runtime in production, not just
locally.

Tasks:

- authenticate Trigger CLI
- run Trigger dev against the backend task directory
- deploy Trigger tasks to the configured project
- verify dashboard schedules
- configure Trigger production env with `BACKEND_BASE_URL` and `HUB_API_KEY`
- set production backend cron duplication correctly
- verify Railway production env points at the intended Redis and Postgres
- verify `/health`, `/admin/health`, `/admin/ops`, and durable inspection
  endpoints in production
- verify current live `bars_1m` rows are being written from WebSocket data

Acceptance:

- Trigger deployment shows the expected production schedules/tasks
- Trigger manual run evidence is captured
- Railway backend reports Redis and durable Postgres connected
- production evidence shows live `source=live_ws` rows in `bars_1m`
- no active runtime path relies on local-only state

### P1. Security, Audit, And Observability Pass

Goal: operator surfaces are useful without being careless.

Tasks:

- final admin route security review
- verify admin endpoints have the intended auth/rate-limit posture
- add Sentry breadcrumbs/tags for provider recovery, Redis write failures,
  durable write failures, and job failures
- add telemetry coverage for live write counts, durable write failures, Redis
  partial failures, stale data, Trigger job starts/finishes, and admin commands
- make production failure modes visible in health/admin responses

Acceptance:

- admin mutation routes are protected or deliberately documented
- Sentry events include useful context such as `run_id`, `job_name`, `symbol`,
  `provider`, and `ingestion_source`
- logs/metrics can explain why a symbol is missing, stale, or partial

### P1. Analytics And AI Read Contracts

Goal: future frontend analytics and AI tools use typed backend services, not raw
infrastructure coupling.

Tasks:

- keep `AnalyticsToolService` as the tool-safe read boundary
- make range responses include source, freshness, and quality metadata
- preserve explicit empty/partial states
- avoid making frontend clients choose between Redis and Postgres directly

Acceptance:

- tool-safe reads can explain coverage and freshness
- chart and analytics APIs do not expose infrastructure internals as product
  decisions

### P2. Future Flat-File Historical Ingestion

Goal: prepare the right boundary for historical data without pretending it is
available today.

Tasks:

- keep or create a flat-file ingestion service boundary
- wait for Massive futures flat-file access
- define parser contracts once real files are available
- write parsed 1-minute bars through `DurableBarWriter`
- record ingestion runs and quality summaries

Acceptance:

- no production code claims flat-file history is available before access exists
- once files exist, historical ingestion writes into `bars_1m` through the same
  durable path as live bars

## Verification Commands

Fast local regression checks:

```bash
cd backend
bunx tsc --noEmit --skipLibCheck
bun run test:smoke
```

Redis-backed check:

```bash
cd backend
bun run test:redis
```

Postgres/Timescale-backed check:

```bash
cd backend
bun run test:timescale
```

Trigger local dev check:

```bash
cd backend
pnpm dlx trigger.dev@latest dev
```

Production checks:

- Trigger.dev dashboard schedules and latest runs
- Railway backend logs around startup and jobs
- production `/health`
- production `/admin/health`
- production `/admin/ops`
- production durable inspection for recent `bars_1m source=live_ws`

Do not use local-only green tests as final proof for this goal. They are
regression checks. Production evidence is the gate.

## Current Status

Done or partially done:

- goal state in the Codex tool may still show `blocked` from the earlier
  Trigger-auth blocker; the live project status is no longer blocked and the
  real remaining acceptance item is first automatic Trigger schedule evidence
- Trigger.dev integration files and tests exist
- scheduled jobs are wrapped instead of rewritten
- a test guards against Trigger tasks opening a live Massive WebSocket
- job observability helper exists for telemetry/Sentry breadcrumbs
- local Redis and Timescale-backed tests have passed with OrbStack services
- provider-disabled boot mode exists for health/admin smoke checks
- backend docs now describe the live-only no-backfill contract
- `docs/backend/redis-timescale-bar-flow.md` documents Redis, `bars_1m`, and
  the flow of a live bar
- automatic startup/reconnect provider REST backfill is disabled
- `/admin/recovery/backfill` is authenticated but returns `410 disabled`
- the active Timescale schema no longer creates or writes legacy `bars`
- production data-layer verifier checks that provider REST backfill is disabled
- Redis now writes temporary 1-second bars only for `meta:open_ticker`
- Redis writes direct 1-minute bars for every live symbol with one-week
  retention
- `/bars/open-ticker` exposes the current open-ticker hint for the frontend
- open-ticker mutations require an allowed browser origin
- Railway production backend deployed the no-backfill, `bars_1m`, and Redis
  open-ticker hardening slice in deployment
  `c13e90a6-d86a-4cc8-888d-f471cc9bce14`
- an earlier Railway deploy attempt,
  `3503827d-729e-472a-a82b-3172d9ffc28e`, failed because `--path-as-root`
  conflicted with the service root-directory config; deploy backend from the
  repo root with `railway up --service mk3-backend --environment production`
- production `/health` reports Redis, Postgres/Timescale, and Massive WS
  connected on `https://mk3-backend-production.up.railway.app`
- production verifier passed against Railway with live durable
  `bars_1m source=live_ws` rows, disabled backfill, and hot-cache rebuild
  dry-run checks
- production `/admin/recovery/backfill` returns `410 disabled`
- production `/bars/open-ticker` origin protection was verified and reset to
  `null`
- direct admin mutation routes now record durable `admin_action` operational
  runs, emit `swordfish.admin_action.*` metrics, and attach Sentry context on
  failure
- `/bars/open-ticker` `DELETE` is included in CORS method headers and covered by
  the REST route test
- Railway production backend deployed the admin-action audit and open-ticker
  CORS hardening slice in deployment
  `8e8c5e66-1046-42ba-95cb-feab18569fc8`
- production CORS preflight for `/bars/open-ticker` now advertises
  `GET, POST, DELETE, OPTIONS` for `https://swordfsh.app`
- production durable operational runs show an `admin_action` success record for
  `recovery-backfill-disabled` after the latest deploy
- production data-layer verifier passed again after the latest deploy with live
  `bars_1m source=live_ws` rows, disabled backfill, and hot-cache rebuild
  dry-run checks
- admin browser-origin checks now use `HUB_ADMIN_ALLOWED_ORIGINS`
  independently from public `HUB_ALLOWED_ORIGINS`, with tests covering allowed
  local admin origin and rejected unknown origins
- Railway production backend deployed the admin origin policy hardening in
  deployment `975601bc-db24-44a6-b09e-673e2629ddd7`
- production rejected a disallowed browser-origin admin request with `403`
  after the admin origin hardening deploy
- production data-layer verifier passed again after the admin origin hardening
  deploy with live `bars_1m source=live_ws` rows, disabled backfill, and
  hot-cache rebuild dry-run checks
- Redis client errors now emit `swordfish.redis.client_error` telemetry and
  throttled Sentry context
- contract-provider success, empty, HTTP failure, and network failure paths now
  emit `swordfish.provider_contract_fetch.*` telemetry with Sentry context for
  provider failures
- Railway production backend deployed the provider/Redis observability hardening
  in deployment `45e9522d-f3cd-4ada-b4e2-4dfc24edb8bc`
- production data-layer verifier passed again after the provider/Redis
  observability deploy with live `bars_1m source=live_ws` rows, disabled
  backfill, and hot-cache rebuild dry-run checks
- Trigger.dev CLI auth now works for project `proj_zxdiyvcgdmoxjfnbyzzh`
- Trigger.dev local dev loaded the backend task files successfully with worker
  version `20260526.1`
- Trigger.dev production deploy succeeded for version `20260526.2`,
  deployment `fr5d5041`, with four detected tasks
- the previous Trigger.dev production deploy attempt failed as deployment
  `55oqe4hn` because task import required backend runtime env such as
  `REDIS_HOST`; tasks now call backend admin endpoints instead of importing
  backend runtime singletons
- Trigger.dev production env currently has default Trigger/OpenTelemetry
  variables only; it is missing `BACKEND_BASE_URL` and `HUB_API_KEY`
- a production manual run was created for `snapshot-refresh`:
  `run_cmpmlry8o42xs0hoo6r54po3b`; it failed with
  `BACKEND_BASE_URL is required for backend-bound Trigger.dev tasks`, proving
  the next blocker is Trigger production env configuration rather than deploy
  auth or task import
- Railway production backend deployed the Trigger backend-callback compatibility
  slice in deployment `6332b3d3-d9d8-4d84-aa26-465452bb000f`
- production data-layer verifier passed again after the Trigger
  backend-callback deploy with live `bars_1m source=live_ws` rows, disabled
  backfill, and hot-cache rebuild dry-run checks
- `trigger.config.ts` now syncs only `BACKEND_BASE_URL` and `HUB_API_KEY` to
  Trigger.dev with the official `syncEnvVars` extension during authenticated
  deploys
- Trigger.dev production env now contains `BACKEND_BASE_URL` and `HUB_API_KEY`
  with values hidden by the CLI
- Trigger.dev production deploy `ia65pbxu`, version `20260526.4`, is current,
  deployed, and reports four tasks
- Trigger.dev dashboard schedules were verified in production:
  `daily-clear` at `0 2 * * *`, `snapshot-refresh` at `5 2 * * *`,
  `front-month-refresh` at `0 3 * * *`, and `subscription-refresh` at
  `5 0 1 * *`, all in `America/New_York`
- production manual Trigger run `run_cmpmmchiw4mra0hmze7iphf5d` for
  `snapshot-refresh` completed successfully and returned backend job status
  with `lastSuccess=true` and `symbolsUpdated=171`
- Railway production has `HUB_ENABLE_SCHEDULED_JOBS=false`, so recurring
  backend-local cron duplication is disabled while Trigger.dev owns schedules
- production data-layer verifier passed again at `2026-05-26T12:49Z` after
  the Trigger/env work, with Redis connected, Timescale/Postgres connected,
  Massive WS connected, live `bars_1m source=live_ws` rows, disabled provider
  REST backfill, and hot-cache rebuild dry-run checks

Still required:

- monitor the first automatic Trigger scheduled run after the next 2:00 AM ET
  window on `2026-05-27` and confirm it matches the manual-run evidence

## Definition Of Done

This backend goal is done when:

- live Massive data flows through one backend-owned WebSocket
- Redis serves hot latest/open-ticker/one-week 1-minute UX state
- temporary 1-second Redis data is limited to the open ticker/live window
- durable 1-minute bars are written to `bars_1m` with `source=live_ws`
- legacy `bars` is no longer part of the active durable write path
- no production runtime path relies on REST provider backfill
- Trigger.dev owns production recurring schedules
- Railway production health/admin endpoints prove Redis and durable storage are
  connected
- production evidence proves current live bars are being written durably
- admin routes have a reviewed security/audit posture
- Sentry and telemetry can explain provider, Redis, durable, and job failures
- docs describe the actual Redis/Timescale structure and the flow of a bar
