import { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD } from "@/config/env.js";
import { LIMITS } from "@/config/limits.js";
import type { Bar, SessionData, SnapshotData, IndicatorBucket } from "@/types/common.types.js";
import type { ActiveContract, StoredActiveContracts } from "@/types/contract.types.js";
import type {
  RecoveryCheckpoint,
  RecoveryTimeframe,
} from "@/types/recovery.types.js";
import { RECOVERY_TIMEFRAME } from "@/types/recovery.types.js";
import {
  getCurrentSessionWindow,
  getSessionWindowForTimestamp,
  isCurrentSessionBar,
} from "@/utils/market_session.js";
import { Redis } from "ioredis";

const IS_TEST_ENV = Bun.env.NODE_ENV === "test";

// Redis Key Constants
const KEYS = {
  LATEST_HASH: "bar:latest", // HASH: symbol -> bar JSON
  STREAM: "market_data", // STREAM: real-time event bus
  PUBSUB_CHANNEL: "bars", // PUB/SUB: legacy support
  META_DATE: "meta:trading_date",
  META_COUNT: "meta:bar_count",
  SUBSCRIBED_SYMBOLS: "meta:subscribed_symbols",
  SNAPSHOTS_INDEX: "meta:index:snapshots",
  ACTIVE_CONTRACTS_INDEX: "meta:index:active_contracts",
  RECOVERY_CHECKPOINTS_INDEX: "meta:index:recovery_checkpoints",
  RECOVERY_CHECKPOINT_PREFIX: "recovery:checkpoint:",
  SESSION_PREFIX: "session:", // HASH per symbol: session:{symbol}
  SNAPSHOT_PREFIX: "snapshot:", // HASH per symbol: snapshot:{symbol}
  ACTIVE_CONTRACTS_PREFIX: "contracts:active:", // STRING per product
} as const;

const TS_FIELDS = ["open", "high", "low", "close", "volume", "trades"] as const;
type TimeSeriesField = (typeof TS_FIELDS)[number];

const TIMEFRAMES = [
  "1s",
  "15s",
  "30s",
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "1d",
] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const TIMEFRAME_MS: Record<Timeframe, number> = {
  "1s": 1000,
  "15s": 15000,
  "30s": 30000,
  "1m": 60000,
  "5m": 300000,
  "15m": 900000,
  "30m": 1800000,
  "1h": 3600000,
  "2h": 7200000,
  "4h": 14400000,
  "1d": 86400000,
};

const DOWNSAMPLE_RULES: Array<{ source: Timeframe; dest: Timeframe; bucketMs: number }> = [
  { source: "1s", dest: "15s", bucketMs: TIMEFRAME_MS["15s"] },
  { source: "1s", dest: "30s", bucketMs: TIMEFRAME_MS["30s"] },
  { source: "1s", dest: "1m", bucketMs: TIMEFRAME_MS["1m"] },
  { source: "1m", dest: "5m", bucketMs: TIMEFRAME_MS["5m"] },
  { source: "1m", dest: "15m", bucketMs: TIMEFRAME_MS["15m"] },
  { source: "1m", dest: "30m", bucketMs: TIMEFRAME_MS["30m"] },
  { source: "1m", dest: "1h", bucketMs: TIMEFRAME_MS["1h"] },
  { source: "1h", dest: "2h", bucketMs: TIMEFRAME_MS["2h"] },
  { source: "1h", dest: "4h", bucketMs: TIMEFRAME_MS["4h"] },
  { source: "1h", dest: "1d", bucketMs: TIMEFRAME_MS["1d"] },
];

const TS_PREFIX = "ts:bar";

function buildTsKey(tf: Timeframe, symbol: string, field: TimeSeriesField): string {
  return `${TS_PREFIX}:${tf}:${symbol}:${field}`;
}

function buildSessionKey(symbol: string, sessionId: string): string {
  return `${KEYS.SESSION_PREFIX}${symbol}:${sessionId}`;
}

function extractRootSymbol(symbol: string): string {
  const match = symbol.match(/^([A-Z0-9]+)[FGHJKMNQUVXZ]\d{1,2}$/);
  return match?.[1] || symbol;
}

function normalizeTimestampMs(value: number): number {
  if (!Number.isFinite(value)) return value;
  return value < 1e12 ? value * 1000 : value;
}

function parseNumber(value: string | number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function calcIndicatorPos(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return 0.5;
  }
  const range = max - min;
  if (range <= 0) return 0.5;
  return clamp((value - min) / range, 0, 1);
}

function bucketForPos(pos: number): IndicatorBucket {
  if (pos <= 0.33) return "low";
  if (pos <= 0.66) return "mid";
  return "high";
}

function isIgnorableRedisError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return (
    message.includes("already exists") ||
    message.includes("busykey") ||
    message.includes("already has a src rule") ||
    message.includes("already has a source rule")
  );
}

class RedisStore {
  public redis: Redis;
  private tsInitialized = new Set<string>();
  private tsInitPromises = new Map<string, Promise<void>>();

  constructor() {
    this.redis = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      family: IS_TEST_ENV ? 4 : undefined,
      password: REDIS_PASSWORD,
      lazyConnect: true,
      enableOfflineQueue: !IS_TEST_ENV,
      maxRetriesPerRequest: IS_TEST_ENV ? 1 : null,
      retryStrategy: IS_TEST_ENV
        ? undefined
        : (times) => {
            // Exponential backoff with max delay of 2 seconds
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
    });

    this.redis.on("connect", () => {
      if (!IS_TEST_ENV) {
        console.log("Redis connected");
      }
      const today = new Date().toISOString().split("T")[0]!;
      this.redis.setnx(KEYS.META_DATE, today).catch(() => undefined);
      this.redis.setnx(KEYS.META_COUNT, "0").catch(() => undefined);
    });
    this.redis.on("error", (err: any) => {
      if (IS_TEST_ENV) {
        return;
      }
      console.error("Redis error:", err);
      if (err.code === "ECONNREFUSED") {
        console.error(
          "❌ Redis connection refused. Is the 'redis' container running? (docker compose up -d redis)",
        );
      }
    });
  }

  async ping(): Promise<string> {
    return await this.redis.ping();
  }

  private getRecoveryCheckpointKey(
    symbol: string,
    timeframe: RecoveryTimeframe = RECOVERY_TIMEFRAME,
  ): string {
    return `${KEYS.RECOVERY_CHECKPOINT_PREFIX}${timeframe}:${symbol}`;
  }

  /**
   * Write a bar to all storage locations:
   * - HSET bar:latest {symbol} (latest bar per symbol in single hash)
   * - TS.MADD ts:bar:1s:{symbol}:{field} (TimeSeries storage + downsample rules)
   * - XADD market_data (real-time stream)
   * - PUBLISH bars (legacy pub/sub)
   */
  async writeBar(
    bar: Bar,
    options?: {
      emitStream?: boolean;
      incrementCount?: boolean;
      updateSession?: boolean;
      publishLegacy?: boolean;
    },
  ): Promise<void> {
    const resolvedOptions = {
      emitStream: options?.emitStream ?? true,
      incrementCount: options?.incrementCount ?? true,
      updateSession: options?.updateSession ?? true,
      publishLegacy: options?.publishLegacy ?? true,
    };

    const barJson = JSON.stringify(bar);
    await this.ensureTimeSeriesForSymbol(bar.symbol);
    await this.writeTimeSeries(bar);

    const multi = this.redis.multi();

    // Latest bar: single hash with symbol as field
    multi.hset(KEYS.LATEST_HASH, bar.symbol, barJson);

    // Metadata
    if (resolvedOptions.incrementCount) {
      multi.incr(KEYS.META_COUNT);
    }

    // Stream for real-time consumers
    if (resolvedOptions.emitStream) {
      multi.xadd(
        KEYS.STREAM,
        "MAXLEN",
        "~",
        LIMITS.maxStreamLength.toString(),
        "*",
        "data",
        barJson,
      );
    }

    await multi.exec();

    // Update session calculations (VWAP, CVOL, High/Low)
    if (resolvedOptions.updateSession) {
      await this.updateSession(bar);
    }

    // Legacy pub/sub for Edge servers
    if (resolvedOptions.publishLegacy) {
      await this.redis.publish(KEYS.PUBSUB_CHANNEL, barJson);
    }
  }

  async writeBarsForRecovery(bars: Bar[]): Promise<void> {
    const sorted = [...bars].sort((left, right) => left.startTime - right.startTime);
    for (const bar of sorted) {
      await this.writeRecoveredBar(bar, RECOVERY_TIMEFRAME);
    }
  }

  async writeRecoveredBar(
    bar: Bar,
    timeframe: RecoveryTimeframe = RECOVERY_TIMEFRAME,
  ): Promise<void> {
    await this.ensureTimeSeriesForSymbol(bar.symbol);
    await this.writeTimeSeriesAtTimeframe(bar, timeframe as Timeframe);

    const latest = await this.getLatest(bar.symbol);
    if (!latest || bar.startTime >= latest.startTime) {
      await this.redis.hset(KEYS.LATEST_HASH, bar.symbol, JSON.stringify(bar));
    }

    await this.updateSession(bar);
  }

  /**
   * Update session calculations for a symbol
   * Called on every bar to maintain running VWAP, CVOL, High/Low
   */
  private async updateSession(bar: Bar): Promise<void> {
    const sessionWindow = getSessionWindowForTimestamp(bar.symbol, bar.startTime);
    if (!sessionWindow) {
      return;
    }

    const key = buildSessionKey(bar.symbol, sessionWindow.sessionId);

    // Get current session data (may not exist yet)
    const existing = await this.redis.hgetall(key);

    const now = Date.now();
    const priceVolume = bar.close * bar.volume;

    const volNow = bar.volume;
    const shouldReset = Object.keys(existing).length === 0;

    if (shouldReset) {
      // First bar of session - initialize
      const vwapMin = bar.close;
      const vwapMax = bar.close;
      const volMin = volNow;
      const volMax = volNow;
      const vwapPos = calcIndicatorPos(bar.close, vwapMin, vwapMax);
      const volPos = calcIndicatorPos(volNow, volMin, volMax);

      const session: SessionData = {
        sessionId: sessionWindow.sessionId,
        sessionStartTime: sessionWindow.sessionStartTime,
        sessionEndTime: sessionWindow.sessionEndTime,
        rootSymbol: sessionWindow.rootSymbol,
        timezone: sessionWindow.timezone,
        dayOpen: bar.open,
        dayHigh: bar.high,
        dayLow: bar.low,
        vwap: bar.close, // First bar: VWAP = close
        cvol: bar.volume,
        tradeCount: bar.trades,
        volNow,
        volMin,
        volMax,
        volPos,
        volBucket: bucketForPos(volPos),
        vwapMin,
        vwapMax,
        vwapPos,
        vwapBucket: bucketForPos(vwapPos),
        cumPriceVolume: priceVolume,
        cumVolume: bar.volume,
        timestamp: now,
      };
      await this.redis.hset(key, session as unknown as Record<string, string>);
    } else {
      // Update running calculations
      const cumPriceVolume = parseFloat(existing.cumPriceVolume || "0") + priceVolume;
      const cumVolume = parseFloat(existing.cumVolume || "0") + bar.volume;
      const vwap = cumVolume > 0 ? cumPriceVolume / cumVolume : 0;

      const vwapMin = Math.min(parseNumber(existing.vwapMin, vwap), vwap);
      const vwapMax = Math.max(parseNumber(existing.vwapMax, vwap), vwap);
      const volMin = Math.min(parseNumber(existing.volMin, volNow), volNow);
      const volMax = Math.max(parseNumber(existing.volMax, volNow), volNow);
      const vwapPos = calcIndicatorPos(vwap, vwapMin, vwapMax);
      const volPos = calcIndicatorPos(volNow, volMin, volMax);

      const updates: Record<string, string | number> = {
        dayHigh: Math.max(parseFloat(existing.dayHigh || "0"), bar.high),
        dayLow: Math.min(parseFloat(existing.dayLow || String(bar.low)), bar.low),
        vwap,
        cvol: parseFloat(existing.cvol || "0") + bar.volume,
        tradeCount: parseInt(existing.tradeCount || "0") + bar.trades,
        volNow,
        volMin,
        volMax,
        volPos,
        volBucket: bucketForPos(volPos),
        vwapMin,
        vwapMax,
        vwapPos,
        vwapBucket: bucketForPos(vwapPos),
        cumPriceVolume,
        cumVolume,
        timestamp: now,
      };

      await this.redis.hset(key, updates);
    }
  }

  private async ensureTimeSeriesForSymbol(symbol: string): Promise<void> {
    if (this.tsInitialized.has(symbol)) return;

    const existingPromise = this.tsInitPromises.get(symbol);
    if (existingPromise) {
      await existingPromise;
      return;
    }

    const initPromise = this.createTimeSeriesForSymbol(symbol);
    this.tsInitPromises.set(symbol, initPromise);

    try {
      await initPromise;
      this.tsInitialized.add(symbol);
    } finally {
      this.tsInitPromises.delete(symbol);
    }
  }

  private async createTimeSeriesForSymbol(symbol: string): Promise<void> {
    const product = extractRootSymbol(symbol);
    const retentionMs = LIMITS.redisTsRetentionMs;

    for (const tf of TIMEFRAMES) {
      for (const field of TS_FIELDS) {
        const key = buildTsKey(tf, symbol, field);
        const labels = [
          "symbol",
          symbol,
          "product",
          product,
          "field",
          field,
          "tf",
          tf,
        ];
        await this.createSeries(key, retentionMs, labels);
      }
    }

    for (const field of TS_FIELDS) {
      for (const rule of DOWNSAMPLE_RULES) {
        const sourceKey = buildTsKey(rule.source, symbol, field);
        const destKey = buildTsKey(rule.dest, symbol, field);
        await this.createDownsampleRule(sourceKey, destKey, field, rule.bucketMs);
      }
    }
  }

  private async createSeries(
    key: string,
    retentionMs: number,
    labels: string[],
  ): Promise<void> {
    try {
      await this.redis.call(
        "TS.CREATE",
        key,
        "RETENTION",
        retentionMs.toString(),
        "DUPLICATE_POLICY",
        "LAST",
        "LABELS",
        ...labels,
      );
    } catch (error) {
      if (!isIgnorableRedisError(error)) {
        throw error;
      }
    }
  }

  private async createDownsampleRule(
    sourceKey: string,
    destKey: string,
    field: TimeSeriesField,
    bucketMs: number,
  ): Promise<void> {
    const aggregation = this.getAggregationForField(field);
    try {
      await this.redis.call(
        "TS.CREATERULE",
        sourceKey,
        destKey,
        "AGGREGATION",
        aggregation,
        bucketMs.toString(),
      );
    } catch (error) {
      if (!isIgnorableRedisError(error)) {
        throw error;
      }
    }
  }

  private getAggregationForField(field: TimeSeriesField): string {
    switch (field) {
      case "open":
        return "FIRST";
      case "high":
        return "MAX";
      case "low":
        return "MIN";
      case "close":
        return "LAST";
      case "volume":
      case "trades":
        return "SUM";
      default:
        return "LAST";
    }
  }

  private async writeTimeSeries(bar: Bar): Promise<void> {
    await this.writeTimeSeriesAtTimeframe(bar, "1s");
  }

  private async writeTimeSeriesAtTimeframe(
    bar: Bar,
    timeframe: Timeframe,
  ): Promise<void> {
    const timestamp = normalizeTimestampMs(bar.startTime);
    const args: Array<string> = [];

    for (const field of TS_FIELDS) {
      const key = buildTsKey(timeframe, bar.symbol, field);
      const value = (bar as Record<TimeSeriesField, number>)[field] ?? 0;
      args.push(key, timestamp.toString(), value.toString());
    }

    if (args.length > 0) {
      await this.redis.call("TS.MADD", ...args);
    }
  }

  /**
   * Get latest bar for a specific symbol
   * O(1) operation using HGET
   */
  async getLatest(symbol: string): Promise<Bar | null> {
    const data = await this.redis.hget(KEYS.LATEST_HASH, symbol);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Get all latest bars as a map of symbol -> Bar
   * O(N) where N is number of symbols, single round-trip
   */
  async getAllLatest(): Promise<Record<string, Bar>> {
    const data = await this.redis.hgetall(KEYS.LATEST_HASH);
    const result: Record<string, Bar> = {};
    for (const [symbol, json] of Object.entries(data)) {
      result[symbol] = JSON.parse(json);
    }
    return result;
  }

  /**
   * Get all latest bars as an array
   */
  async getAllLatestArray(): Promise<Bar[]> {
    const data = await this.redis.hgetall(KEYS.LATEST_HASH);
    return Object.values(data).map((json) => JSON.parse(json));
  }

  /**
   * Get list of all symbols with latest bars
   */
  async getSymbols(): Promise<string[]> {
    return await this.redis.hkeys(KEYS.LATEST_HASH);
  }

  /**
   * Get bars for a symbol within a time range for a given timeframe
   */
  async getBarsRange(
    symbol: string,
    startMs: number,
    endMs: number,
    timeframe: Timeframe,
  ): Promise<Bar[]> {
    const range = await this.redis.call(
      "TS.MRANGE",
      startMs.toString(),
      endMs.toString(),
      "WITHLABELS",
      "FILTER",
      `symbol=${symbol}`,
      `tf=${timeframe}`,
    );

    if (!Array.isArray(range)) return [];

    const bucketMs = TIMEFRAME_MS[timeframe];
    const byTimestamp = new Map<number, Partial<Bar>>();

    for (const series of range as any[]) {
      const key = series?.[0] as string | undefined;
      const labels = series?.[1] as Array<[string, string]> | undefined;
      const data = series?.[2] as Array<[number, string]> | undefined;

      if (!Array.isArray(data)) continue;

      const fieldLabel = labels?.find(([label]) => label === "field")?.[1];
      const fieldFromKey = key?.split(":").pop();
      const field = (fieldLabel || fieldFromKey) as TimeSeriesField | undefined;

      if (!field || !TS_FIELDS.includes(field)) continue;

      for (const point of data) {
        const ts = Number(point[0]);
        const value = Number(point[1]);
        const existing = byTimestamp.get(ts) || {
          symbol,
          startTime: ts,
          endTime: ts + bucketMs,
        };
        (existing as any)[field] = value;
        byTimestamp.set(ts, existing);
      }
    }

    const bars: Bar[] = [];
    const sorted = Array.from(byTimestamp.entries()).sort((a, b) => a[0] - b[0]);

    for (const [, partial] of sorted) {
      if (
        partial.open === undefined ||
        partial.high === undefined ||
        partial.low === undefined ||
        partial.close === undefined
      ) {
        continue;
      }

      bars.push({
        symbol,
        open: Number(partial.open),
        high: Number(partial.high),
        low: Number(partial.low),
        close: Number(partial.close),
        volume: Number(partial.volume ?? 0),
        trades: Number(partial.trades ?? 0),
        startTime: Number(partial.startTime),
        endTime: Number(partial.endTime),
      });
    }

    return bars;
  }

  /**
   * Get today's bars for a specific symbol
   */
  async getTodayBars(symbol: string, timeframe: Timeframe = "1s"): Promise<Bar[]> {
    const sessionWindow = getCurrentSessionWindow(symbol);
    if (!sessionWindow) {
      return [];
    }

    return await this.getBarsRange(
      symbol,
      sessionWindow.sessionStartTime,
      Math.min(Date.now(), sessionWindow.sessionEndTime),
      timeframe,
    );
  }

  async getSessionBars(
    symbol: string,
    timestamp = Date.now(),
    timeframe: Timeframe = "1s",
  ): Promise<Bar[]> {
    const sessionWindow = getSessionWindowForTimestamp(symbol, timestamp);
    if (!sessionWindow) {
      return [];
    }

    return await this.getBarsRange(
      symbol,
      sessionWindow.sessionStartTime,
      sessionWindow.sessionEndTime,
      timeframe,
    );
  }

  /**
   * Get session data for a symbol (VWAP, CVOL, High/Low)
   */
  async getSession(symbol: string, timestamp = Date.now()): Promise<SessionData | null> {
    const sessionWindow = getSessionWindowForTimestamp(symbol, timestamp);
    if (!sessionWindow) {
      return null;
    }

    const data = await this.redis.hgetall(buildSessionKey(symbol, sessionWindow.sessionId));
    if (Object.keys(data).length === 0) return null;

    return {
      sessionId: data.sessionId || "",
      sessionStartTime: parseInt(data.sessionStartTime || "0"),
      sessionEndTime: parseInt(data.sessionEndTime || "0"),
      rootSymbol: data.rootSymbol || extractRootSymbol(symbol),
      timezone: data.timezone || "America/Chicago",
      dayOpen: parseFloat(data.dayOpen || "0"),
      dayHigh: parseFloat(data.dayHigh || "0"),
      dayLow: parseFloat(data.dayLow || "0"),
      vwap: parseFloat(data.vwap || "0"),
      cvol: parseFloat(data.cvol || "0"),
      tradeCount: parseInt(data.tradeCount || "0"),
      volNow: parseFloat(data.volNow || "0"),
      volMin: parseFloat(data.volMin || "0"),
      volMax: parseFloat(data.volMax || "0"),
      volPos: parseFloat(data.volPos || "0"),
      volBucket: (data.volBucket as IndicatorBucket) || "mid",
      vwapMin: parseFloat(data.vwapMin || "0"),
      vwapMax: parseFloat(data.vwapMax || "0"),
      vwapPos: parseFloat(data.vwapPos || "0"),
      vwapBucket: (data.vwapBucket as IndicatorBucket) || "mid",
      cumPriceVolume: parseFloat(data.cumPriceVolume || "0"),
      cumVolume: parseFloat(data.cumVolume || "0"),
      timestamp: parseInt(data.timestamp || "0"),
    };
  }

  /**
   * Get all sessions as a map
   */
  async getAllSessions(): Promise<Record<string, SessionData>> {
    const result: Record<string, SessionData> = {};

    const symbols = await this.getSymbols();
    if (symbols.length === 0) {
      return result;
    }

    const keyedSymbols: Array<{
      symbol: string;
      key: string;
      sessionWindow: NonNullable<ReturnType<typeof getSessionWindowForTimestamp>>;
    }> = symbols.flatMap((symbol) => {
        const sessionWindow = getSessionWindowForTimestamp(symbol, Date.now());
        if (!sessionWindow) return [];
        return [
          {
            symbol,
            key: buildSessionKey(symbol, sessionWindow.sessionId),
            sessionWindow,
          },
        ];
      });

    if (keyedSymbols.length === 0) {
      return result;
    }

    const pipeline = this.redis.pipeline();
    for (const entry of keyedSymbols) {
      pipeline.hgetall(entry.key);
    }
    const responses = await pipeline.exec();

    for (const [index, entry] of keyedSymbols.entries()) {
      const response = responses?.[index];
      const data = response?.[1] as Record<string, string> | undefined;
      if (!data || Object.keys(data).length === 0) continue;

      result[entry.symbol] = {
        sessionId: data.sessionId || "",
        sessionStartTime: parseInt(data.sessionStartTime || "0"),
        sessionEndTime: parseInt(data.sessionEndTime || "0"),
        rootSymbol: data.rootSymbol || entry.sessionWindow.rootSymbol,
        timezone: data.timezone || entry.sessionWindow.timezone,
        dayOpen: parseFloat(data.dayOpen || "0"),
        dayHigh: parseFloat(data.dayHigh || "0"),
        dayLow: parseFloat(data.dayLow || "0"),
        vwap: parseFloat(data.vwap || "0"),
        cvol: parseFloat(data.cvol || "0"),
        tradeCount: parseInt(data.tradeCount || "0"),
        volNow: parseFloat(data.volNow || "0"),
        volMin: parseFloat(data.volMin || "0"),
        volMax: parseFloat(data.volMax || "0"),
        volPos: parseFloat(data.volPos || "0"),
        volBucket: (data.volBucket as IndicatorBucket) || "mid",
        vwapMin: parseFloat(data.vwapMin || "0"),
        vwapMax: parseFloat(data.vwapMax || "0"),
        vwapPos: parseFloat(data.vwapPos || "0"),
        vwapBucket: (data.vwapBucket as IndicatorBucket) || "mid",
        cumPriceVolume: parseFloat(data.cumPriceVolume || "0"),
        cumVolume: parseFloat(data.cumVolume || "0"),
        timestamp: parseInt(data.timestamp || "0"),
      };
    }

    return result;
  }

  async getSessionHistory(
    symbol: string,
    startMs = Date.now() - LIMITS.redisTsRetentionMs,
    endMs = Date.now(),
  ): Promise<SessionData[]> {
    const keys = await this.scanKeys(`${KEYS.SESSION_PREFIX}${symbol}:*`);
    const result: SessionData[] = [];
    if (keys.length === 0) {
      return result;
    }

    const pipeline = this.redis.pipeline();
    for (const key of keys) {
      pipeline.hgetall(key);
    }
    const responses = await pipeline.exec();

    for (const [index, key] of keys.entries()) {
      const data = responses?.[index]?.[1] as Record<string, string> | undefined;
      if (!data || Object.keys(data).length === 0) continue;

      const sessionEndTime = parseInt(data.sessionEndTime || "0");
      const sessionStartTime = parseInt(data.sessionStartTime || "0");
      if (sessionEndTime < startMs || sessionStartTime > endMs) {
        continue;
      }

      result.push({
        sessionId: data.sessionId || "",
        sessionStartTime,
        sessionEndTime,
        rootSymbol: data.rootSymbol || extractRootSymbol(symbol),
        timezone: data.timezone || "America/Chicago",
        dayOpen: parseFloat(data.dayOpen || "0"),
        dayHigh: parseFloat(data.dayHigh || "0"),
        dayLow: parseFloat(data.dayLow || "0"),
        vwap: parseFloat(data.vwap || "0"),
        cvol: parseFloat(data.cvol || "0"),
        tradeCount: parseInt(data.tradeCount || "0"),
        volNow: parseFloat(data.volNow || "0"),
        volMin: parseFloat(data.volMin || "0"),
        volMax: parseFloat(data.volMax || "0"),
        volPos: parseFloat(data.volPos || "0"),
        volBucket: (data.volBucket as IndicatorBucket) || "mid",
        vwapMin: parseFloat(data.vwapMin || "0"),
        vwapMax: parseFloat(data.vwapMax || "0"),
        vwapPos: parseFloat(data.vwapPos || "0"),
        vwapBucket: (data.vwapBucket as IndicatorBucket) || "mid",
        cumPriceVolume: parseFloat(data.cumPriceVolume || "0"),
        cumVolume: parseFloat(data.cumVolume || "0"),
        timestamp: parseInt(data.timestamp || "0"),
      });
    }

    result.sort((left, right) => left.sessionStartTime - right.sessionStartTime);
    return result;
  }

  /**
   * Get snapshot data for a symbol (from Massive REST API)
   */
  async getSnapshot(symbol: string): Promise<SnapshotData | null> {
    const data = await this.redis.hgetall(`${KEYS.SNAPSHOT_PREFIX}${symbol}`);
    if (Object.keys(data).length === 0) return null;

    return {
      productCode: data.productCode || "",
      settlementDate: data.settlementDate || "",
      sessionOpen: parseFloat(data.sessionOpen || "0"),
      sessionHigh: parseFloat(data.sessionHigh || "0"),
      sessionLow: parseFloat(data.sessionLow || "0"),
      sessionClose: parseFloat(data.sessionClose || "0"),
      settlementPrice: parseFloat(data.settlementPrice || "0"),
      prevSettlement: parseFloat(data.prevSettlement || "0"),
      change: parseFloat(data.change || "0"),
      changePct: parseFloat(data.changePct || "0"),
      openInterest: data.openInterest ? parseInt(data.openInterest) : null,
      timestamp: parseInt(data.timestamp || "0"),
    };
  }

  /**
   * Get all snapshots as a map
   */
  async getAllSnapshots(): Promise<Record<string, SnapshotData>> {
    const symbols = await this.getIndexedSnapshotSymbols();
    const result: Record<string, SnapshotData> = {};
    if (symbols.length === 0) {
      return result;
    }

    const pipeline = this.redis.pipeline();
    for (const symbol of symbols) {
      pipeline.hgetall(`${KEYS.SNAPSHOT_PREFIX}${symbol}`);
    }
    const responses = await pipeline.exec();

    for (const [index, symbol] of symbols.entries()) {
      const data = responses?.[index]?.[1] as Record<string, string> | undefined;
      if (!data || Object.keys(data).length === 0) continue;

      result[symbol] = {
        productCode: data.productCode || "",
        settlementDate: data.settlementDate || "",
        sessionOpen: parseFloat(data.sessionOpen || "0"),
        sessionHigh: parseFloat(data.sessionHigh || "0"),
        sessionLow: parseFloat(data.sessionLow || "0"),
        sessionClose: parseFloat(data.sessionClose || "0"),
        settlementPrice: parseFloat(data.settlementPrice || "0"),
        prevSettlement: parseFloat(data.prevSettlement || "0"),
        change: parseFloat(data.change || "0"),
        changePct: parseFloat(data.changePct || "0"),
        openInterest: data.openInterest ? parseInt(data.openInterest) : null,
        timestamp: parseInt(data.timestamp || "0"),
      };
    }

    return result;
  }

  /**
   * Write snapshot data for a symbol
   */
  async writeSnapshot(symbol: string, snapshot: SnapshotData): Promise<void> {
    const key = `${KEYS.SNAPSHOT_PREFIX}${symbol}`;
    const multi = this.redis.multi();
    multi.hset(key, snapshot as unknown as Record<string, string>);
    multi.sadd(KEYS.SNAPSHOTS_INDEX, symbol);
    await multi.exec();
  }

  async setSubscribedSymbols(symbols: string[]): Promise<void> {
    const uniqueSymbols = Array.from(new Set(symbols)).sort();
    await this.redis.set(KEYS.SUBSCRIBED_SYMBOLS, JSON.stringify(uniqueSymbols));
  }

  async getSubscribedSymbols(): Promise<string[]> {
    const raw = await this.redis.get(KEYS.SUBSCRIBED_SYMBOLS);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((symbol): symbol is string => typeof symbol === "string")
        : [];
    } catch {
      return [];
    }
  }

  async setRecoveryCheckpoint(checkpoint: RecoveryCheckpoint): Promise<void> {
    const checkpointId = `${checkpoint.timeframe}:${checkpoint.symbol}`;
    const multi = this.redis.multi();
    multi.set(
      this.getRecoveryCheckpointKey(checkpoint.symbol, checkpoint.timeframe),
      JSON.stringify(checkpoint),
    );
    multi.sadd(KEYS.RECOVERY_CHECKPOINTS_INDEX, checkpointId);
    await multi.exec();
  }

  async getRecoveryCheckpoint(
    symbol: string,
    timeframe: RecoveryTimeframe = RECOVERY_TIMEFRAME,
  ): Promise<RecoveryCheckpoint | null> {
    const raw = await this.redis.get(this.getRecoveryCheckpointKey(symbol, timeframe));
    if (!raw) return null;

    try {
      return JSON.parse(raw) as RecoveryCheckpoint;
    } catch {
      return null;
    }
  }

  async getAllRecoveryCheckpoints(): Promise<Record<string, RecoveryCheckpoint>> {
    const checkpointIds = await this.getIndexedRecoveryCheckpointIds();
    const result: Record<string, RecoveryCheckpoint> = {};
    if (checkpointIds.length === 0) {
      return result;
    }

    const pipeline = this.redis.pipeline();
    for (const checkpointId of checkpointIds) {
      const [timeframe, symbol] = checkpointId.split(":");
      if (!timeframe || !symbol) continue;
      pipeline.get(this.getRecoveryCheckpointKey(symbol, timeframe as RecoveryTimeframe));
    }
    const responses = await pipeline.exec();

    for (const [index, checkpointId] of checkpointIds.entries()) {
      const raw = responses?.[index]?.[1] as string | null | undefined;
      if (!raw) continue;

      try {
        const checkpoint = JSON.parse(raw) as RecoveryCheckpoint;
        result[checkpointId] = checkpoint;
      } catch {
        // Ignore malformed checkpoint payloads.
      }
    }

    return result;
  }

  async writeActiveContracts(
    productCode: string,
    contracts: ActiveContract[],
  ): Promise<void> {
    const payload: StoredActiveContracts = {
      productCode,
      updatedAt: Date.now(),
      contracts,
    };

    const multi = this.redis.multi();
    multi.set(`${KEYS.ACTIVE_CONTRACTS_PREFIX}${productCode}`, JSON.stringify(payload));
    multi.sadd(KEYS.ACTIVE_CONTRACTS_INDEX, productCode);
    await multi.exec();
  }

  async getActiveContracts(productCode: string): Promise<StoredActiveContracts | null> {
    const raw = await this.redis.get(`${KEYS.ACTIVE_CONTRACTS_PREFIX}${productCode}`);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as StoredActiveContracts;
    } catch {
      return null;
    }
  }

  async getAllActiveContracts(): Promise<Record<string, StoredActiveContracts>> {
    const productCodes = await this.getIndexedActiveContractCodes();
    const result: Record<string, StoredActiveContracts> = {};
    if (productCodes.length === 0) {
      return result;
    }

    const pipeline = this.redis.pipeline();
    for (const productCode of productCodes) {
      pipeline.get(`${KEYS.ACTIVE_CONTRACTS_PREFIX}${productCode}`);
    }
    const responses = await pipeline.exec();

    for (const [index, productCode] of productCodes.entries()) {
      const raw = responses?.[index]?.[1] as string | null | undefined;
      if (!raw) continue;

      try {
        const stored = JSON.parse(raw) as StoredActiveContracts;
        result[productCode] = stored;
      } catch {
        // Ignore malformed contract payloads.
      }
    }

    return result;
  }

  async getCachedActiveContractSymbols(): Promise<string[]> {
    const allContracts = await this.getAllActiveContracts();
    const symbols = new Set<string>();

    for (const stored of Object.values(allContracts)) {
      for (const contract of stored.contracts) {
        symbols.add(contract.ticker);
      }
    }

    return Array.from(symbols).sort();
  }

  async getStats(): Promise<{
    date: string;
    barCount: number;
    symbolCount: number;
    streamLength: number;
    dbSize: number;
    usedMemoryBytes: number | null;
    indexCounts: {
      snapshots: number;
      activeContracts: number;
      recoveryCheckpoints: number;
    };
  }> {
    const [date, count, symbolCount, streamLength, dbSize, memoryInfo, indexCounts] =
      await Promise.all([
        this.redis.get(KEYS.META_DATE),
        this.redis.get(KEYS.META_COUNT),
        this.redis.hlen(KEYS.LATEST_HASH),
        this.redis.xlen(KEYS.STREAM).catch(() => 0),
        this.redis.dbsize().catch(() => 0),
        this.redis.info("memory").catch(() => ""),
        Promise.all([
          this.redis.scard(KEYS.SNAPSHOTS_INDEX).catch(() => 0),
          this.redis.scard(KEYS.ACTIVE_CONTRACTS_INDEX).catch(() => 0),
          this.redis.scard(KEYS.RECOVERY_CHECKPOINTS_INDEX).catch(() => 0),
        ]),
      ]);
    const usedMemoryMatch = memoryInfo.match(/^used_memory:(\d+)/m);
    const usedMemoryBytes = usedMemoryMatch?.[1]
      ? parseInt(usedMemoryMatch[1], 10)
      : null;

    return {
      date: date || "unknown",
      barCount: parseInt(count || "0"),
      symbolCount,
      streamLength,
      dbSize,
      usedMemoryBytes,
      indexCounts: {
        snapshots: indexCounts[0],
        activeContracts: indexCounts[1],
        recoveryCheckpoints: indexCounts[2],
      },
    };
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [newCursor, foundKeys] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        LIMITS.redisScanBatchSize,
      );
      keys.push(...foundKeys);
      cursor = newCursor;
    } while (cursor !== "0");
    return keys;
  }

  private async getIndexedSnapshotSymbols(): Promise<string[]> {
    const indexedSymbols = await this.redis.smembers(KEYS.SNAPSHOTS_INDEX);
    if (indexedSymbols.length > 0) {
      return indexedSymbols;
    }

    const keys = await this.scanKeys(`${KEYS.SNAPSHOT_PREFIX}*`);
    const symbols = keys.map((key) => key.replace(KEYS.SNAPSHOT_PREFIX, ""));
    if (symbols.length > 0) {
      await this.redis.sadd(KEYS.SNAPSHOTS_INDEX, ...symbols);
    }
    return symbols;
  }

  private async getIndexedActiveContractCodes(): Promise<string[]> {
    const indexedProductCodes = await this.redis.smembers(KEYS.ACTIVE_CONTRACTS_INDEX);
    if (indexedProductCodes.length > 0) {
      return indexedProductCodes;
    }

    const keys = await this.scanKeys(`${KEYS.ACTIVE_CONTRACTS_PREFIX}*`);
    const productCodes = keys.map((key) =>
      key.replace(KEYS.ACTIVE_CONTRACTS_PREFIX, ""),
    );
    if (productCodes.length > 0) {
      await this.redis.sadd(KEYS.ACTIVE_CONTRACTS_INDEX, ...productCodes);
    }
    return productCodes;
  }

  private async getIndexedRecoveryCheckpointIds(): Promise<string[]> {
    const indexedCheckpointIds = await this.redis.smembers(KEYS.RECOVERY_CHECKPOINTS_INDEX);
    if (indexedCheckpointIds.length > 0) {
      return indexedCheckpointIds;
    }

    const keys = await this.scanKeys(`${KEYS.RECOVERY_CHECKPOINT_PREFIX}*`);
    const checkpointIds = keys.map((key) =>
      key.replace(KEYS.RECOVERY_CHECKPOINT_PREFIX, ""),
    );
    if (checkpointIds.length > 0) {
      await this.redis.sadd(KEYS.RECOVERY_CHECKPOINTS_INDEX, ...checkpointIds);
    }
    return checkpointIds;
  }

  private async deleteInBatches(
    keys: string[],
    batchSize = LIMITS.redisDeleteBatchSize,
  ): Promise<number> {
    let deleted = 0;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      await this.redis.del(...batch);
      deleted += batch.length;
    }
    return deleted;
  }

  /**
   * Clear today's data (run at 2 AM ET daily)
   * - Deletes bar:latest hash (single key now!)
   * - Deletes market_data stream
   * - Does NOT delete TimeSeries data (retention handles history)
   * @param force - If true, bypasses the "already cleared today" check
   */
  async clearTodayData(force = false): Promise<{ cleared: number; newDate: string }> {
    const today = new Date().toISOString().split("T")[0]!;
    const lastClear = (await this.redis.get(KEYS.META_DATE)) || "";

    if (!force && lastClear === today) {
      console.log("Already cleared today, skipping (use force=true to override)");
      return { cleared: 0, newDate: today };
    }

    console.log(
      `Clearing Redis data (last clear: ${lastClear || "never"}, new date: ${today}, force: ${force})`,
    );

    let clearedCount = 0;

    // Clear latest hash (single key)
    const latestDeleted = await this.redis.del(KEYS.LATEST_HASH);
    clearedCount += latestDeleted;

    // Clear market_data stream
    const streamDeleted = await this.redis.del(KEYS.STREAM);
    clearedCount += streamDeleted;

    // Clear session data
    const sessionKeys = await this.scanKeys(`${KEYS.SESSION_PREFIX}*`);
    if (sessionKeys.length > 0) {
      clearedCount += await this.deleteInBatches(sessionKeys);
    }

    // Clear symbol snapshots
    const snapshotSymbols = await this.getIndexedSnapshotSymbols();
    const snapshotKeys = snapshotSymbols.map((symbol) => `${KEYS.SNAPSHOT_PREFIX}${symbol}`);
    if (snapshotKeys.length > 0) {
      clearedCount += await this.deleteInBatches(snapshotKeys);
    }

    await this.redis.del(KEYS.SNAPSHOTS_INDEX);

    // Update metadata
    await this.redis.set(KEYS.META_DATE, today);
    await this.redis.set(KEYS.META_COUNT, "0");

    console.log(`Cleared ${clearedCount} keys`);

    return { cleared: clearedCount, newDate: today };
  }

  async runDailyMaintenance(): Promise<{ cleared: number; newDate: string }> {
    const today = new Date().toISOString().split("T")[0]!;
    const lastRun = (await this.redis.get(KEYS.META_DATE)) || "";

    if (lastRun === today) {
      console.log("Daily maintenance already ran today, skipping");
      return { cleared: 0, newDate: today };
    }

    const now = Date.now();
    let clearedCount = 0;

    const sessionKeys = await this.scanKeys(`${KEYS.SESSION_PREFIX}*`);
    for (const key of sessionKeys) {
      const data = await this.redis.hgetall(key);
      const sessionEndTime = parseInt(data.sessionEndTime || "0");
      if (sessionEndTime > 0 && sessionEndTime < now - LIMITS.redisTsRetentionMs) {
        clearedCount += await this.redis.del(key);
      }
    }

    const snapshotSymbols = await this.getIndexedSnapshotSymbols();
    const snapshotKeys = snapshotSymbols.map((symbol) => `${KEYS.SNAPSHOT_PREFIX}${symbol}`);
    const snapshotPipeline = this.redis.pipeline();
    for (const key of snapshotKeys) {
      snapshotPipeline.hgetall(key);
    }
    const snapshotResponses = await snapshotPipeline.exec();

    for (const [index, key] of snapshotKeys.entries()) {
      const data = snapshotResponses?.[index]?.[1] as Record<string, string> | undefined;
      if (!data || Object.keys(data).length === 0) continue;
      const timestamp = parseInt(data.timestamp || "0");
      if (timestamp > 0 && timestamp < now - 36 * 60 * 60 * 1000) {
        clearedCount += await this.redis.del(key);
        const symbol = key.replace(KEYS.SNAPSHOT_PREFIX, "");
        await this.redis.srem(KEYS.SNAPSHOTS_INDEX, symbol);
      }
    }

    await this.redis.set(KEYS.META_DATE, today);
    await this.redis.set(KEYS.META_COUNT, "0");

    return { cleared: clearedCount, newDate: today };
  }
}

export const redisStore = new RedisStore();
