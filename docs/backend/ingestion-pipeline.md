# Ingestion Pipeline

## Current Path

```text
Massive WS aggregate
  -> ws_client normalization
  -> redis_store.writeBar
  -> Redis hot store
  -> Redis stream
  -> Bun WebSocket broadcaster
  -> frontend hub client
```

## Startup

`backend/src/server/index.ts` coordinates startup:

1. Load environment.
2. Connect Redis.
3. Initialize recovery store/service.
4. Initialize optional TimescaleDB when enabled.
5. Build Massive subscription requests.
6. Connect Massive WebSocket.
7. Bootstrap stale/missing snapshot and front-month caches.
8. Schedule recurring jobs unless disabled.
9. Start HTTP/WebSocket server.

## Write Path

For each normalized bar, Redis writes:

- `HSET bar:latest {symbol}`
- `TS.MADD ts:bar:{tf}:{symbol}:{field}`
- `XADD market_data`
- legacy publish to `bars`
- session hash update at `session:{symbol}:{sessionId}`
- metadata updates such as bar count

## Read Path

- `/symbols` reads latest symbols.
- `/bars/range/:symbol` reads RedisTimeSeries.
- `/bars/session/:symbol` selects session window and reads RedisTimeSeries.
- `/sessions` and `/session/:symbol` read retained session hashes.
- WebSocket clients receive latest snapshot on connect and stream events after that.

## Failure Modes

- Redis unavailable: health degrades and reads/writes fail.
- Massive WS disconnected: health degrades; last Redis state may still be readable.
- Provider sends incomplete data: front-month and snapshot quality degrade.
- RedisTimeSeries module missing: bar range writes/reads fail.
- Local recovery DB unavailable: reconnect gap behavior degrades.

## Verification

```bash
curl http://localhost:3001/health | jq
curl http://localhost:3001/symbols | jq
curl "http://localhost:3001/bars/range/ESM6?tf=1m&start=1710000000000&end=1710086400000" | jq
```

