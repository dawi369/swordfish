# Swordfish Docs

This directory is the source of truth for Swordfish system, backend, data-layer, operational, and planning docs.

## Read First

1. [architecture/system-context.md](./architecture/system-context.md)
   System map, service boundaries, and external dependencies.
2. [architecture/data-flow.md](./architecture/data-flow.md)
   End-to-end market-data flow from Massive to the frontend terminal.
3. [backend/data-layer.md](./backend/data-layer.md)
   Current backend persistence model and source-of-truth rules.
4. [specs/backend-data-layer-v1.md](./specs/backend-data-layer-v1.md)
   Working spec for the backend/data-layer refinement phase.

## Sections

- [architecture/](./architecture/README.md)
  Stable system-level docs. These explain how the repo works as a product and runtime.
- [backend/](./backend/README.md)
  Current backend implementation docs verified against source.
- [decisions/](./decisions/README.md)
  ADRs for decisions we do not want to relitigate.
- [specs/](./specs/README.md)
  Planned work, target behavior, and migration specs.
- [runbooks/](./runbooks/README.md)
  Operator procedures for deploys, incidents, and debugging.
- [roadmap/](./roadmap/README.md)
  Known risks, hardening plans, and deferred work.

## Docs Rule

Every backend or data-layer change should update exactly one of:

- an architecture doc when the system shape changes
- a backend doc when current behavior changes
- a spec when planned behavior changes
- an ADR when a meaningful decision is made or reversed
- a runbook when operational behavior changes

Docs should clearly distinguish current behavior from intended behavior.

