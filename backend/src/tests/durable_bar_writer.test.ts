import { describe, expect, spyOn, test } from "bun:test";
import { durableBarWriter } from "@/services/durable_bar_writer.js";
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

describe("DurableBarWriter", () => {
  test("writes historical bars through the durable ingestion boundary", async () => {
    const durableSpy = spyOn(timescaleStore, "upsertBars1m").mockResolvedValue(2);
    const runSpy = spyOn(timescaleStore, "recordIngestionRun").mockResolvedValue(true);

    const result = await durableBarWriter.writeDurableBars(
      [bar(), { ...bar(), startTime: 1_800_000_060_000 }],
      "flat_file",
    );

    expect(durableSpy).toHaveBeenCalledWith(expect.any(Array), "flat_file");
    expect(runSpy.mock.calls.map((call) => call[0].status)).toEqual([
      "started",
      "success",
    ]);
    expect(runSpy.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        source: "flat_file",
        symbolCount: 1,
        barCount: 2,
      }),
    );
    expect(result).toEqual({
      source: "flat_file",
      bars: 2,
      durable: "ok",
    });
  });

  test("reports durable historical write failures without throwing", async () => {
    spyOn(timescaleStore, "upsertBars1m").mockRejectedValue(new Error("db down"));
    const runSpy = spyOn(timescaleStore, "recordIngestionRun").mockResolvedValue(true);

    const result = await durableBarWriter.writeDurableBars([bar()], "provider_rest");

    expect(runSpy.mock.calls.map((call) => call[0].status)).toEqual([
      "started",
      "failed",
    ]);
    expect(runSpy.mock.calls[1]?.[0].error).toBe("db down");
    expect(result).toEqual({
      source: "provider_rest",
      bars: 0,
      durable: "failed",
      error: "db down",
    });
  });
});
