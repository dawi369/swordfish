# Remote Dev And CI/CD

Swordfish uses a remote-first workflow. Local development is optional; Railway
and GitHub Actions are the normal validation path.

## Branches And Environments

| Branch | Railway environment | Purpose |
|---|---|---|
| `dev` | `development` | remote development and integration checks |
| `main` | `production` | production app and live market-data writer |

Railway production remains the only environment that should open the Massive
live WebSocket. Railway development runs provider-disabled backend health/admin
checks by default.

## Railway Development Environment

Railway project `Swordfish` has two long-lived environments:

| Railway environment | Branch | Provider ownership | Data stores |
|---|---|---|---|
| `development` | `dev` | Massive provider disabled | separate dev Redis/Postgres |
| `production` | `main` | owns the single Massive live WebSocket | production Redis/Postgres |

Do not share Redis or Postgres between environments.

Current development services:

| Service | URL | Notes |
|---|---|---|
| `mk3-backend` | `https://mk3-backend-development.up.railway.app` | provider-disabled backend |
| `mk3-frontend` | `https://mk3-frontend-development.up.railway.app` | points at the development backend |
| `Postgres-89lN` | internal Railway network | development-only durable store |
| `Redis-FBxD` | internal Railway network | development-only hot store |

Required backend settings are configured as:

```bash
HUB_DISABLE_PROVIDER_CONNECTION=true
HUB_ENABLE_SCHEDULED_JOBS=false
HUB_REBUILD_HOT_CACHE_ON_STARTUP=false
SENTRY_ENVIRONMENT=development
```

Attach development Redis and Postgres services separately from production. Do
not share production Redis or Postgres with development.

Required frontend settings:

```bash
NEXT_PUBLIC_HUB_URL=https://mk3-backend-development.up.railway.app
NEXT_PUBLIC_SITE_URL=https://mk3-frontend-development.up.railway.app
NEXT_PUBLIC_SENTRY_ENVIRONMENT=development
SENTRY_ENVIRONMENT=development
```

Development health expectations:

- backend `/health` returns `status=ok`
- backend `services.massiveWs` returns `disabled`, not `connected`
- backend Redis and Timescale/Postgres return `connected`
- frontend `/health` returns `ok`

Production backend settings should keep:

```bash
HUB_DISABLE_PROVIDER_CONNECTION=false
HUB_ENABLE_SCHEDULED_JOBS=false
```

Trigger.dev owns production recurring schedules, so backend-local cron remains
disabled in production.

Current production services:

| Service | URL | Notes |
|---|---|---|
| `mk3-backend` | `https://mk3-backend-production.up.railway.app` | production live market-data writer |
| `mk3-frontend` | `https://swordfsh.app` | production frontend |
| `Postgres` | internal Railway network | production durable store |
| `Redis` | internal Railway network | production hot store |

Current public health checks:

```bash
curl -fsS https://mk3-backend-development.up.railway.app/health
curl -fsS https://mk3-frontend-development.up.railway.app/health
curl -fsS https://mk3-backend-production.up.railway.app/health
curl -fsS https://swordfsh.app/health
```

Expected results:

- development backend: `status=ok`, Redis connected, Timescale/Postgres
  connected, `massiveWs=disabled`
- production backend: `status=ok`, Redis connected, Timescale/Postgres
  connected, `massiveWs=connected`
- both frontends: `ok`

## Railway CLI Auth

For non-interactive agent/CLI use, Railway expects `RAILWAY_TOKEN`.
`RAILWAY-TOKEN` is not a valid shell variable name.

A token in `~/.zshrc` works for interactive shells, but Codex/non-interactive
login shells may not load it. Put token exports in `~/.zprofile` or
`~/.zshenv` when the agent needs them automatically.

When using separate Railway project/environment tokens, store them under
environment-specific names and set `RAILWAY_TOKEN` only for the command being
run:

```zsh
export RAILWAY_TOKEN_PRODUCTION="<production-token>"
export RAILWAY_TOKEN_DEVELOPMENT="<development-token>"

rwprod() {
  RAILWAY_TOKEN="$RAILWAY_TOKEN_PRODUCTION" railway "$@"
}

rwdev() {
  RAILWAY_TOKEN="$RAILWAY_TOKEN_DEVELOPMENT" railway "$@"
}
```

Usage:

```bash
rwdev service list --environment development --json
rwprod service list --environment production --json

RAILWAY_TOKEN="$RAILWAY_TOKEN_DEVELOPMENT" railway service status \
  --service mk3-frontend \
  --environment development \
  --json
```

Do not export one global `RAILWAY_TOKEN` for both environments unless it is an
account token or project token with access to both `development` and
`production`; otherwise commands may silently point at the wrong access scope.

Current token status observed on May 26, 2026:

- token works when `~/.zshrc` is explicitly sourced
- token can read production services/config
- token is rejected for `development` service reads

Use a Railway account token or a project token with access to both
`development` and `production` if the agent needs to manage both environments
without browser OAuth login.

## Railway Build Triage

Railway deployment history and active runtime state are different things:

- `service list` / `service status` show the active serving deployment status.
- `deployment list` shows deployment attempts, including failed builds that are
  no longer serving traffic.
- A service can be healthy and serving from deployment `A` while the newest
  deployment record `B` is failed and stopped.
- Build logs belong to a specific deployment ID; always inspect the failed
  deployment ID before assuming the running service is broken.

Useful commands:

```bash
rwdev service list --environment development --json
rwdev deployment list --service mk3-frontend --environment development --json
rwdev logs <deployment-id> --service mk3-frontend --environment development --build --lines 200 --json

rwprod service list --environment production --json
rwprod deployment list --service mk3-frontend --environment production --json
rwprod logs <deployment-id> --service mk3-frontend --environment production --build --lines 200 --json
```

Do not treat a failed newest deployment as downtime until the public health
check or active service status confirms the active deployment is unhealthy.

If a frontend deployment fails during dependency installation with no explicit
application error, compare it against the latest successful concurrent
deployment before changing code. A known May 26, 2026 failure mode was a
transient Railway builder termination during `bun install`; a concurrent
deployment of the same code succeeded on another builder and the service kept
serving from the successful deployment.

Observed development frontend evidence:

- active serving deployment: `1680ddc8-7bba-43ff-bd60-b4029cd71909`
- newest failed stopped deployment: `a0ecc076-b752-4597-85b3-bae49050320d`
- failed build log stopped during dependency installation/copy with no
  TypeScript, Next.js, lint, or runtime error
- public `https://mk3-frontend-development.up.railway.app/health` returned
  `ok`, and the home page served from the active successful deployment

Treat this as infrastructure-transient when all of these are true:

- the failed log ends during dependency installation without a TypeScript,
  Next.js, lint, or runtime error
- another deployment of the same commit succeeds
- the service URL and `/health` are serving from the successful deployment

In that case, prefer waiting for the successful deployment or letting the next
Git-driven deployment replace it. Do not manually deploy just to clear a stale
failed deployment record unless the active service is unhealthy.

## Trigger.dev

Keep the existing Trigger.dev project and production schedules:

- `daily-clear`
- `snapshot-refresh`
- `front-month-refresh`
- `subscription-refresh`

Do not create development schedules yet. The development backend is
provider-disabled, so validate it through `/health`, admin endpoints, and
manual smoke checks instead.

## Sentry

Current Sentry projects:

- `swordfish-frontend`
- `swordfish-backend`

Use Sentry environments:

- `development`
- `production`

Set DSNs in Railway, not GitHub Actions:

- frontend: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`
- backend: `SENTRY_DSN`

Set releases when practical:

```bash
NEXT_PUBLIC_SENTRY_RELEASE=<git-sha>
SENTRY_RELEASE=<git-sha>
```

Sentry setup status:

- both projects were created under org `david-erwin`
- default project DSNs were retrieved through the Sentry API
- Railway development and production variables were wired for frontend and
  backend Sentry DSNs, environments, releases, and sample rates
- development smoke events were dispatched and retrieved by event ID in both
  projects
- Railway services were redeployed after the Sentry variable update

Useful Sentry token scopes for future setup work:

```bash
org:read
team:read
project:read
project:write
```

If the organization disables member project creation, add either `org:write` or
`team:admin` for the project creation step.

## GitHub Actions

The CI workflow runs on pull requests into `dev` or `main`, and pushes to
`dev` or `main`.

Fast gates:

- backend install, typecheck, and smoke tests
- frontend install, lint, tests, and production build

CI uses safe placeholder env values. Real secrets stay in Railway, Sentry, and
Trigger.dev.

## Promotion Flow

Normal deployments should be Git-driven:

- merge to `dev` -> Railway development deploys
- merge `dev` to `main` -> Railway production deploys

Avoid `railway up` / manual deploys for routine application releases. Manual
Railway deploys are acceptable only for bootstrap, emergency recovery, or
one-off infrastructure validation, and should be documented in `goal.md` when
used.

1. Open a PR into `dev`.
2. Wait for GitHub Actions to pass.
3. Merge to `dev`; Railway deploys development.
4. Smoke development frontend and backend health.
5. Open/merge PR from `dev` to `main`.
6. Railway deploys production.
7. Run backend production data-layer verifier.
8. Inspect Trigger.dev production runs/deploys.
9. Confirm Sentry receives events in the expected environment.
