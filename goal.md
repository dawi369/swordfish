# MK3 Durable Analytics Layer Plan

## Executive Intent

Make the backend durable analytics layer live, trusted, and ready for the next
frontend. The target is not a warehouse science project. It is a production
market-data substrate with clear ownership boundaries:

- Redis is the hot serving layer.
- Postgres/Timescale-shaped storage is the durable analytics record.
- Massive WebSocket is the live data source.
- Massive REST is bounded recovery only while access allows it.
- Massive flat files, when available, ingest through the same durable boundary.
- Frontend and future AI tools consume typed backend APIs, not raw Redis or SQL.

The end state is a backend that can answer: what happened, where did the data
come from, how fresh is it, what failed, and which frontend surface should trust
which endpoint.

## Architectural North Star

### Source Ownership

| Layer | Owns | Does Not Own |
|---|---|---|
| Massive WS | Live futures aggregates | History, audit, frontend state |
| Massive REST | Small recovery/backfill windows | Always-on historical completeness |
| Future Massive flat files | Bulk historical completeness | Live serving |
| Redis | Latest bars, RedisTimeSeries windows, sessions, snapshots, active contracts, fanout, fast bootstrap | Durable history or audit truth |
| Postgres/Timescale-shaped store | `bars_1m`, ingestion runs, provider outcomes, operational runs, quality summaries | Browser-facing realtime fanout |
| Backend service APIs | Stable contracts for frontend/tools | Raw datastore leakage |
| Frontend | Presentation, interaction, user workflows | Data repair, source classification, provider behavior |

### Hard Boundary

The frontend should never decide whether Redis, Postgres, REST backfill, or flat
files are correct. It should ask the backend for a typed answer that includes
freshness, source, and quality metadata.

## Current Production State

Already live or implemented:

- Railway production has `mk3-backend`, `mk3-frontend`, `Redis`, and `Postgres`.
- `mk3-backend` has `DATABASE_URL` wired to Railway Postgres by service
  reference.
- `/health` reports Redis, durable Postgres, and Massive WebSocket connected.
- Live WebSocket bars are being written to durable `bars_1m` with
  `source=live_ws`.
- Durable inspection endpoints exist under `/admin/durable/*`.
- `/admin/coverage` classifies symbol data state.
- `/admin/hot-cache/rebuild` can dry-run and execute Redis rebuilds from
  durable bars.
- `market_data_repository` reads Redis first and falls back to durable `bars_1m`
  for empty `tf=1m` Redis ranges.
- `durable_bar_writer` is the shared batch boundary for provider REST and future
  flat-file ingestion.
- `flat_file_ingestion_service` exists as the future flat-file entrypoint.
- Production verifier passes health, durable rows, recent live rows, coverage,
  and hot-cache dry-run.

Current blocker:

- Massive REST backfill returns `403 Forbidden` / `429 Too Many Requests`.
- That prevents provider-outcome and ingestion-run-with-bars verifier gates from
  passing.
- This is likely an upstream access/concurrency/quota issue, not a durable-layer
  write-path issue.

## Target End State

This goal is complete only when all of these are true:

1. Production durable store is live and continuously receiving live
   `source=live_ws` bars.
2. Redis remains healthy as the hot serving layer.
3. Durable store has enough provider or flat-file ingestion evidence to prove
   historical repair works.
4. A bounded hot-cache rebuild from durable storage has been verified.
5. Admin diagnostics explain missing/stale data without manual SQL.
6. Frontend connection points are documented and stable enough for the rebuild.
7. Rollback is documented and keeps live serving intact.
8. `bun run verify:production-data-layer` exits 0 against production, or the
   verifier is intentionally revised with documented rationale.

Do not mark this goal complete while the production verifier fails due to
provider/ingestion evidence.

## Workstream 1 - Production Activation

Purpose: make the durable layer operationally accepted, not merely deployed.

Tasks:

- Confirm `mk3-backend` production deploy is serving the latest durable code.
- Confirm `DATABASE_URL` is present on `mk3-backend` and points to Railway
  Postgres by service reference.
- Confirm durable disabling flags are absent:
  - `DISABLE_DURABLE_STORE=true`
  - `ENABLE_TIMESCALE=false`
- Confirm `/health` reports:
  - `redis=connected`
  - `timescaledb=connected`
  - `massiveWs=connected`
- Confirm `/admin/health` reports non-zero durable symbols and bars.
- Confirm latest durable `source=live_ws` rows are recent during market hours.
- Run `POST /admin/hot-cache/rebuild?dryRun=true`.
- Run the production verifier from the backend package.

Acceptance:

```bash
cd backend
BACKEND_BASE_URL=https://mk3-backend-production.up.railway.app \
bun run verify:production-data-layer
```

The verifier must exit 0, unless the only failing gate is explicitly re-scoped
in this file and the replacement gate proves the same production property.

## Workstream 2 - Provider And Historical Ingestion

Purpose: prove the durable layer can receive non-live bars through a controlled
batch boundary.

Preferred order:

1. Try targeted Massive REST recovery for one liquid symbol.
2. If Massive REST is blocked by the single-active-WS/account model, document
   that constraint as provider behavior.
3. Use flat-file ingestion as the durable historical path once access is
   available.

Tasks:

- Run targeted recovery only, never broad recovery by default:

```bash
POST /admin/recovery/backfill?symbols=NQM6
```

- Confirm `provider_fetch_outcomes` records the attempt.
- Confirm `ingestion_runs` records success when bars are returned.
- If REST remains forbidden, add an explicit provider constraint note to
  `docs/backend/provider-integrations.md` and this file.
- Define the first production flat-file activation path:
  - source file location
  - parser responsibility
  - symbol/timeframe constraints
  - idempotency behavior
  - operational-run recording
  - ingestion-run recording
  - validation query

Acceptance:

- At least one non-live ingestion path writes bars through `durable_bar_writer`.
- The resulting rows are visible in `bars_1m` with the correct source label:
  `provider_rest` or `flat_file`.
- The run is visible through `/admin/durable/ingestion-runs`.
- The source outcome is visible through provider or flat-file diagnostics.

## Workstream 3 - Data Quality And Trust Semantics

Purpose: make frontend and operator surfaces honest about data confidence.

Tasks:

- Keep `/bars/range/:symbol` returning:
  - `source`
  - `gapCount`
  - `spikeCount`
  - `invalidOhlcCount`
  - `zeroVolumeCount`
  - `negativeVolumeCount`
  - `oldestBarTs`
  - `newestBarTs`
  - `freshness`
- Keep coverage classes deterministic:
  - `ok`
  - `not_subscribed`
  - `subscribed_no_live_data`
  - `provider_no_data`
  - `stale_contract`
  - `backfill_pending`
- Ensure `provider_no_data` requires real provider-empty evidence.
- Keep failed provider calls classified as provider failures, not no-data.
- Add or update tests whenever a coverage class changes.

Acceptance:

- A frontend can show stale/missing data without inventing reasons.
- An operator can trace an odd chart from frontend range response to durable
  bars, ingestion run, and provider/flat-file evidence.

## Workstream 4 - Frontend Connection Points

Purpose: document the stable backend surfaces the rebuilt frontend should use.

Recommended frontend layers:

### Bootstrap Layer

Use for initial app load and system readiness.

- `GET /health`
- `GET /symbols`
- `GET /admin/health` for protected operator surfaces only
- `GET /admin/ops` for protected operator surfaces only

Frontend guidance:

- Public UI should degrade gracefully when durable storage is degraded but Redis
  is still serving.
- Operator UI should show durable state separately from Redis state.

### Live Market Layer

Use for realtime terminal behavior.

- Browser WebSocket hub for live updates.
- Redis-backed latest/session/snapshot endpoints exposed by the backend.

Frontend guidance:

- Treat WebSocket as live state, not historical truth.
- Reconnect should re-bootstrap from backend snapshots/ranges.

### Chart Range Layer

Use for chart windows and historical context.

- `GET /bars/range/:symbol?tf=1m&start=...&end=...`

Frontend guidance:

- Display `source` and freshness in developer/operator contexts.
- Do not hide gaps or stale data if quality metadata says the range is suspect.
- Do not query Postgres directly from the frontend.

### Coverage And Explainability Layer

Use for missing/stale symbol explanations and admin diagnostics.

- `GET /admin/coverage`
- future public-safe coverage endpoint if non-admin UX needs it

Frontend guidance:

- Use backend-provided `status` and `reason`.
- Do not recreate coverage classification in React state.

### Operator Repair Layer

Use only behind admin protection.

- `POST /admin/recovery/backfill?symbols=<symbol>`
- `POST /admin/hot-cache/rebuild?dryRun=true`
- `POST /admin/hot-cache/rebuild?dryRun=false`
- `GET /admin/durable/provider-outcomes`
- `GET /admin/durable/ingestion-runs`
- `GET /admin/durable/operational-runs`

Frontend guidance:

- Default repair actions to dry-run or targeted execution.
- Never expose broad backfill as a casual one-click action.
- Show run ids, symbols, source, status, and failure reason.

### Future AI Tool Layer

Use service-level functions, not datastore clients.

- `analytics_tool_service.getLatestMarketState`
- `analytics_tool_service.getSymbolCoverage`
- `analytics_tool_service.getRangeBars`
- `analytics_tool_service.getProviderBackfillStatus`
- `analytics_tool_service.runSafeDiagnostics`

Frontend guidance:

- AI/tool surfaces should consume typed backend contracts.
- Tool calls should inherit the same source/freshness/quality semantics as the
  normal UI.

## Workstream 5 - Operational Runbook

Purpose: make the system repairable by an operator under pressure.

Required docs:

- `docs/backend/data-layer.md`
- `docs/backend/operations.md`
- `docs/runbooks/railway-deploy.md`
- `docs/backend/provider-integrations.md`
- this `goal.md`

Runbook must cover:

- how to verify live durable writes
- how to run targeted recovery
- how to diagnose provider REST forbidden/rate-limited responses
- how to dry-run Redis rebuild
- how to execute Redis rebuild
- how to read ingestion runs
- how to read provider outcomes
- how to distinguish Redis degradation from durable-store degradation
- how to roll back durable storage without breaking Redis hot serving

## Workstream 6 - Rollback And Blast Radius

Rollback principle:

Disabling durable storage must not break Redis live serving.

Safe rollback levers:

- unset `DATABASE_URL` on `mk3-backend`, or
- set `DISABLE_DURABLE_STORE=true`, then
- redeploy/restart backend, then
- confirm `/health` keeps Redis and Massive WebSocket connected.

Do not delete Railway Postgres as a rollback. First detach or disable the
application path. Data deletion is a separate, explicit infrastructure action.

Do not delete Railway Redis while the frontend/backend still depend on Redis hot
serving.

## Verification Commands

Local static and smoke checks:

```bash
cd backend
bunx tsc --noEmit --skipLibCheck
bun run test:smoke
```

Full local test pass:

```bash
cd backend
bun run test:unit
bun run test
```

Production health:

```bash
curl https://mk3-backend-production.up.railway.app/health
```

Production admin checks should be run from a Railway-injected environment so
secrets are not copied into shell history:

```bash
railway run --service mk3-backend --environment production -- \
  sh -c 'curl -s -H "X-API-Key: $HUB_API_KEY" https://mk3-backend-production.up.railway.app/admin/health'
```

Production verifier:

```bash
railway run --service mk3-backend --environment production -- \
  sh -c 'cd backend && BACKEND_BASE_URL=https://mk3-backend-production.up.railway.app bun run verify:production-data-layer'
```

## Completion Checklist

- [ ] Production `/health` reports Redis, durable store, and Massive WS connected.
- [ ] `/admin/health` shows durable symbol and bar counts.
- [ ] Latest durable `source=live_ws` rows are recent.
- [ ] Targeted provider REST or flat-file ingestion writes non-live bars.
- [ ] Ingestion run is visible through admin durable endpoints.
- [ ] Provider or flat-file outcome is visible through diagnostics.
- [ ] Hot-cache rebuild dry-run succeeds.
- [ ] Production verifier exits 0.
- [ ] Frontend connection points are documented in this file and linked docs.
- [ ] Rollback path is documented and does not require deleting data services.

## Non-Negotiables

- Keep Redis until the frontend no longer depends on Redis-backed hot serving.
- Do not call Redis durable truth.
- Do not call Railway Postgres full TimescaleDB unless the extension is actually
  enabled.
- Do not claim historical completeness from live WebSocket rows.
- Do not weaken provider/ingestion verifier gates just to get a green check.
- Do not expose raw SQL or Redis access to the frontend.
- Do not make broad backfills the default operator action.
- Keep source, freshness, and quality metadata attached to chart data.
