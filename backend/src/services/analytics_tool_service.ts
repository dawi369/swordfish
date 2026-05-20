import { hotCacheRebuilder } from "@/services/hot_cache_rebuilder.js";
import { marketDataRepository } from "@/services/market_data_repository.js";
import { redisStore } from "@/server/data/redis_store.js";
import { timescaleStore } from "@/server/data/timescale_store.js";
import type { Bar } from "@/types/common.types.js";
import { telemetry } from "@/utils/telemetry.js";

export type ToolCoverageStatus =
  | "ok"
  | "not_subscribed"
  | "subscribed_no_live_data"
  | "provider_no_data"
  | "stale_contract"
  | "backfill_pending";

export interface LatestMarketState {
  timestamp: number;
  symbols: Array<{
    symbol: string;
    latestBar: Bar;
    subscribed: boolean;
    durableLastBarTs: number | null;
    providerStatus: "success" | "empty" | "failed" | null;
  }>;
}

export interface ToolSymbolCoverage {
  symbol: string;
  status: ToolCoverageStatus;
  subscribed: boolean;
  hasLatest: boolean;
  hasDurableBars: boolean;
  latestBarTs: number | null;
  latestAgeMs: number | null;
  durableLastBarTs: number | null;
  providerStatus: "success" | "empty" | "failed" | null;
  reason: string;
  nextAction: string;
}

export interface ToolRangeBarsResult {
  symbol: string;
  tf: string;
  start: number;
  end: number;
  source: "redis" | "timescale" | "empty";
  bars: Bar[];
  count: number;
  quality: {
    gapCount: number;
    spikeCount: number;
    invalidOhlcCount: number;
    zeroVolumeCount: number;
    negativeVolumeCount: number;
    oldestBarTs: number | null;
    newestBarTs: number | null;
    freshness: "fresh" | "stale" | "empty" | "unknown";
  };
}

export interface ProviderBackfillStatus {
  symbol?: string;
  outcomes: Awaited<ReturnType<typeof timescaleStore.getProviderFetchOutcomes>>;
  count: number;
}

function ageMs(timestamp: number | null, now: number): number | null {
  return timestamp ? Math.max(0, now - timestamp) : null;
}

function classifyFreshness(
  newestBarTs: number | null,
  now: number,
): ToolRangeBarsResult["quality"]["freshness"] {
  if (!newestBarTs) return "empty";
  return now - newestBarTs <= 15 * 60 * 1000 ? "fresh" : "stale";
}

function reasonForStatus(status: ToolCoverageStatus): {
  reason: string;
  nextAction: string;
} {
  switch (status) {
    case "ok":
      return {
        reason: "Symbol has usable current coverage.",
        nextAction: "Use latest state or range data normally.",
      };
    case "not_subscribed":
      return {
        reason: "Symbol is not currently in the upstream subscription set.",
        nextAction: "Refresh subscriptions or verify active-contract selection.",
      };
    case "subscribed_no_live_data":
      return {
        reason: "Symbol is subscribed, but no latest live Redis bar is present.",
        nextAction: "Check market session status and Massive websocket delivery.",
      };
    case "provider_no_data":
      return {
        reason: "The latest provider backfill for this symbol returned empty.",
        nextAction: "Verify the contract symbol and provider availability window.",
      };
    case "stale_contract":
      return {
        reason: "Latest Redis data is stale and the symbol is not current enough to trust.",
        nextAction: "Refresh active contracts/front-months before using this symbol.",
      };
    case "backfill_pending":
      return {
        reason: "No durable bars or provider-empty evidence exists yet.",
        nextAction: "Run a dry-run diagnostic or provider backfill before claiming no data.",
      };
  }
}

export class AnalyticsToolService {
  async getLatestMarketState(symbols: string[] = []): Promise<LatestMarketState> {
    const now = Date.now();
    const requested = new Set(symbols);
    const [latestBars, subscribedSymbols, durableStats, providerOutcomes] =
      await Promise.all([
        redisStore.getAllLatestArray(),
        redisStore.getSubscribedSymbols(),
        timescaleStore.getDurableStats(symbols, {
          startMs: 0,
          endMs: now,
        }),
        timescaleStore.getProviderFetchOutcomes({ limit: 500 }),
      ]);

    const subscribed = new Set(subscribedSymbols);
    const durableBySymbol = new Map(
      durableStats.symbols.map((stats) => [stats.symbol, stats]),
    );
    const providerBySymbol = new Map(
      providerOutcomes.map((outcome) => [outcome.symbol, outcome]),
    );
    const filteredBars =
      requested.size > 0
        ? latestBars.filter((bar) => requested.has(bar.symbol))
        : latestBars;

    return {
      timestamp: now,
      symbols: filteredBars.map((bar) => ({
        symbol: bar.symbol,
        latestBar: bar,
        subscribed: subscribed.has(bar.symbol),
        durableLastBarTs: durableBySymbol.get(bar.symbol)?.lastBarTs ?? null,
        providerStatus: providerBySymbol.get(bar.symbol)?.status ?? null,
      })),
    };
  }

  async getSymbolCoverage(symbols: string[] = []): Promise<ToolSymbolCoverage[]> {
    const now = Date.now();
    const [latestBars, subscribedSymbols, durableStats, providerOutcomes] =
      await Promise.all([
        redisStore.getAllLatestArray(),
        redisStore.getSubscribedSymbols(),
        timescaleStore.getDurableStats(symbols, {
          startMs: 0,
          endMs: now,
        }),
        timescaleStore.getProviderFetchOutcomes({ limit: 500 }),
      ]);
    const requested = new Set(symbols);
    const subscribed = new Set(subscribedSymbols);
    const latestBySymbol = new Map(latestBars.map((bar) => [bar.symbol, bar]));
    const durableBySymbol = new Map(
      durableStats.symbols.map((stats) => [stats.symbol, stats]),
    );
    const providerBySymbol = new Map(
      providerOutcomes.map((outcome) => [outcome.symbol, outcome]),
    );
    const allSymbols = Array.from(
      requested.size > 0
        ? requested
        : new Set([
            ...subscribed,
            ...latestBySymbol.keys(),
            ...durableBySymbol.keys(),
            ...providerBySymbol.keys(),
          ]),
    ).sort();

    return allSymbols.map((symbol) => {
      const latest = latestBySymbol.get(symbol);
      const durable = durableBySymbol.get(symbol);
      const provider = providerBySymbol.get(symbol);
      const latestAge = ageMs(latest?.startTime ?? null, now);
      const isSubscribed = subscribed.has(symbol);
      const hasLatest = Boolean(latest);
      const hasDurableBars = Boolean(durable && durable.barCount > 0);
      const staleLatest =
        latestAge !== null && latestAge > 15 * 60 * 1000;

      let status: ToolCoverageStatus = "ok";
      if (!isSubscribed) {
        status = staleLatest ? "stale_contract" : "not_subscribed";
      } else if (!hasLatest && !hasDurableBars) {
        status = provider?.status === "empty" ? "provider_no_data" : "backfill_pending";
      } else if (!hasLatest) {
        status = "subscribed_no_live_data";
      } else if (staleLatest) {
        status = "stale_contract";
      } else if (!hasDurableBars && durableStats.enabled) {
        status = "backfill_pending";
      }

      return {
        symbol,
        status,
        subscribed: isSubscribed,
        hasLatest,
        hasDurableBars,
        latestBarTs: latest?.startTime ?? null,
        latestAgeMs: latestAge,
        durableLastBarTs: durable?.lastBarTs ?? null,
        providerStatus: provider?.status ?? null,
        ...reasonForStatus(status),
      };
    });
  }

  async getRangeBarsWithQuality(
    symbol: string,
    start: number,
    end: number,
    tf = "1m",
  ): Promise<ToolRangeBarsResult> {
    const range = await marketDataRepository.getBarsRange(symbol, start, end, tf);
    let quality = range.quality;

    try {
      const durableQuality = await timescaleStore.getDurableQualitySummary(symbol, start, end, {
        recordSummary: true,
        metadata: {
          caller: "analytics_tool_service",
          tf,
        },
      });
      quality = {
        gapCount: durableQuality.gapCount,
        spikeCount: durableQuality.spikeCount,
        invalidOhlcCount: durableQuality.invalidOhlcCount,
        zeroVolumeCount: durableQuality.zeroVolumeCount,
        negativeVolumeCount: durableQuality.negativeVolumeCount,
        oldestBarTs: durableQuality.oldestBarTs,
        newestBarTs: durableQuality.newestBarTs,
        freshness: classifyFreshness(durableQuality.newestBarTs, Date.now()),
      };
    } catch (error) {
      telemetry.metric({
        name: "mk3.tool.range_quality_record_failure",
        type: "counter",
        value: 1,
        tags: {
          symbol,
          tf,
        },
      });
    }

    return {
      ...range,
      count: range.bars.length,
      quality,
    };
  }

  async getProviderBackfillStatus(
    options: {
      symbol?: string;
      status?: "success" | "empty" | "failed";
      limit?: number;
    } = {},
  ): Promise<ProviderBackfillStatus> {
    const outcomes = await timescaleStore.getProviderFetchOutcomes(options);
    return {
      symbol: options.symbol,
      outcomes,
      count: outcomes.length,
    };
  }

  async runSafeDryRunDiagnostics(symbols: string[]): Promise<{
    hotCacheRebuild: Awaited<ReturnType<typeof hotCacheRebuilder.rebuildLatestWindow>>;
  }> {
    return {
      hotCacheRebuild: await hotCacheRebuilder.rebuildLatestWindow(symbols, {
        dryRun: true,
      }),
    };
  }

  async explainSymbolState(symbol: string): Promise<ToolSymbolCoverage> {
    const [coverage] = await this.getSymbolCoverage([symbol]);
    if (!coverage) {
      return {
        symbol,
        status: "backfill_pending",
        subscribed: false,
        hasLatest: false,
        hasDurableBars: false,
        latestBarTs: null,
        latestAgeMs: null,
        durableLastBarTs: null,
        providerStatus: null,
        ...reasonForStatus("backfill_pending"),
      };
    }
    return coverage;
  }
}

export const analyticsToolService = new AnalyticsToolService();
