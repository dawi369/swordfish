import { describe, expect, test } from "bun:test";
import {
  buildBarQualityFlags,
  summarizeBarSequenceQuality,
} from "@/services/data_quality.js";
import type { Bar } from "@/types/common.types.js";

function bar(overrides: Partial<Bar> = {}): Bar {
  const close = overrides.close ?? 100;
  return {
    symbol: "ESH9",
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 10,
    trades: 2,
    startTime: 1_800_000_000_000,
    endTime: 1_800_000_060_000,
    ...overrides,
  };
}

describe("data quality", () => {
  test("flags invalid OHLC and volume anomalies", () => {
    expect(buildBarQualityFlags(bar({ high: 98, low: 99 }))).toEqual({
      invalidOhlc: true,
      zeroVolume: false,
      negativeVolume: false,
    });
    expect(buildBarQualityFlags(bar({ open: 102 }))).toEqual({
      invalidOhlc: true,
      zeroVolume: false,
      negativeVolume: false,
    });
    expect(
      buildBarQualityFlags(bar({ open: 100, high: 101, low: 99, close: 98 })),
    ).toEqual({
      invalidOhlc: true,
      zeroVolume: false,
      negativeVolume: false,
    });
    expect(buildBarQualityFlags(bar({ volume: 0 }))).toEqual({
      invalidOhlc: false,
      zeroVolume: true,
      negativeVolume: false,
    });
    expect(buildBarQualityFlags(bar({ volume: -1 }))).toEqual({
      invalidOhlc: false,
      zeroVolume: false,
      negativeVolume: true,
    });
  });

  test("summarizes missing intervals and close-to-close jumps per symbol", () => {
    const start = 1_800_000_000_000;
    const summary = summarizeBarSequenceQuality(
      [
        bar({ symbol: "NQH9", startTime: start, close: 50 }),
        bar({ symbol: "ESH9", startTime: start, close: 100 }),
        bar({
          symbol: "ESH9",
          startTime: start + 60_000,
          close: 160,
          volume: 0,
        }),
        bar({
          symbol: "ESH9",
          startTime: start + 180_000,
          high: 120,
          low: 119,
          close: 118,
          volume: -5,
        }),
        bar({ symbol: "NQH9", startTime: start + 60_000, close: 51 }),
      ],
      {
        gapThresholdMs: 90_000,
        spikeThresholdPct: 0.25,
      },
    );

    expect(summary).toEqual({
      barCount: 5,
      gapCount: 1,
      spikeCount: 2,
      invalidOhlcCount: 1,
      zeroVolumeCount: 1,
      negativeVolumeCount: 1,
      oldestBarTs: start,
      newestBarTs: start + 180_000,
    });
  });
});
