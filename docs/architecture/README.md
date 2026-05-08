# Architecture Docs

Architecture docs describe stable system shape. They should stay higher level than source files and lower level than product strategy.

## Documents

- [system-context.md](./system-context.md)
  Services, external dependencies, and repo ownership.
- [runtime-boundaries.md](./runtime-boundaries.md)
  What each service owns and what is beta-critical.
- [data-flow.md](./data-flow.md)
  Market-data path through ingestion, storage, API, WebSocket, and frontend hydration.
- [deployment-topology.md](./deployment-topology.md)
  Railway service layout and runtime requirements.

