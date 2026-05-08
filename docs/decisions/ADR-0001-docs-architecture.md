# ADR-0001: Docs Architecture

## Status

Accepted

## Context

MK3 had useful docs split across root docs, backend docs, and frontend docs. Backend/data-layer refinement needs a single navigation model and clear separation between current behavior, intended behavior, decisions, specs, runbooks, and roadmap risks.

## Decision

Use root `docs/` as the cross-service source of truth with these sections:

- `architecture/`
- `backend/`
- `decisions/`
- `specs/`
- `runbooks/`
- `roadmap/`

Keep service-local docs only when they are narrowly implementation-specific and not needed for cross-service planning.

## Consequences

- Backend/data-layer docs now live under `docs/backend/`.
- Planned backend work lives under `docs/specs/`.
- Stable decisions live under `docs/decisions/`.
- Operational procedures live under `docs/runbooks/`.
- Old docs should be redirected or removed after migration.

## Revisit When

Frontend work becomes the primary refactor target or the repo grows enough to need package-owned docs again.

