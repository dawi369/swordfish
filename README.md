# MK3

Futures terminal workbench.

MK3 is the current Swordfish build: a fast frontend, a Bun market-data hub,
Redis as the hot serving layer, durable Postgres/Timescale-shaped storage for
analytics state, and enough backend discipline to make the thing debuggable when
real data starts acting weird.

The goal is not another pretty chart toy. The direction is:

- futures-first, not equities with a futures skin
- live bars, sessions, snapshots, active contracts, and front-month logic
- Redis for low-latency product state
- durable `bars_1m` storage for live bars, backfills, quality checks, and future
  flat-file ingestion
- explicit jobs and recovery instead of mystery cron behavior
- operator visibility built into the app, not hidden in vibes and logs
- Sentry for breakage, PostHog for product usage, admin console for system state

## Shape

```text
mk3/
|-- frontend/        # Next.js terminal UI
|-- backend/         # Bun hub API, WebSocket service, jobs
|-- docs/            # architecture, backend contracts, runbooks
`-- docker-compose.yml
```

## Runtime

- `frontend/` serves the Swordfish terminal.
- `backend/` connects to Massive, normalizes market data, writes Redis plus durable `bars_1m`, and exposes REST/WebSocket APIs.
- `Redis` is the hot serving path. It holds latest bars, time-series data, sessions, snapshots, active contracts, recovery checkpoints, and job state.
- `Postgres` is the durable analytics path. It stores normalized bars, operational runs, ingestion runs, provider outcomes, and quality summaries when `DATABASE_URL` is configured.
- `Railway` is the current deployment target.

## Local

```bash
docker compose up -d redis

cd backend
bun run dev

cd ../frontend
bun run dev
```

Frontend runs on `http://localhost:3010`.
Backend defaults to `http://localhost:3001`.

## Operator Console

In the terminal UI:

1. Press `Cmd+K`
2. Type `admin`
3. Unlock with the configured admin password

The panel shows backend health, Redis freshness, scheduled jobs, subscriptions,
and safe manual refresh actions. In local dev the fallback password is `5565`.
Production should use `ADMIN_PANEL_PASSWORD` and `ADMIN_PANEL_SESSION_SECRET`.

## Useful Commands

```bash
cd backend
bun run test:unit

cd ../frontend
bun run test
bunx tsc --noEmit --skipLibCheck
```

## Source Of Truth

Start here when changing backend/data behavior:

- [docs/README.md](./docs/README.md)
- [docs/architecture/data-flow.md](./docs/architecture/data-flow.md)
- [docs/backend/data-layer.md](./docs/backend/data-layer.md)
- [docs/backend/redis-keyspace.md](./docs/backend/redis-keyspace.md)
- [docs/specs/health-and-observability.md](./docs/specs/health-and-observability.md)
- [docs/runbooks/railway-deploy.md](./docs/runbooks/railway-deploy.md)

## Status

Frontend is well underway. Backend is moving from "working beta pipe" toward
production-grade market-data infrastructure: clearer contracts, better recovery,
admin visibility, and fewer places where future us has to guess.
