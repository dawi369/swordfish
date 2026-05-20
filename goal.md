# MK3 Dream Data Layer Handoff

## Current Goal

Build MK3 into an analytics-first backend for real-time futures data: a reliable
market-data brain that can later power a ChatGPT-like product with safe custom
tools, live context, historical context, and auditable operations.

The frontend is intentionally out of scope for this phase. The backend/data/API
layer must become boring, inspectable, durable, and easy to operate before the
next UI is rebuilt on top of it.

## Direction

Use the current stack and make the boundaries correct:

- Postgres is the durable analytics store and source of record from the
  migration point forward.
- TimescaleDB/TigerData is the likely upgrade path, but the schema must boot on
  plain Railway Postgres first.
- Redis remains the hot serving/cache layer for latest bars, RedisTimeSeries
  chart windows, sessions, snapshots, live fanout, and fast bootstrap.
- Redis must be rebuildable from durable `bars_1m`; it is not archival truth.
- Massive WebSocket is the live source.
- Massive REST is the temporary bounded backfill source.
- Massive flat files, when available, must write through the same ingestion
  boundary into the same durable model.
- AI/tooling should call typed backend service APIs, not raw Redis/Postgres.

Do not introduce Databricks, ClickHouse, Upstash, Supabase, Neon, or Datadog
clients as foundational dependencies until the specific need is proven. Less is
more: reliability, auditability, and simple recovery paths are more important.

## What Has Been Implemented So Far

### Durable Store Foundation

- `backend/src/server/data/timescale_store.ts`
  - Boots on plain Postgres when `DATABASE_URL` exists.
  - Enables Timescale hypertables/continuous aggregates only if the extension is
    available.
  - Owns canonical `bars_1m` upserts and reads.
  - Adds durable schema support for:
    - `bars_1m`
    - `operational_runs`
    - `ingestion_runs`
    - `provider_fetch_outcomes`
    - `data_quality_summaries`
  - Adds `quality_flags` on `bars_1m`.
  - Exposes durable stats for symbol counts, bar counts, first/last timestamps,
    gap counts, and spike counts.

### Write/Read Boundaries

- `backend/src/services/market_data_writer.ts`
  - Centralizes live bar fanout to Redis, local recovery, and durable storage.
- `backend/src/services/durable_bar_writer.ts`
  - Centralizes durable historical/provider/flat-file-style batch writes through
    `writeDurableBars`.
  - Reports partial failures without taking down the live path.
- `backend/src/services/flat_file_ingestion_service.ts`
  - Provides the future flat-file entrypoint and routes parsed bars through the
    same `source=flat_file` durable boundary.

- `backend/src/services/market_data_repository.ts`
  - Reads Redis first for chart ranges.
  - Falls back to durable `bars_1m` for empty `tf=1m` Redis ranges.
  - Returns a source label: `redis`, `timescale`, or `empty`.

- `backend/src/services/recovery_service.ts`
  - Provider backfills now write to durable `bars_1m`.
  - Provider fetch outcomes are recorded durably as success, empty, or failed.

### Redis Hot-Cache Rebuild

- `backend/src/services/hot_cache_rebuilder.ts`
  - Can dry-run latest-week Redis rebuild from durable `bars_1m`.
  - Can perform the rebuild by writing recovered bars back to Redis.

- Admin APIs expose:
  - `POST /admin/hot-cache/rebuild?dryRun=true`
  - `POST /admin/hot-cache/rebuild?dryRun=false`
  - admin command ids `hot-cache-rebuild-dry-run` and `hot-cache-rebuild`

### Admin Coverage And Diagnostics

- `backend/src/server/api/rest_client.ts`
  - `/admin/health` now includes durable stats and coverage classification.
  - `/admin/ops` is the consolidated operator state.
  - `/admin/coverage` returns subscribed/latest/durable symbol coverage.
  - Missing/stale data is classified as:
    - `ok`
    - `not_subscribed`
    - `subscribed_no_live_data`
    - `provider_no_data`
    - `stale_contract`
    - `backfill_pending`
  - Provider-empty evidence is now required before classifying a symbol as
    `provider_no_data`; otherwise missing durable/provider evidence remains
    `backfill_pending`.

### Durable Inspection And Tool-Safe Contracts

- Admin APIs expose typed durable inspection views:
  - `GET /admin/durable/symbols`
  - `GET /admin/durable/bars/latest`
  - `GET /admin/durable/provider-outcomes`
  - `GET /admin/durable/operational-runs`
  - `GET /admin/durable/ingestion-runs`
  - `GET /admin/durable/quality/:symbol`

- `backend/src/services/analytics_tool_service.ts`
  - Provides safe service-level functions for future LLM/tool adapters.
  - Covers latest market state, symbol coverage explanations, range bars with
    quality metadata, provider/backfill status, and dry-run diagnostics.
  - Keeps future tools away from raw Redis/Postgres access.

- `backend/src/services/data_quality.ts`
  - Provides focused quality helpers for invalid OHLC, zero/negative volume,
    missing intervals, and close-to-close jumps.
  - Used by durable `bars_1m` writes for per-bar `quality_flags`.

### Runtime Hot-Cache Rebuild

- `HUB_REBUILD_HOT_CACHE_ON_STARTUP=false`
  - Opt-in startup rebuild from durable `bars_1m`.
  - Default remains conservative until production Postgres is verified.
  - Startup rebuild runs are recorded as `operational_runs`.
  - Rebuild failures are recorded and logged but do not block process startup.

### Query-Time Data Quality

- `/bars/range/:symbol` now returns quality metadata:
  - `gapCount`
  - `spikeCount`
  - `invalidOhlcCount`
  - `zeroVolumeCount`
  - `negativeVolumeCount`
  - `oldestBarTs`
  - `newestBarTs`
  - `freshness`

- Quality thresholds are configurable:
  - `DATA_QUALITY_GAP_THRESHOLD_MS=90000`
  - `DATA_QUALITY_SPIKE_THRESHOLD_PCT=0.25`

- Admin/tool quality reads can persist `data_quality_summaries` rows so gap,
  spike, and invalid-bar summaries have an audit trail tied to the requested
  symbol/range/thresholds.

### Auditability And Observability

- `backend/src/utils/operational_runs.ts`
  - Jobs, recovery paths, and admin actions use durable operational-run records.

- `backend/src/utils/telemetry.ts`
  - Emits structured metric events as JSON logs in production.
  - Quiet in tests.
  - Designed so Datadog can ingest log-derived metrics later without adding an
    in-process Datadog dependency now.
  - Provider fetches emit log-derived metrics for success, empty, and failed
    outcomes plus returned bar counts and run symbol counts.

- `backend/src/utils/sentry.ts`
  - Sentry supports `SENTRY_ENVIRONMENT` and `SENTRY_RELEASE`.
  - Sentry remains the exception/degraded-condition tool.
  - High-value events now include context tags such as `run_id`, `job_name`,
    `symbol`, `ingestion_source`, and provider/recovery source when available.

### Documentation Updated

- `docs/backend/data-layer.md`
- `docs/backend/api.md`
- `docs/backend/operations.md`
- `docs/roadmap/data-layer-migration-plan.md`
- `docs/decisions/ADR-0002-redis-as-hot-source-of-truth.md`
- `docs/runbooks/railway-deploy.md`
- `docs/specs/backend-data-layer-v1.md`
- `docs/specs/observability-metrics.md`
- `backend/README.md`
- `backend/.env.example`

## Current Verification State

The current backend work passes:

```bash
cd backend
bunx tsc --noEmit --skipLibCheck
bun run test:smoke
bun run test
bun run test:unit
```

The production data-layer acceptance gates have a verifier script:

```bash
cd backend
BACKEND_BASE_URL=https://mk3-backend-production.up.railway.app \
HUB_API_KEY=... \
bun run verify:production-data-layer
```

The verifier requires the latest durable `source=live_ws` row to be recent by
default, using `PRODUCTION_DATA_LAYER_MAX_LIVE_BAR_AGE_MS` only for deliberate
one-off activation checks during known market pauses.

Last known smoke result:

- 88 pass
- 9 skip
- 0 fail

The skipped tests are environment-dependent Redis, Postgres/Timescale, and live
provider tests. Redis integration tests run with `bun run test:redis`, which
sets `RUN_REDIS_TESTS=1` and requires a reachable Redis instance. Postgres/
Timescale tests run with `bun run test:timescale`, which sets
`RUN_TIMESCALE_TESTS=1` and requires a reachable database.

## Important Current Caveat

Railway Postgres has been provisioned in the Swordfish production environment,
`mk3-backend` has `DATABASE_URL` wired to the Railway Postgres service by
Railway variable reference, and production `/health` currently reports Redis,
durable Postgres, and Massive WebSocket connected.

The remaining production blocker is Massive REST backfill access/rate limiting,
not the durable live-write path. The production verifier now passes public
health, durable store stats, latest durable `bars_1m` rows, recent live
`source=live_ws` rows, coverage durable symbol counts, and hot-cache rebuild
dry-run. It still fails the provider outcome and successful ingestion-run gates
because manual provider backfills are returning `403 Forbidden` / `429 Too Many
Requests` instead of bars.

The targeted manual recovery endpoint is deployed and behaves correctly:

```bash
POST /admin/recovery/backfill?symbols=NQM6
# returns only ["NQM6"], but Massive REST currently returns 403 Forbidden
```

Railway also had a public major service disruption on May 20, 2026 affecting
login, dashboard/API/control-plane, deploy, and workload recovery paths. Treat
Railway login/API failures during this window as external infrastructure if
normal CLI auth regresses again.

Normal Railway CLI inspection is still noisy locally because the old OAuth
refresh token is stale. Token-scoped project commands work.

Historical auth evidence from earlier in the session:

```bash
railway status
# Warning: failed to refresh OAuth token: Token refresh failed: unknown: HTTP 404 Not Found. Please run `railway login` again.
# Failed to fetch: error decoding response body

railway whoami
# Warning: failed to refresh OAuth token: Token refresh failed: unknown: HTTP 404 Not Found. Please run `railway login` again.
# Failed to fetch: error decoding response body

railway whoami
# After CLI upgrade and aborted browser pairing: invalid_grant followed by
# Unauthorized. Please run `railway login` again.
```

Non-interactive login is also blocked in this Codex shell unless token auth is
provided:

```bash
railway login
# Cannot login in non-interactive mode. For non-interactive environments, set RAILWAY_API_TOKEN or RAILWAY_TOKEN.

railway login --browserless
# Browserless login requires an interactive terminal. For non-interactive environments, set RAILWAY_API_TOKEN or RAILWAY_TOKEN.

railway login --browserless
# Before CLI upgrade: Device authorization request failed (HTTP 404 Not Found): /oauth/device/auth

railway upgrade --check
# Install method: Homebrew
# Binary path: /opt/homebrew/bin/railway
# Upgrade command: brew upgrade railway

brew upgrade railway
# Upgraded railway 4.58.0 -> 4.59.0

railway login --browserless
# Emits an activation code and waits at https://railway.com/activate.
# The latest Codex attempt was stopped after the browser pairing was not completed.
```

Authenticated-shell options:

```bash
# Interactive terminal:
railway login
railway status

# Browser pairing from Codex/TTY:
railway login --browserless
# Open https://railway.com/activate and enter the emitted code before it expires.

# Non-interactive terminal:
export RAILWAY_TOKEN=...
railway whoami
railway status
```

Do not store Railway tokens in repo files, `.env` examples, docs, shell history
snippets, or shared logs.

The code and production service are ready for the final acceptance check once
Massive REST allows bounded backfill requests again:

- run targeted `/admin/recovery/backfill?symbols=<symbol>`
- confirm `provider_fetch_outcomes` records success or empty evidence
- confirm `ingestion_runs` records a successful manual backfill with bars
- rerun `bun run verify:production-data-layer`

Local durable verification fallback while Railway is unavailable:

```bash
docker compose --profile durable up -d timescaledb
cd backend
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
  bun run test:timescale
```

Current local machine caveat: Docker CLI is present, and
`docker compose --profile durable config` validates the opt-in Timescale service,
but Docker/OrbStack is not running:

```bash
docker compose --profile durable up -d timescaledb
# Cannot connect to the Docker daemon at unix:///Users/dawi/.orbstack/run/docker.sock.
```

## Completion Audit - 2026-05-20

Objective: implement the backend/data/API foundation for an analytics-first,
LLM-tool-ready market-data layer.

Audit result: local implementation is substantially complete and verified, but
the overall goal is not complete until production Railway Postgres is provisioned
and the production verifier passes.

| Requirement | Evidence | Status |
|---|---|---|
| Plain Postgres durable schema with optional Timescale features | `backend/src/server/data/timescale_store.ts`; covered by smoke plus skipped DB integration tests requiring `RUN_TIMESCALE_TESTS=1` and a reachable DB | Locally verified, production unverified |
| Redis remains hot serving and is rebuildable from durable `bars_1m` | `market_data_repository.ts`, `hot_cache_rebuilder.ts`, `/admin/hot-cache/rebuild`, startup option `HUB_REBUILD_HOT_CACHE_ON_STARTUP=false`; durable range/quality failures degrade without breaking Redis ranges | Locally verified |
| Live writes fan out to Redis, recovery, and durable store | `market_data_writer.ts`, `market_data_writer.test.ts` | Locally verified |
| Provider/flat-file-style durable batch writes use one boundary | `durable_bar_writer.ts`, `flat_file_ingestion_service.ts`, `recovery_service.ts`, `durable_bar_writer.test.ts`, `flat_file_ingestion_service.test.ts`; ingestion runs are recorded as started/success/failed | Locally verified |
| Durable admin inspection endpoints | `/admin/durable/symbols`, `/admin/durable/bars/latest`, `/admin/durable/provider-outcomes`, `/admin/durable/operational-runs`, `/admin/durable/ingestion-runs`, `/admin/durable/quality/:symbol`; `rest_client.test.ts` | Locally verified |
| Deterministic coverage semantics | `rest_client.test.ts` covers `ok`, `not_subscribed`, `subscribed_no_live_data`, `provider_no_data`, `stale_contract`, `backfill_pending` | Locally verified |
| Query-time quality metadata and durable summaries | `data_quality.ts`, `market_data_repository.ts`, `timescale_store.ts`, `data_quality.test.ts`, `rest_client.test.ts`, `analytics_tool_service.test.ts` | Locally verified |
| Tool-safe service contracts for future LLM tools | `analytics_tool_service.ts`, `analytics_tool_service.test.ts`; tool range reads stay usable if durable quality-summary audit recording fails | Locally verified |
| Sentry/log-derived telemetry context | `sentry.ts`, `sentry.test.ts`, `telemetry.ts`, recovery/job/admin write paths, `docs/specs/observability-metrics.md` | Locally verified by type/test coverage and docs |
| Production Railway durable-store activation | Railway Postgres service is provisioned; `DATABASE_URL` is wired by Railway variable reference; `mk3-backend` deployment `8dda61aa-ba73-4724-9673-6408af8dc643` is `SUCCESS`; `/health` reports Redis, durable Postgres, and Massive WebSocket connected; production verifier passes durable/live/coverage/hot-cache checks; provider REST backfill still returns `403 Forbidden` / `429 Too Many Requests`, so provider outcome and ingestion-run-with-bars gates fail | Partially verified, blocked on Massive REST |

Latest local verification:

```bash
cd backend
bunx tsc --noEmit --skipLibCheck
bun run test:smoke
# 88 pass, 9 skip, 0 fail, 273 expect() calls, 97 tests across 17 files
bun run test:unit
# 91 pass, 24 skip, 0 fail, 278 expect() calls, 115 tests across 21 files
bun run test
# 134 pass, 36 skip, 0 fail, 607 expect() calls, 170 tests across 36 files
```

Latest production verifier result after the targeted-backfill deployment:

```bash
cd backend
BACKEND_BASE_URL=https://mk3-backend-production.up.railway.app \
bun run verify:production-data-layer
# PASS public health serving stores
# PASS admin health durable store: symbols=12 bars=1780
# PASS durable bars_1m rows
# PASS live durable bars_1m rows
# PASS coverage durable symbol counts
# PASS hot cache rebuild dry run
# FAIL provider fetch outcomes
# FAIL durable ingestion runs
```

Production completion gate:

```bash
cd backend
BACKEND_BASE_URL=https://mk3-backend-production.up.railway.app \
HUB_API_KEY=... \
bun run verify:production-data-layer
```

## Remaining Implementation Slice

### 1. Finish Provider REST Backfill Acceptance

Goal: complete the last production gate after durable live writes are already
verified.

Tasks:

- Wait for Massive REST access/rate limits to recover or adjust the provider
  account/quota.
- Run a targeted manual recovery backfill for one liquid symbol.
- Confirm `provider_fetch_outcomes` records success or empty evidence.
- Confirm `ingestion_runs` records a successful manual backfill with bars.
- Rerun `bun run verify:production-data-layer` from the backend package.

Acceptance:

- `provider_fetch_outcomes` includes useful manual backfill evidence.
- `ingestion_runs` includes a successful manual backfill with bars.
- The production verifier exits 0.
- Only then mark the goal complete.

## Locally Completed Slices

These were originally implementation slices, but they are now covered by the
local code, docs, and tests listed in the completion audit above. Do not redo
these unless the production verifier exposes a real gap.

### 2. Add Durable Query/Inspection Endpoints

Goal: make durable data inspectable without exposing raw SQL.

Add admin endpoints for:

- recent durable symbols
- latest durable bar per symbol
- provider fetch outcomes by symbol
- operational runs by type/status
- ingestion runs by source/status
- data quality summary for a symbol and time range

Keep responses typed, paginated/limited, and safe for future AI tools.

Acceptance:

- Admin can answer: what symbols are durable, which are stale, which provider
  calls returned empty, which jobs/backfills failed, and when.
- Tests cover auth, response shape, empty states, and error states.

### 3. Tighten Coverage Semantics

Goal: make missing ticker diagnosis precise.

Improve classification with provider outcomes:

- `provider_no_data` only when a recent provider fetch returned empty.
- `backfill_pending` when no durable/provider evidence exists yet.
- `stale_contract` when latest Redis bar is old and symbol is not in current
  subscription or current active contracts.
- `subscribed_no_live_data` when subscribed but no live bar has arrived within
  an expected market/session window.

Acceptance:

- Coverage status is deterministic and documented.
- Tests cover each coverage class.
- `/admin/coverage` gives actionable next steps.

### 4. Make Redis Rebuild A Runtime Startup Option

Goal: Redis can recover from durable state after restart or Redis loss.

Tasks:

- Add a startup option such as `HUB_REBUILD_HOT_CACHE_ON_STARTUP=true`.
- Keep the default conservative until production DB is verified.
- Record rebuild runs as `operational_runs`.
- Emit metrics for hydrated symbols, skipped symbols, and bars loaded.

Acceptance:

- Dry-run and real rebuild are tested.
- A backend restart can rebuild latest-week Redis state from durable `bars_1m`.
- Rebuild failures degrade operator status but do not block health forever.

### 5. Harden Data Quality

Goal: trust charts and future AI tools.

Tasks:

- Make spike/gap detection configurable.
- Track gap/spike summaries durably enough for audit.
- Add query-time metadata to range responses:
  - `source`
  - `gapCount`
  - `spikeCount`
  - `oldestBarTs`
  - `newestBarTs`
  - `freshness`
- Avoid false confidence when a symbol is illiquid or out of session.

Acceptance:

- Weird chart spikes can be traced to raw durable bars, provider source, and
  ingestion run.
- Tests cover obvious invalid OHLC, large close-to-close jumps, and missing
  intervals.

### 6. Add Tool-Safe Service Contracts

Goal: prepare for the future ChatGPT-like futures assistant.

Do not build the AI layer yet. First define backend services that are safe to
expose as tools later:

- get latest market state
- get symbol coverage
- get range bars with quality metadata
- get provider/backfill status
- run safe dry-run diagnostics
- explain why a symbol is missing/stale

Acceptance:

- Tool candidates are service-level functions with typed inputs/outputs.
- No tool needs direct Redis/Postgres access.
- Admin-only mutations stay protected and auditable.

### 7. Sentry And Datadog Follow-Through

Goal: production incidents are explainable.

Sentry:

- Ensure production sets `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, and
  `SENTRY_RELEASE`.
- Add Sentry context/tags for ingestion source, run id, symbol, and job name on
  high-value exceptions.

Datadog:

- Start by ingesting structured `metric` logs.
- Create dashboards/monitors for:
  - durable store connected
  - market data partial write failures
  - stale symbol count
  - spike symbol count
  - provider empty/failed outcome rate
  - admin repair command usage
  - operational run failures
- Only add a Datadog client if log-derived metrics are insufficient.

Acceptance:

- A production failure can be traced from Sentry event to operational run to
  provider outcome to affected symbols.

## Commands For The Next Codex Instance

Start here:

```bash
cd /Users/dawi/dev/mk3
git status --short
cd backend
bunx tsc --noEmit --skipLibCheck
bun run test:smoke
```

If Railway remains unauthenticated, restore auth first:

```bash
railway login
# or, in non-interactive shells:
export RAILWAY_TOKEN=...
railway whoami
railway status
```

Useful runtime checks once Railway Postgres is configured:

```bash
curl https://mk3-backend-production.up.railway.app/health | jq
railway run --service mk3-backend --environment production -- sh -c 'curl -s -H "X-API-Key: $HUB_API_KEY" https://mk3-backend-production.up.railway.app/admin/health' | jq
railway run --service mk3-backend --environment production -- sh -c 'curl -s -H "X-API-Key: $HUB_API_KEY" https://mk3-backend-production.up.railway.app/admin/coverage' | jq
railway run --service mk3-backend --environment production -- sh -c 'curl -s -X POST -H "X-API-Key: $HUB_API_KEY" "https://mk3-backend-production.up.railway.app/admin/hot-cache/rebuild?dryRun=true"' | jq
BACKEND_BASE_URL=https://mk3-backend-production.up.railway.app HUB_API_KEY=... bun run verify:production-data-layer
```

## Non-Negotiables

- Preserve Redis as hot serving until durable rebuild/read paths are proven.
- Do not claim historical completeness before backfill or flat files populate
  the requested range.
- Do not add a warehouse platform before the Postgres/Timescale foundation is
  operationally solid.
- Keep admin mutations API-key protected and durably audited.
- Keep tests close to behavior: write path, fallback path, coverage classes,
  recovery/backfill, admin auth, and operator diagnostics.
- Favor fewer moving parts over impressive infrastructure.
