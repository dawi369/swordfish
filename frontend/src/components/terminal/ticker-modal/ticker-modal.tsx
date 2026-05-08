"use client";

import React, { useEffect, useMemo, useCallback, useRef, useId, useState } from "react";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTickerModal } from "@/components/terminal/ticker-modal/ticker-modal-provider";
import { TradingChart } from "@/components/terminal/ticker-modal/trading-chart";
import { AISidebar } from "@/components/terminal/ticker-modal/ai-sidebar";
import { ModalHeader } from "@/components/terminal/ticker-modal/modal-header";
import { ChartToolbar } from "@/components/terminal/ticker-modal/chart-toolbar";
import { SymbolChips } from "@/components/terminal/ticker-modal/symbol-chips";
import { SpreadControls } from "@/components/terminal/ticker-modal/spread-controls";
import { ChartRangeSelector } from "@/components/terminal/ticker-modal/chart-range-selector";
import { ChartTimeDisplay } from "@/components/terminal/ticker-modal/chart-time-display";
import { useTickerStore } from "@/store/use-ticker-store";
import { useSpotlight } from "@/components/terminal/layout/spotlight/spotlight-provider";
import { useChartSeries } from "@/hooks/use-chart-series";
import { useChartSettings } from "@/hooks/use-chart-settings";
import { SPREAD_PRESETS, type SpreadPresetId, type RangePresetId } from "@/lib/chart-utils";
import { useDisplayModeTransition } from "@/components/terminal/ticker-modal/use-display-mode-transition";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const MODE_SWITCH_MS = 120;
const MODE_FADE_MS = 260;
const SYMBOL_FLASH_MS = 160;

// Chart display state machine
type ChartDisplayState = 'hidden' | 'fitting' | 'ready';

export function TickerModal() {
  const {
    isOpen,
    primarySymbol,
    close,
    isSidebarOpen,
    toggleSidebar,
    setSidebarOpen,
    comparisons,
    timeframe,
    setTimeframe,
    showSessionLevels,
    toggleShowSessionLevels,
    spreadEnabled,
    spreadPreset,
    setSpreadEnabled,
    spreadLegs,
    toggleSpreadLegSign,
    moveSpreadLeg,
    reverseSpreadLegs,
    applySpreadPreset,
    removeComparison,
    reorderSelection,
  } = useTickerModal();
  const { openWithMode } = useSpotlight();
  const mode = useTickerStore((state) => state.mode);
  const setTrackedSymbols = useTickerStore((state) => state.setTrackedSymbols);

  // ── Settings (localStorage, range, timeframe) ──────────────────────────

  const settings = useChartSettings({
    timeframe,
    setTimeframe,
    spreadEnabled,
    setSpreadEnabled,
    showSessionLevels,
    isSidebarOpen,
    setSidebarOpen,
  });

  // ── Display mode transitions ───────────────────────────────────────────

  const compareMode = !spreadEnabled && comparisons.length > 0;
  const targetMode: "single" | "compare" | "spread" = spreadEnabled
    ? "spread"
    : compareMode
      ? "compare"
      : "single";

  const { displayMode, isTransitioning } = useDisplayModeTransition({
    targetMode,
    primarySymbol,
    modeSwitchMs: MODE_SWITCH_MS,
    modeFadeMs: MODE_FADE_MS,
    symbolFlashMs: SYMBOL_FLASH_MS,
  });

  const displayCompare = displayMode === "compare";
  const displaySpread = displayMode === "spread";

  // ── Data pipeline ──────────────────────────────────────────────────────

  const series = useChartSeries({
    primarySymbol,
    comparisons,
    spreadEnabled,
    spreadLegs,
    timeframe,
    isOpen,
    mode,
    rangeOverride: settings.rangeOverride,
    displayCompare,
    displaySpread,
    showLegs: settings.showLegs,
    showSessionLevels,
  });

  // ── Ordered symbols (for chips/spread) ─────────────────────────────────

  const orderedSymbols = useMemo(() => {
    if (!primarySymbol) return comparisons;
    return [primarySymbol, ...comparisons];
  }, [primarySymbol, comparisons]);

  // ── Track symbols for live updates ─────────────────────────────────────

  const headerSymbols = useMemo(() => {
    if (spreadEnabled && spreadLegs.length > 0) {
      return spreadLegs.map((leg) => leg.symbol);
    }
    return orderedSymbols;
  }, [orderedSymbols, spreadEnabled, spreadLegs]);

  const headerSymbolsKey = useMemo(() => headerSymbols.join("|"), [headerSymbols]);
  const trackedSymbolsKeyRef = useRef("");

  useEffect(() => {
    if (!isOpen) {
      if (trackedSymbolsKeyRef.current !== "") {
        trackedSymbolsKeyRef.current = "";
        setTrackedSymbols([]);
      }
      return;
    }
    if (trackedSymbolsKeyRef.current === headerSymbolsKey) return;
    trackedSymbolsKeyRef.current = headerSymbolsKey;
    setTrackedSymbols(headerSymbols);
  }, [isOpen, headerSymbols, headerSymbolsKey, setTrackedSymbols]);

  // ── Drawer animation ────────────────────────────────────────────────────

  const handleCloseClick = useCallback(() => {
    if (!isOpen) return;
    close();
  }, [close, isOpen]);

  // ── Escape key ─────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        close();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, close]);

  const titleId = useId();
  const descriptionId = useId();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<Date | undefined>(undefined);
  const [activeRangePreset, setActiveRangePreset] = useState<RangePresetId | null>(() =>
    settings.rangePreset === "custom" ? null : settings.rangePreset,
  );
  
  // Chart display state machine
  const [chartDisplayState, setChartDisplayState] = useState<ChartDisplayState>('hidden');
  const currentFitKeyRef = useRef<string | null>(null);
  const safetyTimerRef = useRef<number | null>(null);

  // Reset display state when modal closes (component persists — hooks don't remount)
  useEffect(() => {
    if (!isOpen) {
      window.setTimeout(() => setChartDisplayState('hidden'), 0);
      currentFitKeyRef.current = null;
      if (safetyTimerRef.current) {
        window.clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
    }
  }, [isOpen]);

  const handleCalendarSelect = (date: Date | undefined) => {
    if (!date) return;
    setSelectedCalendarDate(date);
    setCalendarOpen(false);
  };

  // Track fitKey changes and manage chart display state
  useEffect(() => {
    const fitKey = series.fitKey;
    
    // If fitKey changed, reset to hidden (new data coming)
    if (currentFitKeyRef.current !== fitKey) {
      currentFitKeyRef.current = fitKey;
      
      // Clear any pending safety timer
      if (safetyTimerRef.current) {
        window.clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
      
      // If we were already ready, stay ready (show last frame while loading)
      // Only hide if this is the initial load
      if (chartDisplayState === 'hidden') {
        // Wait for data to be ready before showing
        if (series.isHistoryReady) {
          window.setTimeout(() => setChartDisplayState('fitting'), 0);
        }
      }
    }
  }, [series.fitKey, series.isHistoryReady, chartDisplayState]);

  // When history becomes ready, transition to fitting
  useEffect(() => {
    if (series.isHistoryReady && chartDisplayState === 'hidden') {
      window.setTimeout(() => setChartDisplayState('fitting'), 0);
    }
  }, [series.isHistoryReady, chartDisplayState]);

  // Safety timeout: if fitting for too long, show anyway
  useEffect(() => {
    if (chartDisplayState !== 'fitting') return;
    
    // Safety: show after 200ms even if fit hasn't reported
    safetyTimerRef.current = window.setTimeout(() => {
      setChartDisplayState('ready');
    }, 200);
    
    return () => {
      if (safetyTimerRef.current) {
        window.clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
    };
  }, [chartDisplayState]);

  const handleRangePresetChange = useCallback(
    (preset: "custom" | RangePresetId) => {
      settings.handleRangePresetChange(preset);
      if (preset === "custom") {
        setActiveRangePreset(null);
        return;
      }
      setActiveRangePreset(preset);
    },
    [settings],
  );

  const handleFitApplied = useCallback(() => {
    // Clear safety timer since fit completed naturally
    if (safetyTimerRef.current) {
      window.clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
    setChartDisplayState('ready');
  }, []);

  // Step 1: Gate rendering with both isOpen && primarySymbol.
  if (!isOpen || !primarySymbol) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/50"
        onClick={handleCloseClick}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="absolute inset-x-0 bottom-0 z-50 flex h-[94vh] max-h-none flex-col rounded-t-2xl border-t border-white/10 bg-background"
      >
        <VisuallyHidden.Root id={titleId}>{primarySymbol} Details</VisuallyHidden.Root>
        <VisuallyHidden.Root id={descriptionId}>Trading view for {primarySymbol}</VisuallyHidden.Root>

        <div className="px-4 pt-3 pb-2 bg-black/20 border-b border-white/10">
          <ModalHeader
            headerItems={series.headerItems}
            spreadValue={displaySpread ? series.spreadValue : null}
            onClose={handleCloseClick}
          />

          <div className="mt-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <ChartToolbar
                timeframe={timeframe}
                onTimeframeChange={settings.handleTimeframeChange}
                showSessionLevels={showSessionLevels}
                onToggleSessionLevels={toggleShowSessionLevels}
                displayCompare={displayCompare}
                onAddSymbol={() => openWithMode("ticker-compare")}
              />

              <div className="flex items-center gap-2">
                <ToggleGroup
                  type="single"
                  value={spreadEnabled ? "spread" : "compare"}
                  onValueChange={(val) => {
                    if (!val) return;
                    setSpreadEnabled(val === "spread");
                  }}
                  className="bg-muted/50 p-0.5 rounded-md border border-white/5"
                >
                  <ToggleGroupItem value="compare" size="sm" className="h-7 px-2 text-xs data-[state=on]:bg-background">
                    Compare
                  </ToggleGroupItem>
                  <ToggleGroupItem value="spread" size="sm" className="h-7 px-2 text-xs data-[state=on]:bg-background">
                    Spread
                  </ToggleGroupItem>
                </ToggleGroup>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={toggleSidebar}
                  aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
                >
                  {isSidebarOpen ? (
                    <PanelRightClose className="w-3.5 h-3.5" />
                  ) : (
                    <PanelRightOpen className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              {spreadEnabled ? (
                <SpreadControls
                  spreadLegs={spreadLegs}
                  primarySymbol={primarySymbol}
                  orderedSymbols={orderedSymbols}
                  activePreset={spreadPreset}
                  onToggleSign={toggleSpreadLegSign}
                  onRemove={removeComparison}
                  onReverse={reverseSpreadLegs}
                  onApplyPreset={(id: SpreadPresetId) => applySpreadPreset(id)}
                />
              ) : (
                <SymbolChips
                  orderedSymbols={orderedSymbols}
                  onRemoveComparison={removeComparison}
                  onReorderSelection={reorderSelection}
                />
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col p-3 overflow-hidden">
            <div
              className={cn(
                "flex-1 relative rounded-xl border border-white/10 bg-black/20 overflow-hidden transition-opacity duration-200",
                isTransitioning && "opacity-70"
              )}
            >
              {/* Empty spread overlay */}
              {displaySpread && (() => {
                const activePresetDef = SPREAD_PRESETS.find(p => p.id === spreadPreset);
                const required = activePresetDef ? activePresetDef.weights.length : 2;
                const current = spreadLegs.length;
                if (current < required) {
                  const needed = required - current;
                  const label = activePresetDef ? activePresetDef.label.split(" ")[0] : "Spread";
                  return (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/40 backdrop-blur-sm">
                      <span className="text-sm text-muted-foreground">
                        Add {needed} more ticker{needed > 1 ? "s" : ""} to view {label} spread.
                      </span>
                    </div>
                  );
                }
                return null;
              })()}
              <div className={cn(
                "h-full w-full relative",
                chartDisplayState !== 'ready' && "invisible"
              )}>
                <div className={cn(
                  "absolute inset-0 z-10 bg-black/50 backdrop-blur-[1px] transition-opacity duration-150",
                  chartDisplayState === 'ready' ? "opacity-0 pointer-events-none" : "opacity-100"
                )} />
                <TradingChart
                  ticker={primarySymbol}
                  data={displaySpread || displayCompare ? undefined : series.chartData}
                  lineData={
                    displaySpread
                      ? series.spreadData
                      : displayCompare
                        ? series.primaryLineData
                        : undefined
                  }
                  comparisons={series.overlaySymbols}
                  comparisonData={series.comparisonData}
                  showComparisons={displaySpread ? false : displayCompare}
                  fitKey={series.fitKey}
                  visibleBars={series.visibleBars}
                  secondsVisible={series.secondsVisible}
                  sessionLevels={series.sessionLevels}
                  compareMode={displayCompare}
                  isHistoryReady={series.isHistoryReady}
                  onUserRangeChange={() => {
                    setActiveRangePreset(null);
                    settings.handleRangePresetChange("custom");
                  }}
                  onFitApplied={handleFitApplied}
                />
              </div>
              {calendarOpen && (
                <>
                  <div
                    className="absolute inset-0 bg-black/50 z-40"
                    onClick={() => setCalendarOpen(false)}
                  />
                  <div className="absolute inset-0 flex items-start justify-center z-50 pointer-events-none pt-8">
                    <div
                      className="pointer-events-auto bg-background border border-white/10 rounded-lg shadow-xl p-3 min-w-[280px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Calendar
                        mode="single"
                        selected={selectedCalendarDate}
                        onSelect={handleCalendarSelect}
                        initialFocus
                        fixedWeeks
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="mt-2 h-8 px-2 flex items-center justify-between border-t border-white/10">
              <ChartRangeSelector
                activePreset={activeRangePreset}
                onRangePresetChange={handleRangePresetChange}
                onCalendarOpen={() => setCalendarOpen(true)}
              />
              <ChartTimeDisplay />
            </div>
          </div>

          <AISidebar isOpen={isSidebarOpen} />
        </div>
      </div>
    </div>
  );
}
