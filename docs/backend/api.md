# Backend API

The backend serves HTTP and WebSocket traffic from `backend/src/server/api/rest_client.ts`.

## Public Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Service health for Redis, Massive WS, and durable Postgres/Timescale when enabled |
| `/bars/range/:symbol` | GET | RedisTimeSeries range for a symbol, with durable `1m` fallback |
| `/bars/today/:symbol` | GET | Compatibility alias for current trading-session bars |
| `/bars/session/:symbol` | GET | Bars for the trading session containing `ts` or now |
| `/bars/open-ticker` | GET/POST/DELETE | Global open ticker used to retain temporary 1-second Redis bars |
| `/symbols` | GET | Symbols present in latest-bar storage |
| `/sessions` | GET | All retained session metrics |
| `/sessions/week/:symbol` | GET | Session history for a symbol in a time range |
| `/session/:symbol` | GET | Session metrics for one symbol and timestamp |
| `/snapshots` | GET | All snapshot cache entries |
| `/snapshot/:symbol` | GET | Snapshot cache entry for one symbol |

## Query Parameters

### `/bars/range/:symbol`

| Param | Required | Default | Description |
|---|---:|---|---|
| `start` | yes | none | start timestamp in milliseconds |
| `end` | yes | none | end timestamp in milliseconds |
| `tf` | no | `1m` | timeframe |

`/bars/range/:symbol` reads Redis first. For `tf=1m`, an empty Redis result can
fall back to durable `bars_1m` when Postgres/Timescale is enabled. Responses
include `source: "redis" | "timescale" | "empty"` plus `quality` metadata:

- `gapCount`
- `spikeCount`
- `invalidOhlcCount`
- `zeroVolumeCount`
- `negativeVolumeCount`
- `oldestBarTs`
- `newestBarTs`
- `freshness`

Gap and spike thresholds default to `DATA_QUALITY_GAP_THRESHOLD_MS=90000` and
`DATA_QUALITY_SPIKE_THRESHOLD_PCT=0.25`.

### `/bars/session/:symbol`

| Param | Required | Default | Description |
|---|---:|---|---|
| `tf` | no | `1s` | timeframe |
| `ts` | no | `Date.now()` | timestamp used to select trading session |

### `/sessions/week/:symbol`

| Param | Required | Default | Description |
|---|---:|---|---|
| `start` | no | one week before `end` | start timestamp in milliseconds |
| `end` | no | `Date.now()` | end timestamp in milliseconds |

## Supported Timeframes

`1s`, `15s`, `30s`, `1m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `1d`

### `/bars/open-ticker`

The open ticker is a global hot-cache hint for the current single-user product
runtime. Redis writes temporary `1s` bars only for this symbol. All symbols
still receive one-week `1m` Redis bars and durable `bars_1m` writes.

- `GET /bars/open-ticker` returns the current symbol or `null`.
- `POST /bars/open-ticker` accepts `{ "symbol": "ESH6" }` or `?symbol=ESH6`.
- `DELETE /bars/open-ticker` clears the hint.
- mutation calls require an allowed browser `Origin`.

## Admin Auth

Admin routes require one of:

- `X-API-Key: $HUB_API_KEY`
- `Authorization: Bearer $HUB_API_KEY`

Browser-origin admin calls are checked against `HUB_ADMIN_ALLOWED_ORIGINS`.
They do not need to be listed in the public `HUB_ALLOWED_ORIGINS` set. Server
or CLI calls without an `Origin` header still require the admin API key.

## Admin Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/admin/health` | GET | detailed operator health, durable stats, coverage classification, and job state |
| `/admin/ops` | GET | consolidated operator dashboard state for services, Redis freshness, durable stats, coverage, jobs, and subscriptions |
| `/admin/coverage` | GET | classified subscribed/latest/durable symbol coverage |
| `/admin/durable/symbols` | GET | recent durable symbols with bar counts, first/last timestamps, and quality counts |
| `/admin/durable/bars/latest` | GET | latest durable `bars_1m` row per symbol, optionally filtered by source, including quality flags |
| `/admin/durable/provider-outcomes` | GET | legacy/provider diagnostic outcomes filtered by symbol/status |
| `/admin/durable/operational-runs` | GET | durable job/recovery/provider/admin run records filtered by type/status |
| `/admin/durable/ingestion-runs` | GET | durable ingestion records filtered by source/status |
| `/admin/durable/quality/:symbol` | GET | durable quality summary for one symbol and time range |
| `/admin/commands` | GET | list allowlisted read-only operator diagnostics |
| `/admin/commands/:id/run` | POST | run one allowlisted operator diagnostic or repair command and persist a small run record |
| `/admin/subscriptions` | GET | current upstream Massive subscriptions |
| `/admin/recovery/checkpoints` | GET | recovery checkpoint state |
| `/admin/recovery/backfill` | POST | authenticated disabled endpoint; returns `410` until flat-file history exists; records an `admin_action` run |
| `/admin/hot-cache/rebuild` | POST | rebuild latest-week Redis cache from durable `bars_1m`; defaults to `dryRun=true`; records an `admin_action` run |
| `/admin/front-months` | GET | current front-month cache |
| `/admin/contracts/active` | GET | all cached active contracts |
| `/admin/contracts/active/:productCode` | GET | cached active contracts for one product root |
| `/admin/bars/latest` | GET | latest bars for all symbols |
| `/admin/bars/latest/:symbol` | GET | latest bar for one symbol |
| `/admin/bars/week/:symbol` | GET | last week of bars from RedisTimeSeries |
| `/admin/clear-redis` | POST | force hot-store maintenance clear; records an `admin_action` run |
| `/admin/refresh-subscriptions` | POST | rebuild upstream subscriptions; records an `admin_action` run |
| `/admin/refresh-front-months` | POST | start front-month refresh in background; records an `admin_action` run |
| `/admin/refresh-snapshots` | POST | start snapshot refresh in background; records an `admin_action` run |

## WebSocket

The same Bun server accepts WebSocket upgrades and publishes live `market_data` messages.

On connect, the server sends a snapshot of latest bars. Runtime stream messages are then broadcast from Redis stream events.

## Read-Only Admin Diagnostics

Current allowlisted diagnostics include service health, Redis summary, jobs
status, subscriptions, coverage, front-month summary, recovery checkpoints,
`hot-cache-rebuild-dry-run`, and `hot-cache-rebuild`.

`hot-cache-rebuild-dry-run` checks how many persisted subscribed symbols could
rebuild the latest-week Redis hot cache from TimescaleDB `bars_1m` without
writing Redis.

Coverage classifies symbols as:

- `ok` when subscribed/latest/durable evidence is healthy enough for the
  current operator view.
- `not_subscribed` when a symbol exists in durable/provider evidence but is not
  currently in the Massive subscription set.
- `subscribed_no_live_data` when the symbol is subscribed but Redis has no
  latest live bar while durable history exists.
- `provider_no_data` only when legacy/provider diagnostics explicitly show an
  empty response. It is not created by the disabled REST backfill endpoint.
- `stale_contract` when the latest Redis bar is old and the symbol is no longer
  subscribed or no longer in the current active-contract cache.
- `backfill_pending` means historical evidence is missing. It does not mean
  provider REST backfill will repair the symbol.

## Durable Inspection Query Parameters

| Endpoint | Params |
|---|---|
| `/admin/durable/symbols` | `limit` optional, capped at 500 |
| `/admin/durable/bars/latest` | `symbols` optional comma-separated list, `source=live_ws\|provider_rest\|flat_file\|recovery` optional for legacy rows, `limit` optional capped at 500 |
| `/admin/durable/provider-outcomes` | `symbol` optional, `status=success\|empty\|failed` optional, `limit` optional capped at 500 |
| `/admin/durable/operational-runs` | `runType` optional, `status` optional, `limit` optional capped at 500 |
| `/admin/durable/ingestion-runs` | `source=provider_rest\|flat_file\|recovery` optional for legacy/future rows, `status=started\|success\|failed` optional, `limit` optional capped at 500 |
| `/admin/durable/quality/:symbol` | `start` and `end` required in milliseconds; `gapThresholdMs` and `spikeThresholdPct` optional |

These endpoints intentionally expose typed backend views over durable storage.
They are the safe inspection boundary for future AI tools; callers should not
query Redis or Postgres directly.

`/admin/durable/quality/:symbol` also records the computed summary in
`data_quality_summaries` when durable storage is connected, so operator/tool
quality checks leave an audit trail.

## Examples

```bash
curl http://localhost:3001/health | jq
curl "http://localhost:3001/bars/session/ESM6?tf=1m" | jq
curl "http://localhost:3001/bars/range/ESH6?tf=1m&start=1710000000000&end=1710086400000" | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/health | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/coverage | jq
curl -H "X-API-Key: $HUB_API_KEY" "http://localhost:3001/admin/durable/symbols?limit=25" | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/contracts/active/ES | jq
curl -X POST -H "X-API-Key: $HUB_API_KEY" "http://localhost:3001/admin/hot-cache/rebuild?dryRun=true" | jq
```
