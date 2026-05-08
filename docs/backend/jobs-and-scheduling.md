# Jobs And Scheduling

The backend job runtime lives in `backend/src/server/job_runtime.ts` and `backend/src/jobs`.

## Jobs

| Job | File | Default schedule | Purpose |
|---|---|---|---|
| Daily clear | `clear_daily.ts` | 2:00 AM ET daily | hot-store maintenance and manual forced clear |
| Snapshot refresh | `snapshot_job.ts` | 2:05 AM ET daily | refresh per-symbol snapshots |
| Front-month refresh | `front_month_job.ts` | 3:00 AM ET daily | resolve front-month cache |
| Subscription refresh | `refresh_subscriptions.ts` | 12:05 AM ET on 1st of month | rebuild Massive subscriptions |

## Startup Bootstraps

`job_runtime.ts` can bootstrap snapshots and front months on startup when data is missing or stale for the current ET day.

Controls:

```bash
HUB_ENABLE_SCHEDULED_JOBS=true
HUB_BOOTSTRAP_FRONT_MONTHS_ON_STARTUP=true
HUB_BOOTSTRAP_SNAPSHOTS_ON_STARTUP=true
```

## Job Status Keys

- `job:clear:status`
- `job:refresh:status`
- `job:front-months:status`
- `job:snapshot:status`

## Manual Triggers

```bash
curl -X POST -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/clear-redis | jq
curl -X POST -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/refresh-subscriptions | jq
curl -X POST -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/refresh-front-months | jq
curl -X POST -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/refresh-snapshots | jq
```

## Operator Checks

```bash
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/health | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/front-months | jq
curl -H "X-API-Key: $HUB_API_KEY" http://localhost:3001/admin/contracts/active | jq
```

