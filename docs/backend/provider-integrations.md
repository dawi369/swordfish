# Provider Integrations

## Massive

Massive is the upstream futures data provider.

Backend integration points:

- `backend/src/server/api/massive/ws_client.ts`
  Live WebSocket connection and bar ingestion.
- `backend/src/server/api/rest_client.ts`
  Backend REST/WebSocket surface for frontend/operator clients.
- `backend/src/utils/contract_provider.ts`
  Active futures contract discovery.
- `backend/src/utils/massive_snapshots.ts`
  Snapshot fetch and conversion.
- `backend/src/utils/cbs/schedule_cb.ts`
  Subscription request construction.

## Contract Discovery

The backend prefers active-contract discovery over static calendar inference.

Flow:

1. Build configured futures universe from local metadata.
2. Fetch active contracts for each product root.
3. Cache usable results in Redis under `contracts:active:{productCode}`.
4. Use static month-code schedule only as fallback.

## Front-Month Resolution

Front-month candidates are ranked by:

1. session volume
2. open interest
3. nearest valid expiry

The result is cached in `cache:front-months`.

## Provider Risks

- Active-contract endpoint coverage may be incomplete.
- Snapshot coverage may be sparse or delayed.
- Open interest may be null.
- Calendar fallback can be wrong around rolls.
- Rate limits and upstream outages directly affect cache freshness.

These risks should be treated as product-visible data-quality concerns, not just infrastructure issues.

