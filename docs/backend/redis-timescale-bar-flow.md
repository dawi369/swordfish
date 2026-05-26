# Redis, Timescale, And Bar Flow

This document is the backend data-shape contract for the current production
runtime.

## Summary

Swordfish has one live market-data writer. Massive WebSocket bars enter the
backend once, then fan out to Redis for hot UX and to Postgres/Timescale-shaped
storage for durable 1-minute analytics.

There is no active futures history backfill path right now. Redis and
Postgres/Timescale are populated live. Historical fill waits for Massive
futures flat-file access.

## Bar Flow

```text
Massive live WebSocket aggregate
  -> MassiveWSClient
  -> normalized Bar
  -> MarketDataWriter.writeLiveBar
       -> redis_store.writeBar
            -> bar:latest
            -> ts:bar:{tf}:{symbol}:{field}
            -> market_data stream
            -> session:{symbol}:{sessionId}
       -> recovery_service.persistLiveBar
            -> local SQLite reconnect cache
            -> recovery checkpoint metadata
       -> durable_bar_writer.writeDurableBars(..., "live_ws")
            -> timescale_store.upsertBars1m
            -> bars_1m source=live_ws
  -> backend REST/WebSocket readers
```

Reconnect handling buffers live bars while the socket is reconnecting, then
flushes those buffered live bars after the connection is restored. It does not
call provider REST backfill.

## Redis Structure

Redis is the hot serving layer. It can be wiped weekly because durable
1-minute history is written to `bars_1m`.

| Key | Type | Retention | Purpose |
|---|---|---:|---|
| `bar:latest` | hash | hot runtime | latest normalized bar by symbol |
| `ts:bar:1s:{symbol}:{field}` | RedisTimeSeries | temporary live window | open-ticker second updates |
| `ts:bar:1m:{symbol}:{field}` | RedisTimeSeries | 7 days | fast chart and lightweight analytics cache |
| `ts:bar:{tf}:{symbol}:{field}` | RedisTimeSeries | 7 days for aggregate frames today | rolled-up chart cache |
| `market_data` | stream | capped by length | backend WebSocket broadcaster source |
| `meta:open_ticker` | string | hot runtime | current symbol allowed to retain 1-second bars |
| `session:{symbol}:{sessionId}` | hash | hot runtime | current session metrics |
| `snapshot:{symbol}` | hash | hot runtime | latest provider snapshot cache |
| `contracts:active:{productCode}` | string JSON | weekly-wipe tolerant | active contracts by product root |
| `cache:front-months` | string JSON | weekly-wipe tolerant | resolved front-month map |
| `meta:subscribed_symbols` | string JSON | runtime metadata | current live subscription set |
| `recovery:checkpoint:{timeframe}:{symbol}` | string JSON | runtime metadata | reconnect cache checkpoint |

Target Redis retention:

- 1-second bars exist only for the current open ticker and a 60-second live
  window.
- data one minute or more in the past is represented by 1-minute bars only.
- 1-minute bars retain one rolling week.
- Redis latest/session/snapshot/contract state is operational cache, not
  backtesting history.

The backend writes 1-minute Redis bars directly for every live symbol, so
symbols do not need 1-second Redis storage to maintain the one-week hot chart
cache.

## Durable Structure

`bars_1m` is the canonical durable bar table.

| Column | Meaning |
|---|---|
| `symbol` | provider contract symbol |
| `ts` | 1-minute bar start timestamp |
| `open` | minute open |
| `high` | minute high |
| `low` | minute low |
| `close` | minute close |
| `volume` | minute volume |
| `trades` | minute trade count |
| `dollar_volume` | optional dollar-volume estimate |
| `source` | ingestion source, currently `live_ws` in production |
| `quality_flags` | per-bar quality flags |
| `ingested_at` | durable write timestamp |

The active runtime should not create or write the old/general `bars` table.
Fresh production data starts in `bars_1m`; existing production bar data can be
discarded during this reset.

## Reads

- latest/live UX reads Redis.
- `/bars/range/:symbol?tf=1m` reads Redis first, then falls back to `bars_1m`
  when Redis has no 1-minute bars for the requested range.
- analytics and future AI/tool reads should go through backend services that
  attach source, freshness, and quality metadata.
- frontend clients should not choose between Redis and Postgres directly.

## Future Historical Fill

Historical fill will use Massive futures flat files when access exists.

Future flat-file bars should:

- parse into normalized 1-minute `Bar` records
- write through `DurableBarWriter`
- upsert into `bars_1m`
- record durable ingestion/quality metadata
- never bypass the live/durable service boundary with ad hoc SQL
