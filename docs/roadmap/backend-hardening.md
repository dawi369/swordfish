# Backend Hardening

## Priority Areas

1. Redis contract tests
2. API response contract tests
3. recovery/backfill observability
4. provider failure states
5. admin endpoint exposure review
6. session calendar refinement
7. deployment verification checklist

## Near-Term Work

- Add focused tests around Redis key retention and index sets.
- Document exact public API response shapes.
- Add stale/fresh timestamps to snapshot, contract, and front-month surfaces where missing.
- Decide whether admin routes should live on the public backend host.
- Add one command/checklist for post-deploy backend verification.

