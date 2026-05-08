"use client";

import React, { useMemo, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useTickerStore } from "@/store/use-ticker-store";
import { buildTickerSnapshot } from "@/lib/ticker-snapshot";
import type { TickerSnapshot } from "@/types/ticker.types";
import type { IndicatorBucket } from "@/types/redis.types";

// ============================================================================
// Types
// ============================================================================

interface TickerEntryProps {
  symbol: string;
  className?: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse symbol into root and expiry (e.g., "ESH6" -> ["ES", "H6"])
 */
function parseSymbol(symbol: string): { root: string; expiry: string } {
  const match = symbol.match(/^([A-Z]{1,4})([FGHJKMNQUVXZ]\d{1,2})$/);
  if (match) {
    return { root: match[1], expiry: match[2] };
  }
  return { root: symbol, expiry: "" };
}

/**
 * Format price with appropriate decimal places
 */
function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 10) return price.toFixed(2);
  if (price >= 1) return price.toFixed(3);
  return price.toFixed(4);
}

/**
 * Format volume in compact notation (e.g., 1.2M, 500K)
 */
function formatVolume(volume: number): string {
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(0)}K`;
  return volume.toString();
}

/**
 * Format change with sign
 */
function formatChange(change: number): string {
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}`;
}

/**
 * Format percent change with sign
 */
function formatPercent(percent: number): string {
  const sign = percent >= 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

const INDICATOR_LABELS: Record<IndicatorBucket, string> = {
  low: "L",
  mid: "M",
  high: "H",
};

const INDICATOR_STYLES: Record<IndicatorBucket, string> = {
  low: "text-blue-400 border-blue-400/30",
  mid: "text-muted-foreground border-white/15",
  high: "text-emerald-400 border-emerald-400/30",
};

function IndicatorBadge({ bucket }: { bucket?: IndicatorBucket }) {
  if (!bucket) return null;
  return (
    <span
      className={cn(
        "ml-1 inline-flex items-center justify-center rounded border px-1 text-[9px] font-bold leading-3",
        INDICATOR_STYLES[bucket]
      )}
    >
      {INDICATOR_LABELS[bucket]}
    </span>
  );
}

function EmptyStateZone({ symbol }: { symbol: string }) {
  const { root, expiry } = parseSymbol(symbol);
  return (
    <div className="flex h-full flex-col justify-between overflow-hidden px-2.5 py-2">
      <div className="flex items-baseline gap-1 overflow-hidden">
        <span className="text-lg font-bold leading-none tracking-tight text-foreground/75 shrink-0">
          {root}
        </span>
        <span className="text-sm font-mono tracking-wide text-muted-foreground/40 shrink-0">
          {expiry}
        </span>
      </div>
      <div className="flex flex-1 items-center">
        <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground/45">
          Waiting for live data
        </span>
      </div>
      <div className="text-[12px] font-mono uppercase tracking-wider text-muted-foreground/30">
        No session snapshot
      </div>
    </div>
  );
}


// ============================================================================
// Sub-Components
// ============================================================================

interface DataZoneProps {
  data: TickerSnapshot;
  volumeValue: number;
  volumeBucket?: IndicatorBucket;
  vwapValue?: number;
  vwapBucket?: IndicatorBucket;
}

/**
 * Zone 1: Data Cluster (Left 85%)
 * Contains symbol, price, change, and volume in a 3-row layout
 * Typography: Numbers use font-mono (JetBrains Mono), tabular-nums
 */
const DataZone = React.memo(({ data, volumeValue, volumeBucket, vwapValue, vwapBucket }: DataZoneProps) => {
  const { root, expiry } = parseSymbol(data.symbol);
  const netChange = data.change;
  const percentChange = data.changePercent;
  const isPositive = netChange >= 0;
  const hasVwap = typeof vwapValue === "number" && Number.isFinite(vwapValue) && vwapValue > 0;

  return (
    <div className="flex flex-col justify-between h-full py-2 pl-2.5 pr-2.5 overflow-hidden min-w-0">
      {/* Row 1: Identity */}
      <div className="flex items-baseline justify-between gap-2 overflow-hidden">
        <div className="flex items-baseline gap-1 overflow-hidden">
          <span className="text-lg font-bold text-foreground tracking-tight leading-none shrink-0">
            {root}
          </span>
          <span className="text-sm font-mono text-muted-foreground/50 tracking-wide shrink-0">
            {expiry}
          </span>
        </div>
        <span
          className={cn(
            "text-sm font-mono font-semibold tabular-nums tracking-wide shrink-0",
            isPositive ? "text-emerald-500/90" : "text-rose-500/90"
          )}
        >
          {formatChange(netChange)}
        </span>
      </div>

      {/* Row 2: Price Action (Hero) */}
      <div className="flex items-baseline justify-between gap-2 overflow-hidden">
        <span className="text-lg font-bold font-mono text-foreground tabular-nums tracking-tight leading-none shrink-0">
          {formatPrice(data.last_price)}
        </span>
        <span
          className={cn(
            "text-[16px] font-mono font-semibold tabular-nums tracking-tight shrink-0",
            isPositive ? "text-emerald-500" : "text-rose-500"
          )}
        >
          {formatPercent(percentChange)}
        </span>
      </div>

      {/* Row 3: Liquidity Context */}
      <div className="flex items-center justify-between gap-2 overflow-hidden">
        <span className="text-[12px] font-mono text-muted-foreground/40 tabular-nums tracking-wider uppercase shrink-0">
          Vol {formatVolume(volumeValue)}
          {/* <IndicatorBadge bucket={volumeBucket} /> */}
        </span>
        {hasVwap && (
          <span className="text-[12px] font-mono text-amber-500/60 tabular-nums shrink-0">
            VWAP {formatPrice(vwapValue!)}
            {/* <IndicatorBadge bucket={vwapBucket} /> */}
          </span>
        )}
      </div>
    </div>
  );
});
DataZone.displayName = "DataZone";

interface PulseBarProps {
  data: TickerSnapshot;
}

/**
 * Zone 2: Pulse Bar (Right 15%)
 * A vertical candle-like visualization showing session range
 * - Track: Day Low to Day High
 * - Reference Line: Previous close
 * - Body: Open to Current (colored by direction)
 */
const PulseBar = React.memo(({ data }: PulseBarProps) => {
  const { session_high, session_low, session_open, last_price, prev_close } = data;
  const rawHigh = Number.isFinite(session_high) ? session_high : last_price;
  const rawLow = Number.isFinite(session_low) ? session_low : last_price;
  const high = Math.max(rawHigh, rawLow);
  const low = Math.min(rawHigh, rawLow);
  const range = Math.max(high - low, Number.EPSILON);

  // Calculate positions as percentages (0 = bottom, 100 = top)
  const clampPrice = (price: number) => Math.min(high, Math.max(low, price));
  const calcPosition = (price: number) => ((price - low) / range) * 100;

  // Candle body positioning
  const bodyTop = clampPrice(Math.max(session_open, last_price));
  const bodyBottom = clampPrice(Math.min(session_open, last_price));
  const bodyTopPercent = calcPosition(bodyTop);
  const bodyBottomPercent = calcPosition(bodyBottom);
  const bodyHeight = Math.max(bodyTopPercent - bodyBottomPercent, 2); // Min 2% height for visibility

  // Previous close reference line
  const prevClosePercent = calcPosition(clampPrice(prev_close));
  const clampedPrevClose = Math.max(2, Math.min(98, prevClosePercent));

  // Color based on direction
  const isUp = last_price >= session_open;

  return (
    <div className="flex items-center justify-center h-full w-full py-1">
      <div className="relative h-[90%] w-3 flex items-center justify-center">
        {/* The Track (Full Range Line) */}
        <div className="absolute inset-0 w-px bg-white/8 left-1/2 -translate-x-1/2 rounded-full" />

        {/* Previous Close Reference Line */}
        <div
          className={cn(
            "absolute w-full h-px left-0 transition-colors",
            "bg-muted-foreground/30"
          )}
          style={{ bottom: `${clampedPrevClose}%` }}
        />

        {/* The Candle Body */}
        <div
          className={cn(
            "absolute w-[6px] left-1/2 -translate-x-1/2 rounded-[1px] transition-all duration-150",
            isUp ? "bg-emerald-500" : "bg-rose-500"
          )}
          style={{
            bottom: `${bodyBottomPercent}%`,
            height: `${bodyHeight}%`,
          }}
        />

        {/* Current Price Marker */}
        <div
          className={cn(
            "absolute left-0 right-0 h-px transition-all duration-150",
            isUp
              ? "bg-emerald-400 shadow-[0_0_3px_rgba(16,185,129,0.4)]"
              : "bg-rose-400 shadow-[0_0_3px_rgba(244,63,94,0.4)]"
          )}
          style={{ bottom: `${calcPosition(clampPrice(last_price))}%` }}
        />
      </div>
    </div>
  );
});
PulseBar.displayName = "PulseBar";

// ============================================================================
// Main Component
// ============================================================================

export const TickerEntry = React.memo(({ symbol, className }: TickerEntryProps) => {
  const mode = useTickerStore((state) => state.mode);
  const entity = useTickerStore((state) => state.entitiesByMode[mode][symbol]);
  const bars = useTickerStore((state) => state.seriesByMode[mode][symbol]);
  const snapshot = useTickerStore((state) => state.snapshotsBySymbol[symbol]);
  const session = useTickerStore((state) => state.sessionsBySymbol[symbol]);
  const selection = useTickerStore((state) => state.selectionByMode[mode]);
  const isModalOpen = useTickerStore((state) => state.isModalOpen);
  const openPrimary = useTickerStore((state) => state.openPrimary);
  const toggleSelectShift = useTickerStore((state) => state.toggleSelectShift);

  const snapshotData = useMemo(
    () => buildTickerSnapshot(symbol, bars, entity?.latestBar, snapshot, session),
    [symbol, bars, entity?.latestBar, snapshot, session]
  );

  const volumeValue =
    session && Number.isFinite(session.volNow) && session.volNow > 0
      ? session.volNow
      : entity?.latestBar && Number.isFinite(entity.latestBar.volume)
        ? entity.latestBar.volume
        : snapshotData.cum_volume;

  const vwapValue =
    session && Number.isFinite(session.vwap) && session.vwap > 0
      ? session.vwap
      : snapshotData.vwap;

  const isSelected = selection.selected.includes(symbol) && !isModalOpen;
  const isPrimary = selection.primary === symbol && !isModalOpen;

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.shiftKey) {
        toggleSelectShift(symbol);
        return;
      }

      openPrimary(symbol);
    },
    [symbol, openPrimary, toggleSelectShift]
  );

  return (
    <Card
      className={cn(
        // Base layout - 85% data / separator / 15% pulse
        "relative grid grid-cols-[1fr_1px_28px] gap-0 w-full h-full overflow-hidden",
        // Styling - Bloomberg/fey.com inspired dark terminal aesthetic
        "rounded-sm border border-white/4 bg-[#141414]",
        // Hover & interaction
        "hover:bg-[#1a1a1a] hover:border-white/8 transition-all duration-150 cursor-pointer",
        // Subtle inner glow on hover
        "hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]",
        "select-none cursor-default",
        isSelected && "border-white/20 bg-[#171717]",
        isPrimary && "border-white/30 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]",
        className
      )}
      onClick={handleClick}
    >
      {/* Zone 1: Data Cluster */}
      {snapshotData.hasData ? (
        <DataZone
          data={snapshotData}
          volumeValue={volumeValue}
          volumeBucket={session && session.volNow > 0 ? session.volBucket : undefined}
          vwapValue={vwapValue}
          vwapBucket={session && session.vwap > 0 ? session.vwapBucket : undefined}
        />
      ) : (
        <EmptyStateZone symbol={symbol} />
      )}

      {/* Separator - 1px vertical line */}
      <div className="my-2 bg-white/6" />

      {/* Zone 2: Pulse Bar */}
      {snapshotData.hasData ? <PulseBar data={snapshotData} /> : <div className="m-2 rounded-full bg-white/5" />}
    </Card>
  );
});

TickerEntry.displayName = "TickerEntry";
