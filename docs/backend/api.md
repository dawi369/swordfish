# Backend API

The backend serves HTTP and WebSocket traffic from `backend/src/server/api/rest_client.ts`.

## Public Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Service health for Redis, Massive WS, and optional TimescaleDB |
| `/bars/range/:symbol` | GET | RedisTimeSeries range for a symbol |
| `/bars/today/:symbol` | GET | Compatibility alias for current trading-session bars |
| `/bars/session/:symbol` | GET | Bars for the trading session containing `ts` or now |
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

## Admin Auth

Admin routes require one of:

- `X-API-Key: $HUB_API_KEY`
- `Authorization: Bearer $HUB_API_KEY`

## Admin Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/admin/health` | GET | detailed operator health and job state |
| `/admin/ops` | GET | consolidated operator dashboard state for services, Redis freshness, jobs, and subscriptions |
| `/admin/subscriptions` | GET | current upstream Massive subscriptions |
| `/admin/recovery/checkpoints` | GET | recovery checkpoint state |
| `/admin/recovery/backfill` | POST | manual provider backfill for subscribed symbols |
| `/admin/front-months` | GET | current front-month cache |
| `/admin/contracts/active` | GET | all cached active contracts |
| `/admin/contracts/active/:productCode` | GET | cached active contracts for one product root |
| `/admin/bars/latest` | GET | latest bars for all symbols |
| `/admin/bars/latest/:symbol` | GET | latest bar for one symbol |
| `/admin/bars/week/:symbol` | GET | last week of bars from RedisTimeSeries |
| `/admin/clear-redis` | POST | force hot-store maintenance clear |
| `/admin/refresh-subscriptions` | POST | rebuild upstream subscriptions |
| `/admin/refresh-front-months` | POST | start front-month refresh in background |
| `/admin/refresh-snapshots` | POST | start snapshot refresh in background |

## WebSocket

The same Bun server accepts WebSocket upgrades and publishes live `market_data` messages.

On connect, the server sends a snapshot of latest bars. Runtime stream messages are then broadcast from Redis stream events.

## Examples

```bash
curl http://localhost:3001/health | jq
curl "http://localhost:3001/bars/session/ESM6?tf=1m" | jq
curl "http://localhost:3001/bars/range/ESH6?tf=1m&start=1710000000000&end=1710086400000" | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/health | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/contracts/active/ES | jq
curl -X POST -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/recovery/backfill | jq
```
