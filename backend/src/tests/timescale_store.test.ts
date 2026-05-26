import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { timescaleStore } from "@/server/data/timescale_store.js";
import type { Bar } from "@/types/common.types.js";
import type { OperationalRunRecord } from "@/types/operational.types.js";

const runTimescaleTests = Bun.env.RUN_TIMESCALE_TESTS === "1";

/**
 * TimescaleDB Store Tests
 *
 * Run with: bun test src/tests/timescale_store.test.ts
 *
 * NOTE: Requires TimescaleDB to be running.
 */

describe("TimescaleStore", () => {
  const testSymbol = "TEST_TIMESCALE_XYZ";
  let initialized = false;

  beforeAll(async () => {
    if (!runTimescaleTests) {
      return;
    }
    await timescaleStore.init();
    initialized = timescaleStore.isConnected;
    if (!initialized) {
      throw new Error(
        "Timescale test runtime requires a reachable Postgres/Timescale instance. Start it with `docker compose --profile durable up -d timescaledb` or provide DATABASE_URL.",
      );
    }
  });

  afterAll(async () => {
    if (!runTimescaleTests) {
      return;
    }
    await timescaleStore.close();
  });

  describe("connection", () => {
    test.skipIf(runTimescaleTests)("recordOperationalRun no-ops when disabled", async () => {
      const recorded = await timescaleStore.recordOperationalRun({
        runId: "test-disabled-operational-run",
        runType: "job",
        name: "test-job",
        status: "success",
        trigger: "test",
        startedAt: Date.now(),
        completedAt: Date.now(),
        durationMs: 1,
      });

      expect(recorded).toBe(false);
    });

    test.skipIf(runTimescaleTests)("recordDurableQualitySummary no-ops when disabled", async () => {
      const recorded = await timescaleStore.recordDurableQualitySummary({
        symbol: "ESH6",
        startMs: 1,
        endMs: 2,
        barCount: 0,
        gapCount: 0,
        spikeCount: 0,
        invalidOhlcCount: 0,
        zeroVolumeCount: 0,
        negativeVolumeCount: 0,
        oldestBarTs: null,
        newestBarTs: null,
      });

      expect(recorded).toBe(false);
    });

    test.skipIf(runTimescaleTests)("recordIngestionRun no-ops when disabled", async () => {
      const recorded = await timescaleStore.recordIngestionRun({
        runId: "test-disabled-ingestion-run",
        source: "flat_file",
        status: "success",
        startedAt: Date.now(),
        completedAt: Date.now(),
        symbolCount: 1,
        barCount: 10,
      });

      expect(recorded).toBe(false);
    });

    test.skipIf(!runTimescaleTests)("isConnected returns boolean", () => {
      expect(typeof timescaleStore.isConnected).toBe("boolean");
    });

    test.skipIf(!runTimescaleTests)("ping returns true when connected", async () => {
      const result = await timescaleStore.ping();
      expect(result).toBe(true);
    });
  });

  describe("bars_1m", () => {
    test.skipIf(!runTimescaleTests)("upserts and reads canonical 1m bars", async () => {
      const startTime = Date.now();
      const bar: Bar = {
        symbol: testSymbol,
        open: 120,
        high: 125,
        low: 119,
        close: 124,
        volume: 500,
        trades: 42,
        startTime,
        endTime: startTime + 60000,
        dollarVolume: 62000,
      };

      await expect(timescaleStore.upsertBar1m(bar, "live_ws")).resolves.toBe(1);

      const bars = await timescaleStore.getBars1mRange(
        testSymbol,
        startTime - 1,
        startTime + 1,
      );

      expect(bars).toHaveLength(1);
      expect(bars[0]).toEqual(expect.objectContaining({
        symbol: testSymbol,
        close: 124,
        trades: 42,
      }));
    });

    test.skipIf(!runTimescaleTests)("upserts multiple canonical 1m bars", async () => {
      const bars: Bar[] = [
        {
          symbol: testSymbol,
          open: 102,
          high: 108,
          low: 101,
          close: 106,
          volume: 1500,
          trades: 75,
          startTime: Date.now() + 60000,
          endTime: Date.now() + 120000,
          dollarVolume: 159000,
        },
        {
          symbol: testSymbol,
          open: 106,
          high: 110,
          low: 105,
          close: 109,
          volume: 2000,
          trades: 100,
          startTime: Date.now() + 120000,
          endTime: Date.now() + 180000,
          dollarVolume: 218000,
        },
      ];

      await expect(timescaleStore.upsertBars1m(bars, "live_ws")).resolves.toBe(2);

      const history = await timescaleStore.getBars1mRange(
        testSymbol,
        bars[0]!.startTime - 1,
        bars[1]!.startTime + 1,
      );

      expect(history).toHaveLength(2);
    });
  });

  describe("recordOperationalRun", () => {
    test.skipIf(!runTimescaleTests)("upserts operational run state", async () => {
      const startedAt = Date.now();
      const baseRun: OperationalRunRecord = {
        runId: `test-operational-run-${startedAt}`,
        runType: "job",
        name: "test-job",
        status: "started",
        trigger: "test",
        startedAt,
        completedAt: null,
        durationMs: null,
        counts: {},
        error: null,
        metadata: { phase: "started" },
      };

      await expect(timescaleStore.recordOperationalRun(baseRun)).resolves.toBe(true);
      await expect(
        timescaleStore.recordOperationalRun({
          ...baseRun,
          status: "success",
          completedAt: startedAt + 25,
          durationMs: 25,
          counts: { updated: 1 },
          metadata: { phase: "completed" },
        }),
      ).resolves.toBe(true);
    });
  });

  describe("recordIngestionRun", () => {
    test.skipIf(!runTimescaleTests)("upserts ingestion run state", async () => {
      const startedAt = Date.now();
      const runId = `test-ingestion-run-${startedAt}`;

      await expect(
        timescaleStore.recordIngestionRun({
          runId,
          source: "flat_file",
          status: "started",
          startedAt,
          completedAt: null,
          symbolCount: 1,
          barCount: 10,
          metadata: { phase: "started" },
        }),
      ).resolves.toBe(true);
      await expect(
        timescaleStore.recordIngestionRun({
          runId,
          source: "flat_file",
          status: "success",
          startedAt,
          completedAt: startedAt + 25,
          symbolCount: 1,
          barCount: 10,
          metadata: { phase: "completed" },
        }),
      ).resolves.toBe(true);

      const runs = await timescaleStore.getIngestionRuns({
        source: "flat_file",
        status: "success",
        limit: 10,
      });

      expect(runs.some((run) => run.runId === runId)).toBe(true);
    });
  });

  describe("recordDurableQualitySummary", () => {
    test.skipIf(!runTimescaleTests)("upserts quality summary state", async () => {
      const startMs = Date.now();
      const summary = await timescaleStore.getDurableQualitySummary(
        testSymbol,
        startMs - 60_000,
        startMs + 60_000,
        {
          recordSummary: true,
          metadata: { test: true },
        },
      );

      expect(summary.summaryId).toContain(testSymbol);
      expect(typeof summary.recordedAt).toBe("number");
    });
  });
});
