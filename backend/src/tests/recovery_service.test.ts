import { describe, expect, mock, spyOn, test } from "bun:test";
import { RecoveryService } from "@/services/recovery_service.js";
import type { Bar } from "@/types/common.types.js";
import {
  RECOVERY_BUCKET_MS,
  RECOVERY_OVERLAP_MS,
  RECOVERY_RETENTION_MS,
  RECOVERY_TIMEFRAME,
} from "@/types/recovery.types.js";
import { telemetry } from "@/utils/telemetry.js";

describe("RecoveryService", () => {
  const recoveryService = new RecoveryService(
    {
      init: async () => undefined,
      upsertBars: async () => undefined,
      getBars: async () => [],
      getLatestTimestamp: async () => null,
      getStats: async () => ({
        symbol: "ESH6",
        timeframe: RECOVERY_TIMEFRAME,
        barCount: 0,
        oldestBarTs: null,
        newestBarTs: null,
      }),
    },
    {
      setRecoveryCheckpoint: async () => undefined,
      getRecoveryCheckpoint: async () => null,
      getAllRecoveryCheckpoints: async () => ({}),
      writeBarsForRecovery: async () => undefined,
    } as any,
  );

  test("plans a full retention window when no checkpoint exists", () => {
    const nowMs = Date.UTC(2026, 2, 25, 12, 0, 0, 0);
    const window = recoveryService.planRehydrateWindow(null, nowMs);

    expect(window.startMs).toBe(nowMs - RECOVERY_RETENTION_MS);
    expect(window.endMs).toBe(nowMs);
  });

  test("plans a checkpoint-based window with overlap", () => {
    const nowMs = Date.UTC(2026, 2, 25, 12, 0, 0, 0);
    const checkpointTs = nowMs - 60 * 60 * 1000;

    const window = recoveryService.planRehydrateWindow(
      {
        symbol: "ESH6",
        timeframe: RECOVERY_TIMEFRAME,
        lastSeenBarTs: checkpointTs,
        updatedAt: nowMs,
        source: "live",
      },
      nowMs,
    );

    expect(window.startMs).toBe(checkpointTs - RECOVERY_OVERLAP_MS);
    expect(window.endMs).toBe(nowMs);
  });

  test("does not plan before the rolling retention window", () => {
    const nowMs = Date.UTC(2026, 2, 25, 12, 0, 0, 0);
    const checkpointTs = nowMs - RECOVERY_RETENTION_MS - 60 * 60 * 1000;

    const window = recoveryService.planRehydrateWindow(
      {
        symbol: "ESH6",
        timeframe: RECOVERY_TIMEFRAME,
        lastSeenBarTs: checkpointTs,
        updatedAt: nowMs,
        source: "live",
      },
      nowMs,
    );

    expect(window.startMs).toBe(nowMs - RECOVERY_RETENTION_MS);
    expect(window.endMs).toBe(nowMs);
  });

  test("plans reconnect backfill from disconnect time when there is no checkpoint", () => {
    const nowMs = Date.UTC(2026, 2, 25, 12, 8, 30, 0);
    const disconnectedAt = Date.UTC(2026, 2, 25, 12, 3, 0, 0);

    const window = recoveryService.planProviderRecoveryWindow({
      checkpoint: null,
      disconnectedAt,
      nowMs,
      endMs: nowMs,
      excludeCurrentMinute: true,
    });

    expect(window).not.toBeNull();
    expect(window?.startMs).toBe(disconnectedAt - RECOVERY_OVERLAP_MS);
    expect(window?.endMs).toBe(Date.UTC(2026, 2, 25, 12, 7, 59, 999));
  });

  test("aggregates live bars into minute buckets before persisting", async () => {
    const upserts: Bar[][] = [];
    const checkpoints: Array<{ symbol: string; lastSeenBarTs: number }> = [];

    const service = new RecoveryService(
      {
        init: async () => undefined,
        upsertBars: async (_symbol, _timeframe, bars) => {
          upserts.push(bars);
        },
        getBars: async () => [],
        getLatestTimestamp: async () => null,
        getStats: async () => ({
          symbol: "ESH6",
          timeframe: RECOVERY_TIMEFRAME,
          barCount: 0,
          oldestBarTs: null,
          newestBarTs: null,
        }),
      },
      {
        setRecoveryCheckpoint: async (checkpoint: any) => {
          checkpoints.push({
            symbol: checkpoint.symbol,
            lastSeenBarTs: checkpoint.lastSeenBarTs,
          });
        },
        getRecoveryCheckpoint: async () => null,
        getAllRecoveryCheckpoints: async () => ({}),
        writeBarsForRecovery: async () => undefined,
      } as any,
    );

    const firstBar: Bar = {
      symbol: "ESH6",
      open: 10,
      high: 11,
      low: 9,
      close: 10.5,
      volume: 100,
      trades: 5,
      startTime: Date.UTC(2026, 2, 25, 12, 0, 5, 0),
      endTime: Date.UTC(2026, 2, 25, 12, 0, 6, 0),
    };
    const secondBar: Bar = {
      ...firstBar,
      high: 12,
      low: 8.5,
      close: 11.5,
      volume: 150,
      trades: 7,
      startTime: Date.UTC(2026, 2, 25, 12, 0, 45, 0),
      endTime: Date.UTC(2026, 2, 25, 12, 0, 46, 0),
    };

    await service.persistLiveBar(firstBar);
    await service.persistLiveBar(secondBar);

    expect(upserts).toHaveLength(2);
    expect(upserts[1]?.[0]).toEqual({
      symbol: "ESH6",
      open: 10,
      high: 12,
      low: 8.5,
      close: 11.5,
      volume: 250,
      trades: 12,
      dollarVolume: 0,
      startTime: Date.UTC(2026, 2, 25, 12, 0, 0, 0),
      endTime: Date.UTC(2026, 2, 25, 12, 1, 0, 0),
    });
    expect(checkpoints.at(-1)).toEqual({
      symbol: "ESH6",
      lastSeenBarTs: secondBar.startTime,
    });
  });

  test("returns disabled results for provider backfill requests", async () => {
    const nowMs = Date.UTC(2026, 2, 25, 12, 0, 0, 0);
    const dateNowSpy = spyOn(Date, "now").mockReturnValue(nowMs);
    const metricSpy = spyOn(telemetry, "metric").mockImplementation(() => {});

    const service = new RecoveryService(
      {
        init: async () => undefined,
        upsertBars: async () => undefined,
        getBars: async () => [],
        getLatestTimestamp: async () => null,
        getStats: async () => ({
          symbol: "ESH6",
          timeframe: RECOVERY_TIMEFRAME,
          barCount: 0,
          oldestBarTs: null,
          newestBarTs: null,
        }),
      },
      {
        setRecoveryCheckpoint: async () => undefined,
        getRecoveryCheckpoint: async () => null,
        getAllRecoveryCheckpoints: async () => ({}),
        writeBarsForRecovery: async () => undefined,
      } as any,
    );

    try {
      const results = await service.backfillSymbolsFromProvider(["ESH6"], {
        source: "manual",
        endMs: nowMs,
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.providerBars).toBe(0);
      expect(results[0]?.error).toContain("Provider REST backfill is disabled");
      expect(metricSpy.mock.calls.some((call) => call[0].tags?.status === "disabled")).toBe(true);
    } finally {
      dateNowSpy.mockRestore();
      mock.restore();
    }
  });
});
