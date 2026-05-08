# Data Layer Migration Plan

## Current State

Redis is already the beta hot-path store. The migration is not from one database to another. It is from implicit behavior to explicit contracts.

## Phases

### Phase 1. Document And Verify

- complete docs in `docs/backend`
- verify endpoints and keyspace against source
- identify stale/duplicate docs

### Phase 2. Contract Tests

- test Redis key writes/readbacks
- test API response shapes
- test maintenance behavior
- test recovery checkpoint lifecycle

### Phase 3. Observability

- expose freshness and confidence fields
- document operator thresholds
- add runbooks for stale data and provider failures

### Phase 4. Product Semantics

- refine session calendar behavior
- refine front-month confidence behavior
- define missing-history behavior for frontend

## Stop Conditions

Do not start TimescaleDB or warehouse work until Redis hot-path behavior is explicit, tested, and operationally observable.

