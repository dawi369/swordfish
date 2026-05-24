import {
  DATA_QUALITY_GAP_THRESHOLD_MS,
  DATA_QUALITY_SPIKE_THRESHOLD_PCT,
} from "@/config/env.js";
import { redisStore } from "@/server/data/redis_store.js";
import { timescaleStore } from "@/server/data/timescale_store.js";
import { summarizeBarSequenceQuality } from "@/services/data_quality.js";
import type { Bar } from "@/types/common.types.js";
import { telemetry } from "@/utils/telemetry.js";

export type MarketDataRangeSource = "redis" | "timescale" | "empty";
export type MarketDataFreshness = "fresh" | "stale" | "empty" | "unknown";

export interface MarketDataRangeQuality {
  gapCount: number;
  spikeCount: number;
  invalidOhlcCount: number;
  zeroVolumeCount: number;
  negativeVolumeCount: number;
  oldestBarTs: number | null;
  newestBarTs: number | null;
  freshness: MarketDataFreshness;
}

export interface MarketDataRangeResult {
  symbol: string;
  tf: string;
  start: number;
  end: number;
  source: MarketDataRangeSource;
  bars: Bar[];
  quality: MarketDataRangeQuality;
}

export class MarketDataRepository {
  async getBarsRange(
    symbol: string,
    start: number,
    end: number,
    tf: string,
  ): Promise<MarketDataRangeResult> {
    const redisBars = await redisStore.getBarsRange(symbol, start, end, tf as any);
    if (redisBars.length > 0) {
      return {
        symbol,
        tf,
        start,
        end,
        source: "redis",
        bars: redisBars,
        quality: await this.getQualityMetadata(symbol, start, end, tf, redisBars),
      };
    }

    if (tf !== "1m") {
      return {
        symbol,
        tf,
        start,
        end,
        source: "empty",
        bars: [],
        quality: this.emptyQuality("unknown"),
      };
    }

    let durableBars: Bar[] = [];
    try {
      durableBars = await timescaleStore.getBars1mRange(symbol, start, end);
    } catch (error) {
      telemetry.metric({
        name: "swordfish.market_data.durable_range_failure",
        type: "counter",
        value: 1,
        tags: {
          symbol,
          tf,
        },
      });
      return {
        symbol,
        tf,
        start,
        end,
        source: "empty",
        bars: [],
        quality: this.emptyQuality("unknown"),
      };
    }

    return {
      symbol,
      tf,
      start,
      end,
      source: durableBars.length > 0 ? "timescale" : "empty",
      bars: durableBars,
      quality: await this.getQualityMetadata(symbol, start, end, tf, durableBars),
    };
  }

  private async getQualityMetadata(
    symbol: string,
    start: number,
    end: number,
    tf: string,
    bars: Bar[],
  ): Promise<MarketDataRangeQuality> {
    if (tf !== "1m") {
      const oldestBarTs = bars[0]?.startTime ?? null;
      const newestBarTs = bars[bars.length - 1]?.startTime ?? null;
      return {
        ...this.emptyQuality(
          bars.length > 0 ? this.classifyFreshness(newestBarTs) : "empty",
        ),
        oldestBarTs,
        newestBarTs,
      };
    }

    let quality;
    try {
      quality = await timescaleStore.getDurableQualitySummary(symbol, start, end);
    } catch (error) {
      telemetry.metric({
        name: "swordfish.market_data.durable_quality_failure",
        type: "counter",
        value: 1,
        tags: {
          symbol,
          tf,
        },
      });
      const fallback = summarizeBarSequenceQuality(bars, {
        gapThresholdMs: DATA_QUALITY_GAP_THRESHOLD_MS,
        spikeThresholdPct: DATA_QUALITY_SPIKE_THRESHOLD_PCT,
      });
      return {
        gapCount: fallback.gapCount,
        spikeCount: fallback.spikeCount,
        invalidOhlcCount: fallback.invalidOhlcCount,
        zeroVolumeCount: fallback.zeroVolumeCount,
        negativeVolumeCount: fallback.negativeVolumeCount,
        oldestBarTs: fallback.oldestBarTs,
        newestBarTs: fallback.newestBarTs,
        freshness: this.classifyFreshness(fallback.newestBarTs),
      };
    }

    return {
      gapCount: quality.gapCount,
      spikeCount: quality.spikeCount,
      invalidOhlcCount: quality.invalidOhlcCount,
      zeroVolumeCount: quality.zeroVolumeCount,
      negativeVolumeCount: quality.negativeVolumeCount,
      oldestBarTs: quality.oldestBarTs ?? bars[0]?.startTime ?? null,
      newestBarTs: quality.newestBarTs ?? bars[bars.length - 1]?.startTime ?? null,
      freshness: this.classifyFreshness(
        quality.newestBarTs ?? bars[bars.length - 1]?.startTime ?? null,
      ),
    };
  }

  private emptyQuality(freshness: MarketDataFreshness): MarketDataRangeQuality {
    return {
      gapCount: 0,
      spikeCount: 0,
      invalidOhlcCount: 0,
      zeroVolumeCount: 0,
      negativeVolumeCount: 0,
      oldestBarTs: null,
      newestBarTs: null,
      freshness,
    };
  }

  private classifyFreshness(newestBarTs: number | null): MarketDataFreshness {
    if (!newestBarTs) return "empty";
    return Date.now() - newestBarTs <= 15 * 60 * 1000 ? "fresh" : "stale";
  }
}

export const marketDataRepository = new MarketDataRepository();
