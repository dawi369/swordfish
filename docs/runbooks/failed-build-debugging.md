# Failed Build Debugging

## Identify Service And Deployment

```bash
railway deployment list --service swordfish-frontend --environment production --limit 20
railway deployment list --service swordfish-backend --environment production --limit 20
```

## Pull Build Logs

```bash
railway logs --build --lines 500 <deployment-id>
```

## Frontend Local Repro

```bash
cd frontend
bun run build
```

If Railway fails during `next build`, local `bun run build` is the first reproduction target.

## Backend Local Repro

```bash
cd backend
bunx tsc --noEmit
bun run test:unit
```

## Known Recent Failure

The 2026-05-07 frontend failure on deployment `04ba58c2-f930-477e-89d9-c5529421792e` was:

```text
Type error: Cannot find name 'HEALTHCHECK_PATH'.
```

Fix was to restore `HEALTHCHECK_PATH = "/health"` in `frontend/src/proxy.ts` and align `frontend/railway.toml` to `/health`.

