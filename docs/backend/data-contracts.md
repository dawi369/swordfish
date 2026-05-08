# Backend Data Contracts

These are the canonical backend payload shapes used by current docs and source.

## Bar

```ts
interface Bar {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
  dollarVolume?: number;
  startTime: number;
  endTime: number;
}
```

## Snapshot

```ts
interface SnapshotData {
  productCode: string;
  settlementDate: string;
  sessionOpen: number;
  sessionHigh: number;
  sessionLow: number;
  sessionClose: number;
  settlementPrice: number;
  prevSettlement: number;
  change: number;
  changePct: number;
  openInterest: number | null;
  timestamp: number;
}
```

## Session Metrics

```ts
type IndicatorBucket = "low" | "mid" | "high";

interface SessionData {
  sessionId: string;
  sessionStartTime: number;
  sessionEndTime: number;
  rootSymbol: string;
  timezone: string;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  vwap: number;
  cvol: number;
  tradeCount: number;
  volNow: number;
  volMin: number;
  volMax: number;
  volPos: number;
  volBucket: IndicatorBucket;
  vwapMin: number;
  vwapMax: number;
  vwapPos: number;
  vwapBucket: IndicatorBucket;
  cumPriceVolume: number;
  cumVolume: number;
  timestamp: number;
}
```

## Active Contracts

```ts
interface ActiveContract {
  ticker: string;
  productCode: string;
  lastTradeDate: string;
  active: boolean;
}

interface StoredActiveContracts {
  productCode: string;
  updatedAt: number;
  contracts: ActiveContract[];
}
```

## Front Month

```ts
interface FrontMonthInfo {
  frontMonth: string;
  productCode: string;
  assetClass: MassiveAssetClass;
  volume: number;
  daysToExpiry: number;
  nearestExpiry: string;
  isRolling: boolean;
  lastPrice: number | null;
  expiryDate: string;
  confidence: "low" | "medium" | "high";
  candidateCount: number;
}
```

## Persistence Notes

- Bars are stored as latest hash values, RedisTimeSeries fields, and stream payloads.
- Sessions are stored as hashes keyed by symbol and session id.
- Snapshots are stored as hashes keyed by symbol.
- Active contracts and front-month cache are JSON strings.

