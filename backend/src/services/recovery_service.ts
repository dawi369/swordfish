import { recoveryStore } from "@/server/data/recovery_store.js";
import { redisStore } from "@/server/data/redis_store.js";
import type { Bar } from "@/types/common.types.js";
import {
  RECOVERY_BUCKET_MS,
  RECOVERY_OVERLAP_MS,
  RECOVERY_RETENTION_MS,
  RECOVERY_TIMEFRAME,
  type RecoveryCheckpoint,
  type RecoveryExecutionResult,
  type RecoveryRunSource,
  type RecoveryStore,
  type RecoveryWindow,
} from "@/types/recovery.types.js";
import {
  finishOperationalRun,
  startOperationalRun,
} from "@/utils/operational_runs.js";
import { telemetry } from "@/utils/telemetry.js";

function floorToMinute(timestamp: number): number {
  return Math.floor(timestamp / RECOVERY_BUCKET_MS) * RECOVERY_BUCKET_MS;
}

function mergeLiveBarIntoMinute(existing: Bar | undefined, liveBar: Bar): Bar {
  const minuteStart = floorToMinute(liveBar.startTime);
  const minuteEnd = minuteStart + RECOVERY_BUCKET_MS;

  if (!existing) {
    return {
      symbol: liveBar.symbol,
      open: liveBar.open,
      high: liveBar.high,
      low: liveBar.low,
      close: liveBar.close,
      volume: liveBar.volume,
      trades: liveBar.trades,
      dollarVolume: liveBar.dollarVolume,
      startTime: minuteStart,
      endTime: minuteEnd,
    };
  }

  return {
    symbol: liveBar.symbol,
    open: existing.open,
    high: Math.max(existing.high, liveBar.high),
    low: Math.min(existing.low, liveBar.low),
    close: liveBar.close,
    volume: existing.volume + liveBar.volume,
    trades: existing.trades + liveBar.trades,
    dollarVolume: (existing.dollarVolume ?? 0) + (liveBar.dollarVolume ?? 0),
    startTime: minuteStart,
    endTime: minuteEnd,
  };
}

export class RecoveryService {
  private readonly liveMinuteBars = new Map<string, Bar>();

  constructor(
    private readonly store: RecoveryStore = recoveryStore,
    private readonly redis = redisStore,
  ) {}

  async init(): Promise<void> {
    await this.store.init();
  }

  async persistLiveBar(bar: Bar): Promise<void> {
    const aggregatedBar = mergeLiveBarIntoMinute(
      this.liveMinuteBars.get(bar.symbol),
      bar,
    );
    this.liveMinuteBars.set(bar.symbol, aggregatedBar);

    await this.store.upsertBars(bar.symbol, RECOVERY_TIMEFRAME, [aggregatedBar]);
    await this.redis.setRecoveryCheckpoint({
      symbol: bar.symbol,
      timeframe: RECOVERY_TIMEFRAME,
      lastSeenBarTs: bar.startTime,
      updatedAt: Date.now(),
      source: "live",
    });
  }

  planRehydrateWindow(
    checkpoint: RecoveryCheckpoint | null,
    nowMs = Date.now(),
  ): RecoveryWindow {
    const baselineStart = Math.max(nowMs - RECOVERY_RETENTION_MS, 0);
    const checkpointStart =
      checkpoint !== null
        ? Math.max(checkpoint.lastSeenBarTs - RECOVERY_OVERLAP_MS, baselineStart)
        : baselineStart;

    return {
      startMs: checkpointStart,
      endMs: nowMs,
    };
  }

  planProviderRecoveryWindow({
    checkpoint,
    disconnectedAt,
    nowMs = Date.now(),
    endMs = nowMs,
    excludeCurrentMinute = false,
  }: {
    checkpoint: RecoveryCheckpoint | null;
    disconnectedAt?: number | null;
    nowMs?: number;
    endMs?: number;
    excludeCurrentMinute?: boolean;
  }): RecoveryWindow | null {
    const baselineStart = Math.max(nowMs - RECOVERY_RETENTION_MS, 0);
    const seedTimestamp =
      checkpoint?.lastSeenBarTs ?? disconnectedAt ?? baselineStart;
    const startMs = Math.max(seedTimestamp - RECOVERY_OVERLAP_MS, baselineStart);

    let resolvedEndMs = Math.min(endMs, nowMs);
    if (excludeCurrentMinute) {
      resolvedEndMs = Math.min(resolvedEndMs, floorToMinute(nowMs) - 1);
    }

    if (resolvedEndMs < startMs) {
      return null;
    }

    return {
      startMs,
      endMs: resolvedEndMs,
    };
  }

  async hydrateRedisFromRecoveryStore(symbols: string[]): Promise<{
    hydratedSymbols: number;
    barsLoaded: number;
  }> {
    const nowMs = Date.now();
    let hydratedSymbols = 0;
    let barsLoaded = 0;

    for (const symbol of new Set(symbols)) {
      const checkpoint = await this.redis.getRecoveryCheckpoint(
        symbol,
        RECOVERY_TIMEFRAME,
      );
      const { startMs, endMs } = this.planRehydrateWindow(checkpoint, nowMs);
      const bars = await this.store.getBars(
        symbol,
        RECOVERY_TIMEFRAME,
        startMs,
        endMs,
      );

      if (bars.length === 0) {
        continue;
      }

      await this.redis.writeBarsForRecovery(bars);
      await this.redis.setRecoveryCheckpoint({
        symbol,
        timeframe: RECOVERY_TIMEFRAME,
        lastSeenBarTs: bars[bars.length - 1]?.startTime || endMs,
        updatedAt: Date.now(),
        source: "rehydrate",
      });

      hydratedSymbols++;
      barsLoaded += bars.length;
    }

    return { hydratedSymbols, barsLoaded };
  }

  async backfillSymbolsFromProvider(
    symbols: string[],
    options: {
      source: RecoveryRunSource;
      disconnectedAt?: number | null;
      endMs?: number;
      excludeCurrentMinute?: boolean;
    },
  ): Promise<RecoveryExecutionResult[]> {
    const results: RecoveryExecutionResult[] = [];
    const nowMs = Date.now();
    const uniqueSymbols = Array.from(new Set(symbols));
    const run = await startOperationalRun({
      runType: "recovery",
      name: "provider-backfill",
      trigger: options.source,
      metadata: {
        symbolCount: uniqueSymbols.length,
        disconnectedAt: options.disconnectedAt ?? null,
        endMs: options.endMs ?? nowMs,
        excludeCurrentMinute: options.excludeCurrentMinute ?? false,
      },
    });

    const disabledResults = uniqueSymbols.map((symbol) => ({
      symbol,
      source: options.source,
      startMs: options.endMs ?? nowMs,
      endMs: options.endMs ?? nowMs,
      providerBars: 0,
      checkpointBefore: null,
      checkpointAfter: null,
      error:
        "Provider REST backfill is disabled for futures; historical fill waits for Massive futures flat files.",
    }));

    telemetry.metric({
      name: "swordfish.provider_fetch.run_symbols",
      type: "gauge",
      value: disabledResults.length,
      tags: {
        source: options.source,
        status: "disabled",
      },
    });

    await finishOperationalRun(run, "failed", {
      counts: {
        symbols: disabledResults.length,
        failedSymbols: disabledResults.length,
        providerBars: 0,
      },
      error:
        "Provider REST backfill is disabled for futures; historical fill waits for Massive futures flat files.",
      metadata: {
        disabled: true,
        results: disabledResults,
      },
    });

    return disabledResults;
  }
}

export const recoveryService = new RecoveryService();
