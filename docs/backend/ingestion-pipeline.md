# Ingestion Pipeline

## Current Path

```text
Massive WS aggregate
  -> ws_client normalization
  -> market_data_writer.writeLiveBar
  -> Redis hot store + stream
  -> durable bars_1m upsert when DATABASE_URL is configured
  -> Bun WebSocket broadcaster
  -> frontend hub client
```

## Startup

`backend/src/server/index.ts` coordinates startup:

1. Load environment.
2. Connect Redis.
3. Initialize recovery store/service.
4. Initialize durable Postgres/Timescale-shaped storage when `DATABASE_URL` is configured.
5. Build Massive subscription requests.
6. Connect Massive WebSocket.
7. Bootstrap stale/missing snapshot and front-month caches.
8. Schedule recurring jobs unless disabled.
9. Start HTTP/WebSocket server.

## Write Path

For each normalized live bar, `market_data_writer` writes to Redis and durable
storage independently. A durable write failure is recorded and logged, but Redis
serving can continue.

Redis writes:

- `HSET bar:latest {symbol}`
- `TS.MADD ts:bar:{tf}:{symbol}:{field}`
- `XADD market_data`
- legacy pub/sub publish to `bars` for compatibility
- session hash update at `session:{symbol}:{sessionId}`
- metadata updates such as bar count

Durable writes:

- `UPSERT bars_1m` with `source=live_ws`
- quality flags for invalid OHLC, volume, gaps, and spikes
- telemetry for full or partial write success

There is no active provider REST backfill path for futures history. Future
flat-file ingestion will go through `durable_bar_writer`, so parsed historical
bars land in the same `bars_1m` model with `source=flat_file`.

## Read Path

- `/symbols` reads latest symbols.
- `/bars/range/:symbol` reads RedisTimeSeries first and falls back to durable
  `bars_1m` for `tf=1m` ranges when Redis has no bars.
- `/bars/session/:symbol` selects session window and reads RedisTimeSeries.
- `/sessions` and `/session/:symbol` read retained session hashes.
- WebSocket clients receive latest snapshot on connect and stream events after that.

## Failure Modes

- Redis unavailable: health degrades and reads/writes fail.
- Massive WS disconnected: health degrades; last Redis state may still be readable.
- Durable Postgres unavailable: durable health degrades; Redis hot serving can
  continue and write failures are logged.
- Provider sends incomplete data: front-month and snapshot quality degrade.
- RedisTimeSeries module missing: bar range writes/reads fail.
- Local recovery DB unavailable: reconnect checkpoint/cache behavior degrades.

## Verification

```bash
curl http://localhost:3001/health | jq
curl http://localhost:3001/symbols | jq
curl "http://localhost:3001/bars/range/ESM6?tf=1m&start=1710000000000&end=1710086400000" | jq
```
