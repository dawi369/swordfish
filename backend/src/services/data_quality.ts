import type { Bar } from "@/types/common.types.js";

export interface BarQualityFlags {
  invalidOhlc: boolean;
  zeroVolume: boolean;
  negativeVolume: boolean;
}

export interface BarSequenceQualitySummary {
  barCount: number;
  gapCount: number;
  spikeCount: number;
  invalidOhlcCount: number;
  zeroVolumeCount: number;
  negativeVolumeCount: number;
  oldestBarTs: number | null;
  newestBarTs: number | null;
}

export function buildBarQualityFlags(bar: Bar): BarQualityFlags {
  return {
    invalidOhlc:
      bar.high < bar.low ||
      bar.open < bar.low ||
      bar.open > bar.high ||
      bar.close < bar.low ||
      bar.close > bar.high,
    zeroVolume: bar.volume === 0,
    negativeVolume: bar.volume < 0,
  };
}

export function summarizeBarSequenceQuality(
  bars: Bar[],
  options: {
    gapThresholdMs: number;
    spikeThresholdPct: number;
  },
): BarSequenceQualitySummary {
  const orderedBars = [...bars].sort((left, right) => {
    if (left.symbol !== right.symbol) {
      return left.symbol.localeCompare(right.symbol);
    }
    return left.startTime - right.startTime;
  });

  let gapCount = 0;
  let spikeCount = 0;
  let invalidOhlcCount = 0;
  let zeroVolumeCount = 0;
  let negativeVolumeCount = 0;
  let oldestBarTs: number | null = null;
  let newestBarTs: number | null = null;
  let previousBar: Bar | null = null;

  for (const bar of orderedBars) {
    const flags = buildBarQualityFlags(bar);
    if (flags.invalidOhlc) invalidOhlcCount += 1;
    if (flags.zeroVolume) zeroVolumeCount += 1;
    if (flags.negativeVolume) negativeVolumeCount += 1;

    oldestBarTs =
      oldestBarTs === null ? bar.startTime : Math.min(oldestBarTs, bar.startTime);
    newestBarTs =
      newestBarTs === null ? bar.startTime : Math.max(newestBarTs, bar.startTime);

    if (previousBar?.symbol === bar.symbol) {
      const gapMs = bar.startTime - previousBar.startTime;
      if (gapMs > options.gapThresholdMs) {
        gapCount += 1;
      }

      if (
        previousBar.close !== 0 &&
        Math.abs((bar.close - previousBar.close) / previousBar.close) >
          options.spikeThresholdPct
      ) {
        spikeCount += 1;
      }
    }

    previousBar = bar;
  }

  return {
    barCount: orderedBars.length,
    gapCount,
    spikeCount,
    invalidOhlcCount,
    zeroVolumeCount,
    negativeVolumeCount,
    oldestBarTs,
    newestBarTs,
  };
}
