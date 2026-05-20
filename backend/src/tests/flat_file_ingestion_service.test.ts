import { describe, expect, spyOn, test } from "bun:test";
import { durableBarWriter } from "@/services/durable_bar_writer.js";
import { flatFileIngestionService } from "@/services/flat_file_ingestion_service.js";
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

describe("FlatFileIngestionService", () => {
  test("routes flat-file bars through the durable ingestion boundary", async () => {
    const durableSpy = spyOn(durableBarWriter, "writeDurableBars").mockResolvedValue({
      source: "flat_file",
      bars: 1,
      durable: "ok",
    });

    const result = await flatFileIngestionService.ingestBars({
      bars: [bar()],
      metadata: {
        fileName: "massive-futures-2026-03-25.csv.gz",
        provider: "massive",
        dataset: "futures-1m",
      },
    });

    expect(durableSpy).toHaveBeenCalledWith([expect.objectContaining({ symbol: "ESH9" })], "flat_file");
    expect(result).toEqual({
      source: "flat_file",
      bars: 1,
      durable: "ok",
      metadata: {
        fileName: "massive-futures-2026-03-25.csv.gz",
        provider: "massive",
        dataset: "futures-1m",
      },
    });
  });
});
