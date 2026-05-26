# ADR-0002: Redis As Hot Serving Layer

## Status

Accepted for beta hot-path serving; superseded for durability by the data-layer
migration plan.

## Context

The current beta runtime is frontend, backend, and Redis. TimescaleDB code exists but is not required for serving the product. The terminal needs low-latency latest bars, rolling chart history, session state, snapshots, active contracts, and front-month cache.

## Decision

Redis is the hot-path source of truth for the beta backend. For the current
production direction, that means hot serving truth only; durable analytics truth
belongs in Postgres/Timescale-shaped storage.

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

Durable Postgres/Timescale storage is now active when `DATABASE_URL` is present.
It is the migration path for normalized bars, ingestion audit records, provider
outcomes, and future flat-file backfills.

## Consequences

- Backend and frontend contracts should be designed around Redis-backed APIs.
- Long-window historical analytics are explicitly out of scope for the current beta path.
- Redis keyspace, retention, and maintenance behavior must be documented and tested.
- Data durability expectations must be honest: Redis is hot operational state, not the archival warehouse.

## 2026-05 Update

Redis remains the right low-latency hot serving layer, but it should no longer be
treated as the durable operational truth for production.

The revised target is:

- Redis owns latest-week serving state, live stream fanout, latest bars, and
  rebuildable projections.
- TimescaleDB/Postgres owns durable normalized bars from the migration point
  forward, job runs, recovery runs, provider fetch outcomes, front-month
  decisions, and admin audit events.
- Massive REST is used for bounded recovery/backfill until futures flat-file
  access is available.
- Future flat-file ingestion should backfill TimescaleDB without changing the
  runtime data model.

This update is driven by production-readiness concerns: stale Redis state, weak
job-status semantics, unclear source-of-truth boundaries, and the need to explain
operator incidents after the fact.

## Revisit When

- Product needs long-window analytics.
- Provider historical access becomes reliable enough to backfill long ranges.
- Redis memory/retention constraints become a product limitation.
- A durable historical store becomes mandatory for compliance or user-facing features.
