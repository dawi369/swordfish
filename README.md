# MK3

Monorepo for the Swordfish frontend and futures-data backend.

## Services

- `frontend/` — Next.js app
- `backend/` — Bun hub API + WebSocket service
- `docker-compose.yml` — local Redis for development

## Docs

Start with the docs index:

- [docs/README.md](/Users/dawi/dev/mk3/docs/README.md)

Core backend/data-layer docs:

- [docs/architecture/system-context.md](/Users/dawi/dev/mk3/docs/architecture/system-context.md)
- [docs/architecture/data-flow.md](/Users/dawi/dev/mk3/docs/architecture/data-flow.md)
- [docs/backend/data-layer.md](/Users/dawi/dev/mk3/docs/backend/data-layer.md)
- [docs/backend/redis-keyspace.md](/Users/dawi/dev/mk3/docs/backend/redis-keyspace.md)
- [docs/specs/backend-data-layer-v1.md](/Users/dawi/dev/mk3/docs/specs/backend-data-layer-v1.md)

## Deploying

Railway is currently the intended hosting target for both services.

- Deployment topology: [docs/architecture/deployment-topology.md](/Users/dawi/dev/mk3/docs/architecture/deployment-topology.md)
- Railway runbook: [docs/runbooks/railway-deploy.md](/Users/dawi/dev/mk3/docs/runbooks/railway-deploy.md)
- Failed build debugging: [docs/runbooks/failed-build-debugging.md](/Users/dawi/dev/mk3/docs/runbooks/failed-build-debugging.md)
- Frontend env template: [frontend/.env.example](/Users/dawi/dev/mk3/frontend/.env.example)
- Backend env template: [backend/.env.example](/Users/dawi/dev/mk3/backend/.env.example)

Service-local Railway config already exists in:

- [frontend/railway.toml](/Users/dawi/dev/mk3/frontend/railway.toml)
- [backend/railway.toml](/Users/dawi/dev/mk3/backend/railway.toml)
