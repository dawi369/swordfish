# Railway Deploy

## Services

- `mk3-frontend`
- `mk3-backend`
- Redis service

## Check Linked Context

```bash
railway status
railway whoami
```

## List Deployments

```bash
railway deployment list --service mk3-frontend --environment production --limit 20
railway deployment list --service mk3-backend --environment production --limit 20
```

## Build Logs

```bash
railway logs --build --latest --lines 300 --service mk3-frontend --environment production
railway logs --build --latest --lines 300 --service mk3-backend --environment production
```

For a specific deployment:

```bash
railway logs --build --lines 500 <deployment-id>
```

## Deploy Logs

```bash
railway logs --deployment --latest --lines 300 --service mk3-backend --environment production
```

## Healthchecks

- Frontend: `/health`
- Backend: `/health`

## Common Failure Split

- Build failure: TypeScript, dependency install, Dockerfile, lockfile, Next build.
- Deploy failure: app starts but healthcheck never passes.
- Runtime failure: deploy succeeds, then logs/HTTP show degraded behavior.

