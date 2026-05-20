import { describe, expect, spyOn, test } from "bun:test";
import { hotCacheRebuilder } from "@/services/hot_cache_rebuilder.js";
import { redisStore } from "@/server/data/redis_store.js";
import { timescaleStore } from "@/server/data/timescale_store.js";
import type { Bar } from "@/types/common.types.js";

function bar(symbol: string, startTime: number): Bar {
  return {
    symbol,
    open: 1,
    high: 2,
    low: 1,
    close: 2,
    volume: 10,
    trades: 1,
    startTime,
    endTime: startTime + 60_000,
  };
}

describe("HotCacheRebuilder", () => {
  test("dry-runs latest-window rebuild without writing Redis", async () => {
    spyOn(timescaleStore, "getBars1mRange").mockImplementation(
      async (symbol: string) => (symbol === "ESH9" ? [bar(symbol, 1000)] : []),
    );
    const redisSpy = spyOn(redisStore, "writeBarsForRecovery").mockResolvedValue();

    const result = await hotCacheRebuilder.rebuildLatestWindow(
      ["NQH9", "ESH9", "ESH9"],
      {
        nowMs: 10_000,
        windowMs: 9_000,
        dryRun: true,
      },
    );

    expect(result).toEqual({
      symbols: 2,
      hydratedSymbols: 1,
      barsLoaded: 1,
      skippedSymbols: ["NQH9"],
    });
    expect(redisSpy).not.toHaveBeenCalled();
  });

  test("writes recovered bars into Redis when not a dry run", async () => {
    const bars = [bar("ESH9", 1000)];
    spyOn(timescaleStore, "getBars1mRange").mockResolvedValue(bars);
    const redisSpy = spyOn(redisStore, "writeBarsForRecovery").mockResolvedValue();

    const result = await hotCacheRebuilder.rebuildLatestWindow(["ESH9"], {
      nowMs: 10_000,
      windowMs: 9_000,
    });

    expect(result.barsLoaded).toBe(1);
    expect(redisSpy).toHaveBeenCalledWith(bars);
  });
});
