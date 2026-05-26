# Railway Deploy

## Services

- `swordfish-frontend`
  - root directory: `/frontend`
  - config path: `/frontend/railway.toml`
- `swordfish-backend`
  - root directory: `/backend`
  - config path: `/backend/railway.toml`
- Redis service
- Postgres service for durable analytics storage

The backend and frontend each use service-local `railway.toml` files. There is
no root-level Railway config file for the monorepo.

## Check Linked Context

```bash
railway status
railway whoami
railway service list --environment production --json
```

If these return `Unauthorized`, stop and run `railway login` interactively
before making production changes. Do not create services, set variables, or
deploy from an unauthenticated shell.

In non-interactive shells, use Railway's token-based auth instead of trying to
complete browser login from the shell:

```bash
export RAILWAY_TOKEN=...
railway whoami
railway status
```

Do not write Railway tokens into repo files, `.env` examples, docs, shell
history snippets, or shared logs.

## List Deployments

```bash
railway deployment list --service swordfish-frontend --environment production --limit 20
railway deployment list --service swordfish-backend --environment production --limit 20
```

## Build Logs

```bash
railway logs --build --latest --lines 300 --service swordfish-frontend --environment production
railway logs --build --latest --lines 300 --service swordfish-backend --environment production
```

For a specific deployment:

```bash
railway logs --build --lines 500 <deployment-id>
```

## Deploy Logs

```bash
railway logs --deployment --latest --lines 300 --service swordfish-backend --environment production
```

## Healthchecks

- Frontend: `/health`
- Backend: `/health`

## Durable Data-Layer Activation

Use this when turning on the Postgres-backed data layer in production.

Preconditions:

- `swordfish-backend` and Redis are already healthy.
- Railway CLI is authenticated and scoped to the intended project/environment.
- The code has passed:

```bash
cd backend
bunx tsc --noEmit --skipLibCheck
bun run test:smoke
```

Activation:

```bash
railway add --database postgres --json

# Inspect service variable names. Do not use --json or --kv in shared logs;
# those output modes include raw secret values.
railway variable list --service swordfish-backend --environment production

# Durable storage must not be explicitly disabled during activation. If either
# key appears in the variable list above with a disabling value, remove it.
# railway variable delete ENABLE_TIMESCALE --service swordfish-backend --environment production
# railway variable delete DISABLE_DURABLE_STORE --service swordfish-backend --environment production

# Prefer Railway's dashboard/attach flow for DATABASE_URL. If setting manually,
# avoid echoing the secret in shared logs; this form reads it from stdin.
printf '%s' "$DATABASE_URL" | railway variable set DATABASE_URL \
  --stdin \
  --service swordfish-backend \
  --environment production \
  --skip-deploys

railway service restart --service swordfish-backend --environment production --yes --json
```

Then verify:

```bash
cd backend
BACKEND_BASE_URL=https://mk3-backend-production.up.railway.app \
HUB_API_KEY=... \
bun run verify:production-data-layer
```

The verifier expects `/health` to show Redis, the durable store, and the
Massive websocket connected. A production data-layer activation is not accepted
if Postgres works but hot serving or live ingestion is down.

By default, the verifier requires the latest durable `source=live_ws` bar to be
no older than 20 minutes. If activation is being verified during a known market
pause, either wait for the next live bar or set a deliberate one-off threshold:

```bash
PRODUCTION_DATA_LAYER_MAX_LIVE_BAR_AGE_MS=7200000 \
BACKEND_BASE_URL=https://mk3-backend-production.up.railway.app \
HUB_API_KEY=... \
bun run verify:production-data-layer
```

The verifier expects `POST /admin/recovery/backfill` to return `410 disabled`.
Do not run provider REST backfill for futures history. Historical fill waits
for Massive futures flat-file access.

If `live durable bars_1m rows` fails, confirm the websocket has run long enough
to write at least one `source=live_ws` row:

```bash
curl -H "X-API-Key: $HUB_API_KEY" \
  "https://mk3-backend-production.up.railway.app/admin/durable/bars/latest?limit=25&source=live_ws" | jq
```

After durable `bars_1m` rows and disabled-backfill behavior are verified, an
operator can dry-run hot-cache hydration:

```bash
curl -X POST \
  -H "X-API-Key: $HUB_API_KEY" \
  "https://mk3-backend-production.up.railway.app/admin/hot-cache/rebuild?dryRun=true" | jq
```

Only enable startup rebuild after the verifier passes:

```bash
HUB_REBUILD_HOT_CACHE_ON_STARTUP=true
```

Rollback/degraded mode:

- Unset `DATABASE_URL` or set `DISABLE_DURABLE_STORE=true` on `swordfish-backend`.
- Keep Redis serving; public range reads will return Redis or empty source
  labels rather than treating Postgres as archival truth.
- Re-run `/health` and `/admin/health` and confirm Redis/Massive WS remain
  connected.

## Common Failure Split

- Build failure: TypeScript, dependency install, Dockerfile, lockfile, Next build.
- Deploy failure: app starts but healthcheck never passes.
- Runtime failure: deploy succeeds, then logs/HTTP show degraded behavior.

## Current Backend Deploy Caveat

The current production backend service is still named `mk3-backend`, and its
Railway root directory is `/backend`. Deploy backend changes from the repo root:

```bash
railway up --service mk3-backend --environment production --detach
```

Do not combine `./backend --path-as-root` with this service config. That makes
the uploaded snapshot root differ from the configured `/backend` root and can
fail before the build starts.
