import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { analyticsToolService } from "@/services/analytics_tool_service.js";
import { hotCacheRebuilder } from "@/services/hot_cache_rebuilder.js";
import { marketDataRepository } from "@/services/market_data_repository.js";
import { redisStore } from "@/server/data/redis_store.js";
import { timescaleStore } from "@/server/data/timescale_store.js";
import type { Bar } from "@/types/common.types.js";
import { telemetry } from "@/utils/telemetry.js";

function bar(symbol: string, startTime: number): Bar {
  return {
    symbol,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 100,
    trades: 10,
    startTime,
    endTime: startTime + 60_000,
  };
}

describe("AnalyticsToolService", () => {
  afterEach(() => {
    mock.restore();
  });

  test("returns latest market state without exposing raw stores", async () => {
    const latest = bar("ESH6", Date.now());

    spyOn(redisStore, "getAllLatestArray").mockResolvedValue([latest]);
    spyOn(redisStore, "getSubscribedSymbols").mockResolvedValue(["ESH6"]);
    spyOn(timescaleStore, "getDurableStats").mockResolvedValue({
      enabled: true,
      connected: true,
      timescaleAvailable: false,
      bars1m: {
        symbolCount: 1,
        barCount: 10,
        oldestBarTs: 1,
        newestBarTs: latest.startTime,
      },
      symbols: [
        {
          symbol: "ESH6",
          barCount: 10,
          firstBarTs: 1,
          lastBarTs: latest.startTime,
          gapCount: 0,
          spikeCount: 0,
        },
      ],
    });
    spyOn(timescaleStore, "getProviderFetchOutcomes").mockResolvedValue([]);

    const state = await analyticsToolService.getLatestMarketState(["ESH6"]);

    expect(state.symbols).toHaveLength(1);
    expect(state.symbols[0]?.symbol).toBe("ESH6");
    expect(state.symbols[0]?.subscribed).toBe(true);
    expect(state.symbols[0]?.durableLastBarTs).toBe(latest.startTime);
  });

  test("explains missing symbol states with deterministic next actions", async () => {
    spyOn(redisStore, "getAllLatestArray").mockResolvedValue([]);
    spyOn(redisStore, "getSubscribedSymbols").mockResolvedValue(["ESH6"]);
    spyOn(timescaleStore, "getDurableStats").mockResolvedValue({
      enabled: true,
      connected: true,
      timescaleAvailable: false,
      bars1m: {
        symbolCount: 0,
        barCount: 0,
        oldestBarTs: null,
        newestBarTs: null,
      },
      symbols: [],
    });
    spyOn(timescaleStore, "getProviderFetchOutcomes").mockResolvedValue([
      {
        outcomeId: "provider:ESH6:1",
        provider: "massive",
        source: "provider_rest",
        symbol: "ESH6",
        timeframe: "1m",
        status: "empty",
        startMs: 1,
        endMs: 2,
        barCount: 0,
        error: null,
        metadata: {},
        createdAt: 3,
      },
    ]);

    const explanation = await analyticsToolService.explainSymbolState("ESH6");

    expect(explanation.status).toBe("provider_no_data");
    expect(explanation.reason).toContain("provider backfill");
    expect(explanation.nextAction).toContain("contract symbol");
  });

  test("returns range bars with quality metadata", async () => {
    spyOn(marketDataRepository, "getBarsRange").mockResolvedValue({
      symbol: "ESH6",
      tf: "1m",
      start: 1,
      end: 2,
      source: "timescale",
      bars: [bar("ESH6", 1)],
      quality: {
        gapCount: 2,
        spikeCount: 1,
        invalidOhlcCount: 1,
        zeroVolumeCount: 0,
        negativeVolumeCount: 0,
        oldestBarTs: 1,
        newestBarTs: 2,
        freshness: "stale",
      },
    });
    spyOn(timescaleStore, "getDurableQualitySummary").mockResolvedValue({
      symbol: "ESH6",
      startMs: 1,
      endMs: 2,
      barCount: 1,
      gapCount: 2,
      spikeCount: 1,
      invalidOhlcCount: 1,
      zeroVolumeCount: 0,
      negativeVolumeCount: 0,
      oldestBarTs: 1,
      newestBarTs: 2,
    });

    const result = await analyticsToolService.getRangeBarsWithQuality(
      "ESH6",
      1,
      2,
      "1m",
    );

    expect(result.source).toBe("timescale");
    expect(result.count).toBe(1);
    expect(result.quality.gapCount).toBe(2);
    expect(result.quality.invalidOhlcCount).toBe(1);
  });

  test("keeps tool range reads usable when durable quality recording fails", async () => {
    spyOn(marketDataRepository, "getBarsRange").mockResolvedValue({
      symbol: "ESH6",
      tf: "1m",
      start: 1,
      end: 2,
      source: "redis",
      bars: [bar("ESH6", 1)],
      quality: {
        gapCount: 1,
        spikeCount: 0,
        invalidOhlcCount: 0,
        zeroVolumeCount: 0,
        negativeVolumeCount: 0,
        oldestBarTs: 1,
        newestBarTs: 2,
        freshness: "fresh",
      },
    });
    spyOn(timescaleStore, "getDurableQualitySummary").mockRejectedValue(
      new Error("durable quality down"),
    );
    const metricSpy = spyOn(telemetry, "metric").mockImplementation(() => {});

    const result = await analyticsToolService.getRangeBarsWithQuality(
      "ESH6",
      1,
      2,
      "1m",
    );

    expect(result.source).toBe("redis");
    expect(result.count).toBe(1);
    expect(result.quality.freshness).toBe("fresh");
    expect(metricSpy.mock.calls.some((call) => call[0].name === "mk3.tool.range_quality_record_failure")).toBe(true);
  });

  test("runs only dry-run diagnostics for tool callers", async () => {
    const rebuildSpy = spyOn(
      hotCacheRebuilder,
      "rebuildLatestWindow",
    ).mockResolvedValue({
      symbols: 1,
      hydratedSymbols: 1,
      barsLoaded: 10,
      skippedSymbols: [],
    });

    const diagnostics = await analyticsToolService.runSafeDryRunDiagnostics(["ESH6"]);

    expect(rebuildSpy).toHaveBeenCalledWith(["ESH6"], { dryRun: true });
    expect(diagnostics.hotCacheRebuild.barsLoaded).toBe(10);
  });
});
