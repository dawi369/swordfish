# Jobs And Scheduling

The backend job runtime lives in `backend/src/server/job_runtime.ts` and `backend/src/jobs`.
Production recurring schedules are owned by Trigger.dev tasks in
`backend/src/trigger/scheduled_jobs.ts`.

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

When Trigger.dev owns production schedules, set:

```bash
HUB_ENABLE_SCHEDULED_JOBS=false
TRIGGER_PROJECT_REF=proj_...
TRIGGER_SECRET_KEY=tr_prod_...
BACKEND_BASE_URL=https://mk3-backend-production.up.railway.app
```

Keep startup bootstraps enabled unless the backend startup path becomes too slow.
They hydrate runtime state and are separate from recurring cron ownership.

## Trigger.dev

Trigger.dev tasks call the production backend admin endpoints. This keeps
Trigger.dev as the schedule owner while Railway remains the owner of runtime
state, Redis clients, provider clients, and the single live Massive WebSocket.

- `daily-clear` calls `/admin/clear-redis?force=false`
- `snapshot-refresh` calls `/admin/refresh-snapshots`
- `front-month-refresh` calls `/admin/refresh-front-months`
- `subscription-refresh` calls `/admin/refresh-subscriptions`

Trigger.dev production env only needs `BACKEND_BASE_URL` and `HUB_API_KEY` for
these tasks. `trigger.config.ts` syncs those two variables during authenticated
deploys through Trigger.dev's `syncEnvVars` build extension. Backend-only
runtime env such as Redis, Postgres, and Massive provider secrets stay on the
Railway backend service.

Commands:

```bash
cd backend
bun run trigger:dev
bun run trigger:deploy
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
