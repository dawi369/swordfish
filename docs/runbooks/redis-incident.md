# Redis Incident

## Symptoms

- `/health` reports Redis disconnected.
- `/symbols` is empty unexpectedly.
- chart history is missing.
- sessions or snapshots are stale.
- backend logs show Redis command failures.

## First Checks

```bash
curl http://localhost:3001/health | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/health | jq
curl http://localhost:3001/symbols | jq
curl http://localhost:3001/sessions | jq
curl http://localhost:3001/snapshots | jq
```

## Key Areas

Check:

- latest bars: `bar:latest`
- stream: `market_data`
- time series: `ts:bar:*`
- sessions: `session:*`
- snapshots: `snapshot:*`
- active contracts: `contracts:active:*`
- front months: `cache:front-months`

## Safe Recovery Actions

- restart backend if Redis is reachable but backend connection is stale
- run snapshot refresh if snapshots are missing
- run front-month refresh if cache is stale
- let live WebSocket writes refill hot Redis bars; durable one-minute history
  remains in `bars_1m`

```bash
curl -X POST -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/refresh-snapshots | jq
curl -X POST -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/refresh-front-months | jq
```

Do not run `/admin/clear-redis` unless the goal is to intentionally clear hot data.
