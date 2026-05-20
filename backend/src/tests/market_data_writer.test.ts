import { describe, expect, spyOn, test } from "bun:test";
import { durableBarWriter } from "@/services/durable_bar_writer.js";
import { marketDataWriter } from "@/services/market_data_writer.js";
import { recoveryService } from "@/services/recovery_service.js";
import { redisStore } from "@/server/data/redis_store.js";
import { timescaleStore } from "@/server/data/timescale_store.js";
import type { Bar } from "@/types/common.types.js";

function bar(): Bar {
  return {
    symbol: "ESH9",
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    volume: 100,
    trades: 5,
    startTime: 1_800_000_000_000,
    endTime: 1_800_000_060_000,
  };
}

describe("MarketDataWriter", () => {
  test("writes live bars to redis, recovery, and durable storage", async () => {
    const redisSpy = spyOn(redisStore, "writeBar").mockResolvedValue();
    const recoverySpy = spyOn(recoveryService, "persistLiveBar").mockResolvedValue();
    const durableSpy = spyOn(timescaleStore, "upsertBar1m").mockResolvedValue(1);

    const result = await marketDataWriter.writeLiveBar(bar());

    expect(redisSpy).toHaveBeenCalledTimes(1);
    expect(recoverySpy).toHaveBeenCalledTimes(1);
    expect(durableSpy).toHaveBeenCalledWith(expect.objectContaining({ symbol: "ESH9" }), "live_ws");
    expect(result).toEqual({
      redis: "ok",
      recovery: "ok",
      durable: "ok",
      errors: {},
    });
  });

  test("reports partial failures without throwing", async () => {
    spyOn(redisStore, "writeBar").mockRejectedValue(new Error("redis down"));
    spyOn(recoveryService, "persistLiveBar").mockResolvedValue();
    spyOn(timescaleStore, "upsertBar1m").mockResolvedValue(0);

    const result = await marketDataWriter.writeLiveBar(bar());

    expect(result.redis).toBe("failed");
    expect(result.recovery).toBe("ok");
    expect(result.durable).toBe("disabled");
    expect(result.errors.redis).toBe("redis down");
  });

  test("delegates historical bars to the durable ingestion boundary", async () => {
    const durableSpy = spyOn(durableBarWriter, "writeDurableBars").mockResolvedValue({
      source: "flat_file",
      bars: 2,
      durable: "ok",
    });

    const result = await marketDataWriter.writeDurableBars(
      [bar(), { ...bar(), startTime: 1_800_000_060_000 }],
      "flat_file",
    );

    expect(durableSpy).toHaveBeenCalledWith(expect.any(Array), "flat_file");
    expect(result).toEqual({
      source: "flat_file",
      bars: 2,
      durable: "ok",
    });
  });
});
