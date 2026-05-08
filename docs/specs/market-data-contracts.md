# Market Data Contracts

## Status

Draft

## Purpose

Define the stable contract between backend market-data storage/API and frontend terminal rendering.

## Backend Provides

- latest bars
- range bars by symbol/timeframe/time range
- session bars by symbol/timeframe/session timestamp
- all sessions
- session history per symbol
- snapshots
- live WebSocket bar stream

## Frontend Assumes

- `/symbols` returns the current symbol universe.
- `/snapshots` returns snapshot data keyed by symbol.
- `/sessions` returns session state enough to render ticker context.
- `/bars/range/:symbol` can hydrate chart history.
- WebSocket messages can append live bars without refetching all state.

## Contract Risks

- Symbols may disappear or roll.
- Provider snapshots may be stale or absent.
- Session state may exist before chart history is fully hydrated.
- Redis range data is rolling and may not cover older requested windows.

## Required Refinement

- document exact JSON response shapes
- version or test the WebSocket message shape
- decide how stale/missing snapshot data is represented
- decide how frontend should handle missing history for valid symbols

