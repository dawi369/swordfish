# Known Risks

## Backend/Data Layer

- Redis is a hot store, not archival storage.
- RedisTimeSeries retention limits chart history.
- Missing RedisTimeSeries module would break range writes/reads.
- Session rules are still approximate for some products.
- Recovery is local and provider-dependent.
- Active-contract and snapshot quality depend on Massive coverage.
- Front-month confidence can degrade around rolls or sparse liquidity.

## Operations

- Admin endpoints are API-key protected but may still be exposed on the public backend domain.
- Rate limiting is per instance.
- Railway frontend and backend deploy independently; one can fail while the other succeeds.
- Build failures and deploy healthcheck failures require different log commands.

## Product/Beta

- Terminal access currently depends on auth/subscription state.
- Billing/account surfaces are not the beta core.
- AI Lab and backtesting are not required for Redis-only beta.

## Decisions Needed

- beta access model: manual Pro provisioning, beta flag, or billing completion
- admin endpoint exposure model
- acceptable Redis retention window
- minimum confidence required to display front-month labels

