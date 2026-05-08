"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RANGE_PRESETS, type RangePresetId } from "@/lib/chart-utils";
import { TIMEFRAMES, type Timeframe } from "@/types/ticker.types";

interface UseChartSettingsOptions {
  timeframe: Timeframe;
  setTimeframe: (tf: Timeframe) => void;
  spreadEnabled: boolean;
  setSpreadEnabled: (enabled: boolean) => void;
  showSessionLevels: boolean;
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

interface UseChartSettingsReturn {
  showLegs: boolean;
  setShowLegs: React.Dispatch<React.SetStateAction<boolean>>;
  rangePreset: RangePresetId | "custom";
  rangeOverride: { start: number; end: number } | null;
  handleTimeframeChange: (tf: Timeframe) => void;
  handleRangePresetChange: (id: RangePresetId | "custom") => void;
  settingsLoaded: boolean;
}

export function useChartSettings({
  timeframe,
  setTimeframe,
  spreadEnabled,
  setSpreadEnabled,
  showSessionLevels,
  isSidebarOpen,
  setSidebarOpen,
}: UseChartSettingsOptions): UseChartSettingsReturn {
  const [showLegs, setShowLegs] = useState(false);
  const [rangePreset, setRangePreset] = useState<RangePresetId | "custom">("custom");
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // ── Load from localStorage on mount ──────────────────────────────────────

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const storedTimeframe = localStorage.getItem("terminal-chart-timeframe");
      if (storedTimeframe && TIMEFRAMES.includes(storedTimeframe as Timeframe)) {
        setTimeframe(storedTimeframe as Timeframe);
      }

      const storedPreset = localStorage.getItem("terminal-chart-range-preset");
      if (storedPreset) {
        if (storedPreset === "custom") {
          setRangePreset("custom");
        } else {
          const preset = RANGE_PRESETS.find((entry) => entry.id === storedPreset);
          if (preset) {
            setRangePreset(preset.id);
            setRangeAnchor(Date.now());
            setTimeframe(preset.timeframe);
          }
        }
      }

      const storedSpread = localStorage.getItem("terminal-chart-spread-enabled");
      if (storedSpread === "true" || storedSpread === "false") {
        setSpreadEnabled(storedSpread === "true");
      }

      const storedShowLegs = localStorage.getItem("terminal-chart-show-legs");
      if (storedShowLegs === "true" || storedShowLegs === "false") {
        setShowLegs(storedShowLegs === "true");
      }

      const storedSidebar = localStorage.getItem("terminal-chart-sidebar-open");
      if (storedSidebar === "true" || storedSidebar === "false") {
        setSidebarOpen(storedSidebar === "true");
      }

      setSettingsLoaded(true);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [setTimeframe, setSpreadEnabled, setSidebarOpen]);

  // ── Persist to localStorage ──────────────────────────────────────────────

  useEffect(() => {
    if (!settingsLoaded) return;
    localStorage.setItem("terminal-show-session-levels", String(showSessionLevels));
  }, [showSessionLevels, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    localStorage.setItem("terminal-chart-timeframe", timeframe);
  }, [timeframe, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    localStorage.setItem("terminal-chart-spread-enabled", String(spreadEnabled));
  }, [spreadEnabled, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    localStorage.setItem("terminal-chart-show-legs", String(showLegs));
  }, [showLegs, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    localStorage.setItem("terminal-chart-range-preset", rangePreset);
  }, [rangePreset, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    localStorage.setItem("terminal-chart-sidebar-open", String(isSidebarOpen));
  }, [isSidebarOpen, settingsLoaded]);

  // ── Callbacks ────────────────────────────────────────────────────────────

  const handleTimeframeChange = useCallback(
    (tf: Timeframe) => {
      setTimeframe(tf);
      setRangePreset("custom");
    },
    [setTimeframe],
  );

  const handleRangePresetChange = useCallback(
    (presetId: RangePresetId | "custom") => {
      if (presetId === "custom") {
        setRangePreset("custom");
        return;
      }
      const preset = RANGE_PRESETS.find((entry) => entry.id === presetId);
      if (!preset) return;
      setRangePreset(presetId);
      setRangeAnchor(Date.now());
      setTimeframe(preset.timeframe);
    },
    [setTimeframe],
  );

  // ── Derived state ────────────────────────────────────────────────────────

  const rangeOverride = useMemo(() => {
    if (rangePreset === "custom") return null;
    if (rangeAnchor === null) return null;
    const preset = RANGE_PRESETS.find((entry) => entry.id === rangePreset);
    if (!preset) return null;
    const end = rangeAnchor;
    if (preset.id === "YTD") {
      const start = new Date(new Date(end).getFullYear(), 0, 1).getTime();
      return { start, end };
    }
    if (!preset.rangeMs) return null;
    return { start: end - preset.rangeMs, end };
  }, [rangePreset, rangeAnchor]);

  return {
    showLegs,
    setShowLegs,
    rangePreset,
    rangeOverride,
    handleTimeframeChange,
    handleRangePresetChange,
    settingsLoaded,
  };
}
