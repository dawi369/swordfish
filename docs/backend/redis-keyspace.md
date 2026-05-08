# Redis Keyspace

This document describes current Redis behavior verified against `backend/src/server/data/redis_store.ts` and job code.

## Market Data

| Key | Type | Writer | Purpose |
|---|---|---|---|
| `bar:latest` | hash | `redis_store.writeBar` | latest normalized bar by symbol |
| `ts:bar:{tf}:{symbol}:{field}` | RedisTimeSeries | `redis_store.writeBar` | rolling OHLCV/trades series by timeframe |
| `market_data` | stream | `redis_store.writeBar` | realtime event stream for broadcaster |
| `bars` | pub/sub channel | `redis_store.writeBar` | legacy compatibility channel |

## Sessions And Snapshots

| Key | Type | Writer | Purpose |
|---|---|---|---|
| `session:{symbol}:{sessionId}` | hash | `redis_store.writeBar` | session metrics for one symbol/session window |
| `snapshot:{symbol}` | hash | `snapshot_job`, `redis_store.writeSnapshot` | provider snapshot cache |
| `meta:index:snapshots` | set | `redis_store.writeSnapshot` | index of symbols with snapshots |

## Contracts And Front Months

| Key | Type | Writer | Purpose |
|---|---|---|---|
| `contracts:active:{productCode}` | string JSON | contract/provider paths | active contracts for one product root |
| `meta:index:active_contracts` | set | contract/provider paths | index of product roots with cached active contracts |
| `cache:front-months` | string JSON | `front_month_job` | resolved front-month cache |

## Runtime Metadata

| Key | Type | Writer | Purpose |
|---|---|---|---|
| `meta:trading_date` | string | maintenance | last maintenance trading date |
| `meta:bar_count` | string | bar writes/maintenance | processed bar count |
| `meta:subscribed_symbols` | string JSON | startup/subscription refresh | current subscribed symbols |
| `meta:index:recovery_checkpoints` | set | recovery paths | index of recovery checkpoint symbols |
| `recovery:checkpoint:{symbol}` | string JSON | recovery paths | recovery checkpoint for one symbol |

## Job Status

| Key | Type | Writer | Purpose |
|---|---|---|---|
| `job:clear:status` | string JSON | `clear_daily.ts` | daily maintenance status |
| `job:refresh:status` | string JSON | `refresh_subscriptions.ts` | subscription refresh status |
| `job:front-months:status` | string JSON | `front_month_job.ts` | front-month job status |
| `job:snapshot:status` | string JSON | `snapshot_job.ts` | snapshot job status |

## RedisTimeSeries Shape

Key format:

```text
ts:bar:{tf}:{symbol}:{field}
```

Supported fields:

- `open`
- `high`
- `low`
- `close`
- `volume`
- `trades`

Supported timeframes:

- `1s`
- `15s`
- `30s`
- `1m`
- `5m`
- `15m`
- `30m`
- `1h`
- `2h`
- `4h`
- `1d`

Downsampling rules are created from:

- `1s` to `15s`, `30s`, `1m`
- `1m` to `5m`, `15m`, `30m`, `1h`
- `1h` to `2h`, `4h`, `1d`

Aggregations:

- open: first
- high: max
- low: min
- close: last
- volume: sum
- trades: sum

## Retention And Maintenance

Current docs and code treat Redis as a rolling hot store. Manual clear and daily maintenance should not be assumed to provide archival durability.

Manual forced clear removes hot intraday keys such as:

- `bar:latest`
- `market_data`
- `session:*`
- `snapshot:*`

It intentionally preserves longer-lived metadata such as active contracts and front-month cache unless code is changed to do otherwise.

## Operator Checks

```bash
curl http://localhost:3001/symbols | jq
curl http://localhost:3001/sessions | jq
curl http://localhost:3001/snapshots | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/contracts/active | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/front-months | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/recovery/checkpoints | jq
```

