import { redisStore } from "@/server/data/redis_store.js";
import { timescaleStore } from "@/server/data/timescale_store.js";

const DEFAULT_HOT_CACHE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface HotCacheRebuildResult {
  symbols: number;
  hydratedSymbols: number;
  barsLoaded: number;
  skippedSymbols: string[];
}

export class HotCacheRebuilder {
  async rebuildLatestWindow(
    symbols: string[],
    options: {
      nowMs?: number;
      windowMs?: number;
      dryRun?: boolean;
    } = {},
  ): Promise<HotCacheRebuildResult> {
    const nowMs = options.nowMs ?? Date.now();
    const windowMs = options.windowMs ?? DEFAULT_HOT_CACHE_WINDOW_MS;
    const startMs = Math.max(0, nowMs - windowMs);
    const uniqueSymbols = Array.from(new Set(symbols)).sort();
    const skippedSymbols: string[] = [];
    let hydratedSymbols = 0;
    let barsLoaded = 0;

    for (const symbol of uniqueSymbols) {
      const bars = await timescaleStore.getBars1mRange(symbol, startMs, nowMs);
      if (bars.length === 0) {
        skippedSymbols.push(symbol);
        continue;
      }

      if (!options.dryRun) {
        await redisStore.writeBarsForRecovery(bars);
      }

      hydratedSymbols++;
      barsLoaded += bars.length;
    }

    return {
      symbols: uniqueSymbols.length,
      hydratedSymbols,
      barsLoaded,
      skippedSymbols,
    };
  }
}

export const hotCacheRebuilder = new HotCacheRebuilder();
