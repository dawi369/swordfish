import { describe, expect, spyOn, test } from "bun:test";
import { marketDataRepository } from "@/services/market_data_repository.js";
import { redisStore } from "@/server/data/redis_store.js";
import { timescaleStore } from "@/server/data/timescale_store.js";
import type { Bar } from "@/types/common.types.js";
import { telemetry } from "@/utils/telemetry.js";

function bar(symbol: string): Bar {
  return {
    symbol,
    open: 1,
    high: 2,
    low: 1,
    close: 2,
    volume: 10,
    trades: 1,
    startTime: 1000,
    endTime: 61_000,
  };
}

describe("MarketDataRepository", () => {
  test("returns Redis bars first", async () => {
    spyOn(redisStore, "getBarsRange").mockResolvedValue([bar("ESH9")]);
    const timescaleSpy = spyOn(timescaleStore, "getBars1mRange").mockResolvedValue([]);
    spyOn(timescaleStore, "getDurableQualitySummary").mockResolvedValue({
      symbol: "ESH9",
      startMs: 0,
      endMs: 100_000,
      barCount: 1,
      gapCount: 0,
      spikeCount: 0,
      invalidOhlcCount: 0,
      zeroVolumeCount: 0,
      negativeVolumeCount: 0,
      oldestBarTs: 1000,
      newestBarTs: 1000,
    });

    const result = await marketDataRepository.getBarsRange("ESH9", 0, 100_000, "1m");

    expect(result.source).toBe("redis");
    expect(result.bars).toHaveLength(1);
    expect(result.quality.oldestBarTs).toBe(1000);
    expect(timescaleSpy).not.toHaveBeenCalled();
  });

  test("falls back to Timescale for empty 1m Redis ranges", async () => {
    spyOn(redisStore, "getBarsRange").mockResolvedValue([]);
    spyOn(timescaleStore, "getBars1mRange").mockResolvedValue([bar("ESH9")]);
    spyOn(timescaleStore, "getDurableQualitySummary").mockResolvedValue({
      symbol: "ESH9",
      startMs: 0,
      endMs: 100_000,
      barCount: 1,
      gapCount: 2,
      spikeCount: 1,
      invalidOhlcCount: 0,
      zeroVolumeCount: 0,
      negativeVolumeCount: 0,
      oldestBarTs: 1000,
      newestBarTs: 1000,
    });

    const result = await marketDataRepository.getBarsRange("ESH9", 0, 100_000, "1m");

    expect(result.source).toBe("timescale");
    expect(result.bars).toHaveLength(1);
    expect(result.quality.gapCount).toBe(2);
    expect(result.quality.spikeCount).toBe(1);
  });

  test("keeps Redis ranges serving when durable quality is unavailable", async () => {
    spyOn(redisStore, "getBarsRange").mockResolvedValue([
      bar("ESH9"),
      {
        ...bar("ESH9"),
        close: 4,
        high: 5,
        low: 3,
        startTime: 181_000,
        endTime: 241_000,
      },
    ]);
    spyOn(timescaleStore, "getDurableQualitySummary").mockRejectedValue(
      new Error("durable quality down"),
    );
    const metricSpy = spyOn(telemetry, "metric").mockImplementation(() => {});

    const result = await marketDataRepository.getBarsRange("ESH9", 0, 200_000, "1m");

    expect(result.source).toBe("redis");
    expect(result.bars).toHaveLength(2);
    expect(result.quality.gapCount).toBe(1);
    expect(result.quality.spikeCount).toBe(1);
    expect(metricSpy.mock.calls.some((call) => call[0].name === "mk3.market_data.durable_quality_failure")).toBe(true);
  });

  test("returns an empty range instead of throwing when durable fallback is unavailable", async () => {
    spyOn(redisStore, "getBarsRange").mockResolvedValue([]);
    spyOn(timescaleStore, "getBars1mRange").mockRejectedValue(
      new Error("durable range down"),
    );
    const metricSpy = spyOn(telemetry, "metric").mockImplementation(() => {});

    const result = await marketDataRepository.getBarsRange("ESH9", 0, 100_000, "1m");

    expect(result.source).toBe("empty");
    expect(result.bars).toEqual([]);
    expect(result.quality.freshness).toBe("unknown");
    expect(metricSpy.mock.calls.some((call) => call[0].name === "mk3.market_data.durable_range_failure")).toBe(true);
  });

  test("does not use Timescale for non-1m ranges", async () => {
    spyOn(redisStore, "getBarsRange").mockResolvedValue([]);
    const timescaleSpy = spyOn(timescaleStore, "getBars1mRange").mockResolvedValue([]);

    const result = await marketDataRepository.getBarsRange("ESH9", 0, 100_000, "5m");

    expect(result.source).toBe("empty");
    expect(result.quality.freshness).toBe("unknown");
    expect(timescaleSpy).not.toHaveBeenCalled();
  });
});
