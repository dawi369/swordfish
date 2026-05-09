# Health And Observability

## Status

Draft

## Goal

Make backend health and operator visibility precise enough to debug production without guessing.

## Current Signals

- `/health`
- `/admin/health`
- `/admin/subscriptions`
- `/admin/contracts/active`
- `/admin/front-months`
- `/admin/recovery/checkpoints`
- `/admin/ops`
- `/admin/commands`
- `/admin/commands/:id/run`
- Railway build/deploy logs

## Target Signals

- Redis connectivity
- Massive WebSocket connectivity
- subscribed symbol count
- latest bar age by symbol/product
- snapshot cache age
- active-contract cache age
- front-month cache age and confidence
- recovery checkpoint age
- job last-run status and error
- job schedule metadata and next run
- hidden frontend operator console backed by server-side admin proxy routes
- allowlisted read-only diagnostics console with structured output

## Work Needed

- add explicit freshness fields where missing
- make stale cache different from empty cache
- expose provider failure reasons safely
- document operator thresholds
- add runbook steps for stale data and provider outage
