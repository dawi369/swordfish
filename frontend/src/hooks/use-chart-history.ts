import { useEffect, useMemo, useRef, useState } from "react";
import { NEXT_PUBLIC_HUB_URL } from "@/config/env";
import type { Bar } from "@/types/common.types";
import type { Timeframe, TickerMode } from "@/types/ticker.types";
import { useTickerStore } from "@/store/use-ticker-store";
import { resampleBars } from "@/lib/bar-resample";
import { fetchHubBarsRange } from "@/lib/hub/history";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const TIMEFRAME_MS: Record<Timeframe, number> = {
  "15s": 15000,
  "30s": 30000,
  "1m": 60000,
  "5m": 300000,
  "15m": 900000,
  "30m": 1800000,
  "1h": 3600000,
  "2h": 7200000,
  "4h": 14400000,
  "1d": 86400000,
};

const HISTORY_WINDOWS_MS: Record<Timeframe, number> = {
  "15s": 3 * 24 * 60 * 60 * 1000,
  "30s": 3 * 24 * 60 * 60 * 1000,
  "1m": ONE_WEEK_MS,
  "5m": ONE_WEEK_MS,
  "15m": ONE_WEEK_MS,
  "30m": ONE_WEEK_MS,
  "1h": ONE_WEEK_MS,
  "2h": ONE_WEEK_MS,
  "4h": ONE_WEEK_MS,
  "1d": ONE_WEEK_MS,
};

const MAX_SERIES_POINTS = 200_000;
const MIN_VISIBLE_BARS = 100;

function normalizeTimestampMs(value: number): number {
  if (!Number.isFinite(value)) return value;
  return value < 1e12 ? value * 1000 : value;
}

function buildRange(
  timeframe: Timeframe,
  override?: { start: number; end: number } | null,
  windowMsOverride?: number,
): { start: number; end: number } {
  if (override) {
    return { start: override.start, end: override.end };
  }
  const end = Date.now();
  const windowMs = windowMsOverride ?? HISTORY_WINDOWS_MS[timeframe] ?? ONE_WEEK_MS;
  const start = end - windowMs;
  return { start, end };
}

function excludeLiveBucketFromRange(
  range: { start: number; end: number },
  bucketMs: number,
): { start: number; end: number } {
  const now = Date.now();
  const liveBucketStart = Math.floor(now / bucketMs) * bucketMs;
  if (range.end < liveBucketStart) {
    return range;
  }

  return {
    start: range.start,
    end: liveBucketStart - 1,
  };
}

function normalizeBars(bars: Bar[], maxPoints: number): Bar[] {
  if (!bars || bars.length === 0) return [];
  const normalized = bars
    .map((bar) => ({
      ...bar,
      startTime: normalizeTimestampMs(bar.startTime),
      endTime: normalizeTimestampMs(bar.endTime),
    }))
    .sort((a, b) => a.startTime - b.startTime);

  if (normalized.length > maxPoints) {
    return normalized.slice(normalized.length - maxPoints);
  }
  return normalized;
}

type HistoryTimeframe = Timeframe | "1s";

const FALLBACK_TIMEFRAME: Partial<Record<Timeframe, HistoryTimeframe>> = {
  "15s": "1s",
  "30s": "15s",
  "5m": "1m",
  "15m": "1m",
  "30m": "1m",
  "1h": "1m",
  "2h": "1h",
  "4h": "1m",
  "1d": "1m",
};

function shouldFallback(count: number, expected: number): boolean {
  if (expected < 20) return false;
  const minBars = Math.max(5, Math.floor(expected * 0.2));
  return count < minBars;
}

interface UseChartHistoryOptions {
  symbols: string[];
  timeframe: Timeframe;
  enabled: boolean;
  mode: TickerMode;
  rangeOverride?: { start: number; end: number } | null;
}

export function useChartHistory({
  symbols,
  timeframe,
  enabled,
  mode,
  rangeOverride = null,
}: UseChartHistoryOptions) {
  // ── Stable key computation ──────────────────────────────────────────────
  // Build deterministic keys from primitive values to avoid render loops

  const symbolKey = useMemo(() => {
    const list = Array.from(new Set(symbols.filter(Boolean)));
    return list.sort().join("|");
  }, [symbols]);

  const uniqueSymbols = useMemo(() => {
    if (!symbolKey) return [];
    return symbolKey.split("|").filter(Boolean);
  }, [symbolKey]);

  const bucketMs = TIMEFRAME_MS[timeframe];
  const baseWindowMs = HISTORY_WINDOWS_MS[timeframe] ?? ONE_WEEK_MS;
  const minWindowMs = MIN_VISIBLE_BARS * bucketMs;
  const windowMs = rangeOverride
    ? rangeOverride.end - rangeOverride.start
    : Math.max(baseWindowMs, minWindowMs);
  const maxPoints = useMemo(
    () => Math.min(MAX_SERIES_POINTS, Math.ceil(windowMs / bucketMs) + 2),
    [windowMs, bucketMs],
  );

  const [seriesBySymbol, setSeriesBySymbol] = useState<Record<string, Bar[]>>({});
  const [isReady, setIsReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const lastSeenRef = useRef<Map<string, string>>(new Map());

  const deferReadyState = (nextReady: boolean) => {
    window.setTimeout(() => {
      setIsReady(nextReady);
    }, 0);
  };

  // Stable primitive keys for effects
  const rangeKey = useMemo(() => {
    if (!rangeOverride) return "default";
    return `${rangeOverride.start}:${rangeOverride.end}`;
  }, [rangeOverride?.start, rangeOverride?.end]);

  const seriesKeyRef = useRef<string>(`${timeframe}:${symbolKey}:${rangeKey}`);

  const entities = useTickerStore((state) => state.entitiesByMode[mode]);

  const latestBars = useMemo(() => {
    const result: Record<string, Bar | undefined> = {};
    for (const symbol of uniqueSymbols) {
      result[symbol] = entities[symbol]?.latestBar;
    }
    return result;
  }, [entities, symbolKey]);

  // ── Reset state when key inputs change ──────────────────────────────────
  // Guard: only reset if we have data to clear and component is enabled

  useEffect(() => {
    if (!enabled) {
      if (isReady) deferReadyState(false);
      return;
    }

    const nextKey = `${timeframe}:${symbolKey}:${rangeKey}`;
    if (seriesKeyRef.current === nextKey) return;

    seriesKeyRef.current = nextKey;
    lastSeenRef.current.clear();
    if (isReady) deferReadyState(false);

    // Keep existing data until new history arrives to avoid flicker.
  }, [enabled, timeframe, symbolKey, rangeKey]);

  // ── Fetch history data ──────────────────────────────────────────────────
  // Use stable primitive deps instead of objects/arrays

  useEffect(() => {
    if (!enabled || uniqueSymbols.length === 0) {
      if (isReady) deferReadyState(false);
      // Only clear if there's data (prevents loop when already empty)
      window.setTimeout(() => {
        setSeriesBySymbol((prev) => {
          if (Object.keys(prev).length === 0) return prev;
          return {};
        });
      }, 0);
      return;
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    if (isReady) deferReadyState(false);

    const range = excludeLiveBucketFromRange(
      buildRange(timeframe, rangeOverride, windowMs),
      bucketMs,
    );
    const { start, end } = range;

    if (end < start) {
      window.setTimeout(() => {
        setSeriesBySymbol({});
        setIsReady(true);
      }, 0);
      return () => {
        controller.abort();
      };
    }

    const load = async () => {
      try {
        const results = await Promise.all(
          uniqueSymbols.map(async (symbol) => {
            const primaryBars = await fetchBarsRange(
              symbol,
              timeframe,
              start,
              end,
              controller.signal,
            );

            let nextBars = primaryBars;
            const expected = Math.ceil(windowMs / bucketMs);
            const fallbackTf = FALLBACK_TIMEFRAME[timeframe];
            if (fallbackTf && shouldFallback(primaryBars.length, expected)) {
              let fallbackBars = await fetchBarsRange(
                symbol,
                fallbackTf,
                start,
                end,
                controller.signal,
              );
              if (fallbackBars.length === 0 && fallbackTf !== "1s") {
                fallbackBars = await fetchBarsRange(
                  symbol,
                  "1s",
                  start,
                  end,
                  controller.signal,
                );
              }
              if (fallbackBars.length > 0) {
                nextBars = resampleBars(fallbackBars, timeframe);
              }
            }

            return [symbol, nextBars] as const;
          }),
        );

        const next: Record<string, Bar[]> = {};
        for (const [symbol, bars] of results) {
          next[symbol] = normalizeBars(bars, maxPoints);
        }
        setSeriesBySymbol(next);
      } catch (error) {
        if ((error as { name?: string }).name !== "AbortError") {
          console.warn("[useChartHistory] Failed to load history", error);
        }
      } finally {
        if (requestIdRef.current === requestId && !controller.signal.aborted) {
          setIsReady(true);
        }
      }
    };

    load();

    return () => {
      controller.abort();
    };
  }, [enabled, timeframe, symbolKey, rangeKey, maxPoints, windowMs, bucketMs]);

  // ── Live update effect ─────────────────────────────────────────────────
  // Only runs when latestBars actually changes (signature-based comparison)

  const latestBarsSignature = useMemo(() => {
    const signatures: string[] = [];
    for (const symbol of uniqueSymbols) {
      const bar = latestBars[symbol];
      if (bar) {
        signatures.push(`${symbol}:${bar.startTime}:${bar.close}:${bar.volume}:${bar.trades}`);
      }
    }
    return signatures.sort().join("|");
  }, [latestBars, symbolKey]);

  useEffect(() => {
    if (!enabled || uniqueSymbols.length === 0) return;

    setSeriesBySymbol((prev) => {
      let updated = false;
      const next = { ...prev };

      for (const symbol of uniqueSymbols) {
        const bar = latestBars[symbol];
        if (!bar) continue;

        const signature = `${bar.startTime}:${bar.close}:${bar.volume}:${bar.trades}`;
        if (lastSeenRef.current.get(symbol) === signature) continue;
        lastSeenRef.current.set(symbol, signature);

        const normalizedStart = normalizeTimestampMs(bar.startTime);
        const bucketStart = Math.floor(normalizedStart / bucketMs) * bucketMs;
        const bucketEnd = bucketStart + bucketMs;

        const existing = next[symbol] ? [...next[symbol]] : [];
        const last = existing[existing.length - 1];

        if (last && last.startTime === bucketStart) {
          existing[existing.length - 1] = {
            ...last,
            high: Math.max(last.high, bar.high),
            low: Math.min(last.low, bar.low),
            close: bar.close,
            volume: (last.volume || 0) + (bar.volume || 0),
            trades: (last.trades || 0) + (bar.trades || 0),
            endTime: bucketEnd,
          };
          next[symbol] = existing;
          updated = true;
          continue;
        }

        if (last && bucketStart < last.startTime) {
          continue;
        }

        const nextBar: Bar = {
          symbol,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume || 0,
          trades: bar.trades || 0,
          startTime: bucketStart,
          endTime: bucketEnd,
        };

        const appended = [...existing, nextBar];
        if (appended.length > maxPoints) {
          next[symbol] = appended.slice(appended.length - maxPoints);
        } else {
          next[symbol] = appended;
        }
        updated = true;
      }

      return updated ? next : prev;
    });
  }, [latestBarsSignature, enabled, symbolKey, bucketMs, maxPoints]);

  return {
    seriesBySymbol,
    isReady,
  };
}

async function fetchBarsRange(
  symbol: string,
  timeframe: HistoryTimeframe,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<Bar[]> {
  return fetchHubBarsRange({
    baseUrl: NEXT_PUBLIC_HUB_URL,
    symbol,
    timeframe,
    start,
    end,
    signal,
  });
}
