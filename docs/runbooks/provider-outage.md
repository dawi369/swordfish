# Provider Outage

## Symptoms

- `/health` reports `massiveWs` disconnected.
- subscriptions are present but live bars stop.
- snapshots/front-months stop refreshing.
- provider REST calls fail or return sparse data.

## Checks

```bash
curl http://localhost:3001/health | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/subscriptions | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/contracts/active | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/front-months | jq
```

## Expected Degraded Behavior

- Existing Redis data may still serve.
- Latest bars may become stale.
- Front-month confidence may degrade if snapshots are unavailable.
- Manual refreshes may fail until provider recovers.

## Recovery

After provider recovers:

```bash
curl -X POST -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/refresh-subscriptions | jq
curl -X POST -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/refresh-snapshots | jq
curl -X POST -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/refresh-front-months | jq
curl -X POST -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/recovery/backfill | jq
```

