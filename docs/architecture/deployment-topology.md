# Deployment Topology

Railway is the intended production target.

## Services

- `mk3-frontend`
  Root directory: `/frontend`
- `mk3-backend`
  Root directory: `/backend`
- Redis service
  Private networking only.

## Frontend

Service-local config:

- `frontend/railway.toml`
- `frontend/Dockerfile`

Healthcheck:

- `/health`

Important variables:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_HUB_URL`

## Backend

Service-local config:

- `backend/railway.toml`
- `backend/Dockerfile`

Healthcheck:

- `/health`

Important variables:

- `MASSIVE_API_KEY`
- `MASSIVE_API_URL`
- `HUB_HOST=::`
- `HUB_PORT=3001`
- `HUB_API_KEY`
- `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`

## Deployment Notes

- The backend latest deployment can succeed while frontend fails, and vice versa.
- Railway branch deployments currently come from `main`.
- Frontend production builds run `next build`; TypeScript failures block deploy.
- Backend deploy health depends on `/health` returning healthy within Railway's retry window.

See [../runbooks/railway-deploy.md](../runbooks/railway-deploy.md) and [../runbooks/failed-build-debugging.md](../runbooks/failed-build-debugging.md).

