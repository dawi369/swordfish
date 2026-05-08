"use client";

import React, { useEffect, useRef, useCallback } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  IChartApi,
  ISeriesApi,
  LineStyle,
  LineWidth,
  CandlestickData,
  LineData,
  Time,
  PriceScaleMode,
} from "lightweight-charts";
import { SYMBOL_COLORS } from "@/components/terminal/ticker-modal/ticker-modal-provider";

interface TradingChartProps {
  ticker: string;
  data?: CandlestickData<Time>[];
  lineData?: LineData<Time>[];
  comparisons?: string[];
  comparisonData?: Record<string, LineData<Time>[]>;
  showComparisons?: boolean;
  fitKey?: string;
  visibleBars?: number;
  secondsVisible?: boolean;
  sessionLevels?: { high?: number | null; low?: number | null; last?: number | null };
  compareMode?: boolean;
  onUserRangeChange?: () => void;
  onFitApplied?: () => void;
  isHistoryReady?: boolean;
  className?: string;
}

const emptyCandles: CandlestickData<Time>[] = [];
const emptyLines: LineData<Time>[] = [];
type PriceLineRef = ReturnType<ISeriesApi<"Line">["createPriceLine"]>;

export function TradingChart({
  ticker,
  data,
  lineData,
  comparisons = [],
  comparisonData,
  showComparisons = true,
  fitKey,
  visibleBars = 100,
  secondsVisible = false,
  sessionLevels,
  compareMode = false,
  onUserRangeChange,
  onFitApplied,
  isHistoryReady = true,
  className,
}: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const primaryCandleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const primaryLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const comparisonSeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const lastFitKeyRef = useRef<string | null>(null);

  const pendingFitRef = useRef(true);
  const fitLengthRef = useRef(0);
  const programmaticRangeRef = useRef(false);
  const fitRafRef = useRef<number | null>(null);
  const priceLinesRef = useRef<{
    high?: PriceLineRef;
    low?: PriceLineRef;
    last?: PriceLineRef;
  }>({});

  const useLinePrimary = lineData !== undefined;
  const initialWindowSize = Math.max(10, visibleBars);
  const windowSizeRef = useRef(initialWindowSize);
  const rightOffsetRef = useRef(Math.max(2, Math.floor(initialWindowSize * 0.2)));

  // Initialize chart
  const initChart = useCallback(() => {
    if (!containerRef.current) return;

    // Clean up existing chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      primaryCandleRef.current = null;
      primaryLineRef.current = null;
      comparisonSeriesRef.current.clear();
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.05)" },
        horzLines: { color: "rgba(255, 255, 255, 0.05)" },
      },
      crosshair: {
        vertLine: { color: "rgba(255, 255, 255, 0.2)", width: 1, style: 2 },
        horzLine: { color: "rgba(255, 255, 255, 0.2)", width: 1, style: 2 },
      },
      timeScale: {
        borderColor: "rgba(255, 255, 255, 0.1)",
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: "rgba(255, 255, 255, 0.1)",
      },
      handleScroll: { vertTouchDrag: false },
    });

    // Hide watermark/logo if present (not in type defs for this version).
    // @ts-expect-error watermark is supported at runtime
    chart.applyOptions({ watermark: { visible: false } });

    chartRef.current = chart;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: SYMBOL_COLORS[0],
      downColor: "#f43f5e",
      borderUpColor: SYMBOL_COLORS[0],
      borderDownColor: "#f43f5e",
      wickUpColor: SYMBOL_COLORS[0],
      wickDownColor: "#f43f5e",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    primaryCandleRef.current = candlestickSeries;

    const lineSeries = chart.addSeries(LineSeries, {
      color: SYMBOL_COLORS[0],
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    primaryLineRef.current = lineSeries;

    candlestickSeries.setData(emptyCandles);
    lineSeries.setData(emptyLines);

  }, []);

  const compareScale = compareMode;

  // Handle resize
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      if (chartRef.current && entries[0]) {
        const { width, height } = entries[0].contentRect;
        chartRef.current.applyOptions({ width, height });
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Initialize chart on mount
  useEffect(() => {
    initChart();
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        primaryCandleRef.current = null;
        primaryLineRef.current = null;
        comparisonSeriesRef.current.clear();
      }
    };
  }, [initChart]);

  // Update data when ticker changes
  useEffect(() => {
    if (!chartRef.current) return;

    const length = useLinePrimary ? lineData?.length ?? 0 : data?.length ?? 0;
    const nextFitKey = fitKey ?? `${ticker}:${useLinePrimary ? "line" : "candle"}`;
    if (lastFitKeyRef.current !== nextFitKey) {
      pendingFitRef.current = true;
    }

    const setDataOnChart = () => {
      if (useLinePrimary) {
        primaryCandleRef.current?.setData(emptyCandles);
        primaryLineRef.current?.setData(lineData ?? emptyLines);
      } else {
        primaryLineRef.current?.setData(emptyLines);
        primaryCandleRef.current?.setData(data ?? emptyCandles);
      }
    };

    const defaultWindow = Math.max(10, Math.min(visibleBars, length || visibleBars));

    // If we previously fit before full history arrived, re-fit once when enough bars are present.
    if (!pendingFitRef.current && lastFitKeyRef.current === nextFitKey) {
      if (fitLengthRef.current < defaultWindow && length >= defaultWindow) {
        pendingFitRef.current = true;
      }
    }

    // Only enforce margin + window on initial load or timeframe/range change
    if (!pendingFitRef.current || length === 0 || !isHistoryReady) {
      // No fit needed — set data immediately (live updates).
      // But skip if a fit rAF is pending (avoid flashing data at the wrong zoom).
      if (fitRafRef.current === null) {
        setDataOnChart();
      }
      return;
    }

    // Cancel any previous fit rAF (stale from a prior effect run)
    if (fitRafRef.current !== null) {
      cancelAnimationFrame(fitRafRef.current);
      fitRafRef.current = null;
    }

    windowSizeRef.current = defaultWindow;
    const dynamicRightOffset = Math.max(2, Math.floor(defaultWindow * 0.2));
    rightOffsetRef.current = dynamicRightOffset;

    const applyFit = () => {
      if (!chartRef.current) return;
      const to = Math.max(0, length - 1);
      const from = Math.max(0, to - defaultWindow);
      if (from <= to) {
        programmaticRangeRef.current = true;
        chartRef.current.timeScale().setVisibleLogicalRange({ from, to });
        queueMicrotask(() => {
          programmaticRangeRef.current = false;
        });
      }
      chartRef.current.applyOptions({
        timeScale: {
          timeVisible: true,
          secondsVisible,
          rightOffset: rightOffsetRef.current,
        },
      });
      onFitApplied?.();
    };

    lastFitKeyRef.current = nextFitKey;
    fitLengthRef.current = length;

    // Batch data + fit in a single frame so the chart never paints at the wrong zoom.
    fitRafRef.current = requestAnimationFrame(() => {
      fitRafRef.current = null;
      pendingFitRef.current = false;
      setDataOnChart();
      applyFit();
    });
  }, [ticker, data, lineData, useLinePrimary, fitKey, visibleBars, secondsVisible, isHistoryReady, onFitApplied]);

  useEffect(() => {
    if (!chartRef.current || !onUserRangeChange) return;
    const timeScale = chartRef.current.timeScale();
    const handleRangeChange = (range: { from: number; to: number } | null) => {
      if (!range || programmaticRangeRef.current) return;
      onUserRangeChange();
    };

    timeScale.subscribeVisibleLogicalRangeChange(handleRangeChange);
    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(handleRangeChange);
    };
  }, [onUserRangeChange]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (compareScale) {
      chartRef.current.applyOptions({
        rightPriceScale: {
          mode: PriceScaleMode.Percentage,
          visible: true,
        },
        leftPriceScale: {
          visible: false,
          mode: PriceScaleMode.Normal,
        },
      });
    } else {
      chartRef.current.applyOptions({
        rightPriceScale: {
          mode: PriceScaleMode.Normal,
          visible: true,
        },
        leftPriceScale: {
          visible: false,
          mode: PriceScaleMode.Normal,
        },
      });
    }

    const primaryScaleId = "right";
    primaryLineRef.current?.applyOptions({ priceScaleId: primaryScaleId });
    primaryCandleRef.current?.applyOptions({ priceScaleId: primaryScaleId });
  }, [compareScale]);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      timeScale: {
        timeVisible: true,
        secondsVisible,
        rightOffset: rightOffsetRef.current,
      },
    });
  }, [secondsVisible]);

  // Clear all price lines from both series (safe even if refs are stale)
  const clearPriceLines = useCallback(() => {
    const { high, low, last } = priceLinesRef.current;
    const targets = [primaryLineRef.current, primaryCandleRef.current].filter(Boolean);
    for (const series of targets) {
      try { if (high) series!.removePriceLine(high); } catch { /* already removed */ }
      try { if (low) series!.removePriceLine(low); } catch { /* already removed */ }
      try { if (last) series!.removePriceLine(last); } catch { /* already removed */ }
    }
    priceLinesRef.current = {};
  }, []);

  // Session level price lines — always clear-and-recreate for robustness
  useEffect(() => {
    const activeSeries = useLinePrimary ? primaryLineRef.current : primaryCandleRef.current;

    // Clear previous lines first
    clearPriceLines();

    if (!activeSeries || !sessionLevels) return;

    const toPrice = (value?: number | null) =>
      typeof value === "number" && Number.isFinite(value) ? value : null;
    let high = toPrice(sessionLevels.high);
    let low = toPrice(sessionLevels.low);
    const last = toPrice(sessionLevels.last);

    if (high !== null && low !== null && high < low) {
      [high, low] = [low, high];
    }

    const createLine = (
      key: "high" | "low" | "last",
      price: number | null,
      options: { color: string; title: string; lineStyle: LineStyle; lineWidth: LineWidth },
    ) => {
      if (price === null) return;
      priceLinesRef.current[key] = activeSeries.createPriceLine({
        price,
        axisLabelVisible: true,
        title: options.title,
        lineStyle: options.lineStyle,
        lineWidth: options.lineWidth,
        color: options.color,
      });
    };

    createLine("high", high, {
      color: "#10b981",
      title: "SESSION HIGH",
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
    });
    createLine("low", low, {
      color: "#f43f5e",
      title: "SESSION LOW",
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
    });
    createLine("last", last, {
      color: "#e2e8f0",
      title: "LAST",
      lineStyle: LineStyle.Solid,
      lineWidth: 2,
    });
  }, [sessionLevels, useLinePrimary, ticker, data, lineData, clearPriceLines]);

  // Handle comparison symbols
  useEffect(() => {
    if (!chartRef.current) return;

    const activeSymbols = showComparisons ? comparisons : [];
    const currentSymbols = new Set(activeSymbols);
    const existingSymbols = new Set(comparisonSeriesRef.current.keys());

    for (const symbol of existingSymbols) {
      if (!currentSymbols.has(symbol)) {
        const series = comparisonSeriesRef.current.get(symbol);
        if (series) {
          chartRef.current.removeSeries(series);
          comparisonSeriesRef.current.delete(symbol);
        }
      }
    }

    for (let i = 0; i < activeSymbols.length; i++) {
      const symbol = activeSymbols[i];
      const colorIndex = i + 1;
      const color = SYMBOL_COLORS[colorIndex % SYMBOL_COLORS.length];
      let series = comparisonSeriesRef.current.get(symbol);

      if (!series) {
        series = chartRef.current.addSeries(LineSeries, {
          color,
          lineWidth: 2,
          priceScaleId: "right",
        });
        comparisonSeriesRef.current.set(symbol, series);
      } else {
        series.applyOptions({ color, lineWidth: 2 });
      }

      const seriesData = comparisonData?.[symbol] ?? emptyLines;
      series.setData(seriesData);
    }
  }, [comparisons, comparisonData, showComparisons]);

  return <div ref={containerRef} className={className} style={{ width: "100%", height: "100%" }} />;
}
