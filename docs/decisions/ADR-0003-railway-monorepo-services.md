# ADR-0003: Railway Monorepo Services

## Status

Accepted

## Context

MK3 is a monorepo with separate frontend and backend services plus Redis. Railway is the intended host. Railway service roots and healthchecks are configured per service.

## Decision

Deploy the repo as separate Railway services:

- `mk3-frontend` rooted at `/frontend`
- `mk3-backend` rooted at `/backend`
- Redis as a separate Railway service

Each app service owns its own `railway.toml` and `Dockerfile`.

## Consequences

- Frontend and backend can fail independently.
- Service-local `railway.toml` files must stay aligned with runtime health endpoints.
- `main` deploys should be treated as production deploy triggers.
- Railway debugging should always identify service, deployment id, branch, commit, and log type.

## Revisit When

- The deployment target changes.
- A staging environment becomes required.
- Services need independent repositories or release trains.

