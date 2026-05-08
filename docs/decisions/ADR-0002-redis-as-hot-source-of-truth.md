# ADR-0002: Redis As Hot Source Of Truth

## Status

Accepted

## Context

The current beta runtime is frontend, backend, and Redis. TimescaleDB code exists but is not required for serving the product. The terminal needs low-latency latest bars, rolling chart history, session state, snapshots, active contracts, and front-month cache.

## Decision

Redis is the hot-path source of truth for the beta backend.

Redis owns:

- latest bars
- rolling RedisTimeSeries history
- session state
- snapshots
- active contracts
- front-month cache
- subscribed-symbol metadata
- job status
- recovery checkpoints

TimescaleDB remains deferred and optional.

## Consequences

- Backend and frontend contracts should be designed around Redis-backed APIs.
- Long-window historical analytics are explicitly out of scope for the current beta path.
- Redis keyspace, retention, and maintenance behavior must be documented and tested.
- Data durability expectations must be honest: Redis is hot operational state, not the archival warehouse.

## Revisit When

- Product needs long-window analytics.
- Provider historical access becomes reliable enough to backfill long ranges.
- Redis memory/retention constraints become a product limitation.
- A durable historical store becomes mandatory for compliance or user-facing features.

