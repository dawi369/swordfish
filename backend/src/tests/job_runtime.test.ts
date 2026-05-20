import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { dailyClearJob } from "@/jobs/clear_daily.js";
import { frontMonthJob } from "@/jobs/front_month_job.js";
import { monthlySubscriptionJob } from "@/jobs/refresh_subscriptions.js";
import { snapshotJob } from "@/jobs/snapshot_job.js";
import { redisStore } from "@/server/data/redis_store.js";
import { timescaleStore } from "@/server/data/timescale_store.js";
import { hotCacheRebuilder } from "@/services/hot_cache_rebuilder.js";
import {
  initializeJobRuntime,
  shouldBootstrapDailyJob,
  stopJobRuntime,
} from "@/server/job_runtime.js";

describe("job runtime", () => {
  afterEach(() => {
    mock.restore();
  });

  test("treats failed or missing daily runs as needing bootstrap", () => {
    const now = Date.parse("2026-04-03T15:00:00.000Z");

    expect(
      shouldBootstrapDailyJob({ lastRunTime: null, lastSuccess: false }, now),
    ).toBe(true);
    expect(
      shouldBootstrapDailyJob({ lastRunTime: now, lastSuccess: false }, now),
    ).toBe(true);
    expect(
      shouldBootstrapDailyJob({ lastRunTime: now, lastSuccess: true }, now),
    ).toBe(false);
    expect(
      shouldBootstrapDailyJob(
        {
          lastRunTime: Date.parse("2026-04-02T05:30:00.000Z"),
          lastSuccess: true,
        },
        now,
      ),
    ).toBe(true);
  });

  test("bootstraps stale startup caches and enables recurring schedules", async () => {
    const wsClient = { name: "fake-client" } as any;

    const attachClientSpy = spyOn(monthlySubscriptionJob, "attachClient");
    const clearLoadSpy = spyOn(dailyClearJob, "loadStatus").mockResolvedValue();
    const refreshLoadSpy = spyOn(
      monthlySubscriptionJob,
      "loadStatus",
    ).mockResolvedValue();
    const frontMonthLoadSpy = spyOn(frontMonthJob, "loadStatus").mockResolvedValue();
    const snapshotLoadSpy = spyOn(snapshotJob, "loadStatus").mockResolvedValue();
    const snapshotsSpy = spyOn(redisStore, "getAllSnapshots").mockResolvedValue({});
    const snapshotStatusSpy = spyOn(snapshotJob, "getStatus").mockReturnValue({
      lastRunTime: null,
      lastSuccess: false,
      lastError: null,
      symbolsUpdated: 0,
      totalRuns: 0,
    } as any);
    const snapshotRefreshSpy = spyOn(snapshotJob, "runRefresh").mockResolvedValue();
    const frontMonthCacheSpy = spyOn(frontMonthJob, "getCache").mockReturnValue(null);
    const frontMonthStatusSpy = spyOn(frontMonthJob, "getStatus").mockReturnValue({
      lastRunTime: null,
      lastSuccess: false,
      lastError: null,
      productsUpdated: 0,
      totalRuns: 0,
    } as any);
    const frontMonthRefreshSpy = spyOn(frontMonthJob, "runRefresh").mockResolvedValue();
    const clearScheduleSpy = spyOn(dailyClearJob, "schedule").mockImplementation(() => {});
    const refreshScheduleSpy = spyOn(
      monthlySubscriptionJob,
      "schedule",
    ).mockImplementation(() => {});
    const snapshotScheduleSpy = spyOn(snapshotJob, "schedule").mockImplementation(() => {});
    const frontMonthScheduleSpy = spyOn(
      frontMonthJob,
      "schedule",
    ).mockImplementation(() => {});

    await initializeJobRuntime(wsClient, {
      enableScheduledJobs: true,
      bootstrapFrontMonthsOnStartup: true,
      bootstrapSnapshotsOnStartup: true,
      rebuildHotCacheOnStartup: false,
      now: () => Date.parse("2026-04-03T15:00:00.000Z"),
    });

    expect(attachClientSpy).toHaveBeenCalledWith(wsClient);
    expect(clearLoadSpy).toHaveBeenCalled();
    expect(refreshLoadSpy).toHaveBeenCalled();
    expect(frontMonthLoadSpy).toHaveBeenCalled();
    expect(snapshotLoadSpy).toHaveBeenCalled();
    expect(snapshotsSpy).toHaveBeenCalled();
    expect(snapshotStatusSpy).toHaveBeenCalled();
    expect(snapshotRefreshSpy).toHaveBeenCalledTimes(1);
    expect(frontMonthCacheSpy).toHaveBeenCalled();
    expect(frontMonthStatusSpy).toHaveBeenCalled();
    expect(frontMonthRefreshSpy).toHaveBeenCalledTimes(1);
    expect(clearScheduleSpy).toHaveBeenCalledTimes(1);
    expect(refreshScheduleSpy).toHaveBeenCalledWith(wsClient);
    expect(snapshotScheduleSpy).toHaveBeenCalledTimes(1);
    expect(frontMonthScheduleSpy).toHaveBeenCalledTimes(1);
  });

  test("skips fresh bootstraps when caches already match the current eastern day", async () => {
    const now = Date.parse("2026-04-03T15:00:00.000Z");
    const wsClient = { name: "fake-client" } as any;

    spyOn(monthlySubscriptionJob, "attachClient").mockImplementation(() => {});
    spyOn(dailyClearJob, "loadStatus").mockResolvedValue();
    spyOn(monthlySubscriptionJob, "loadStatus").mockResolvedValue();
    spyOn(frontMonthJob, "loadStatus").mockResolvedValue();
    spyOn(snapshotJob, "loadStatus").mockResolvedValue();
    spyOn(redisStore, "getAllSnapshots").mockResolvedValue({
      ESH6: { symbol: "ESH6" },
    } as any);
    const snapshotRefreshSpy = spyOn(snapshotJob, "runRefresh").mockResolvedValue();
    const frontMonthRefreshSpy = spyOn(frontMonthJob, "runRefresh").mockResolvedValue();
    spyOn(snapshotJob, "getStatus").mockReturnValue({
      lastRunTime: now,
      lastSuccess: true,
      lastError: null,
      symbolsUpdated: 1,
      totalRuns: 1,
    } as any);
    spyOn(frontMonthJob, "getCache").mockReturnValue({
      lastUpdated: now,
      products: {
        ES: {
          productCode: "ES",
          frontMonth: "ESM6",
          previousFrontMonth: null,
          volume: 1,
          openInterest: 1,
          confidence: "high",
          source: "volume",
          isRolling: false,
          evaluatedAt: now,
        },
      },
    } as any);
    spyOn(frontMonthJob, "getStatus").mockReturnValue({
      lastRunTime: now,
      lastSuccess: true,
      lastError: null,
      productsUpdated: 1,
      totalRuns: 1,
    } as any);
    const clearScheduleSpy = spyOn(dailyClearJob, "schedule").mockImplementation(() => {});
    const refreshScheduleSpy = spyOn(
      monthlySubscriptionJob,
      "schedule",
    ).mockImplementation(() => {});
    const snapshotScheduleSpy = spyOn(snapshotJob, "schedule").mockImplementation(() => {});
    const frontMonthScheduleSpy = spyOn(
      frontMonthJob,
      "schedule",
    ).mockImplementation(() => {});

    await initializeJobRuntime(wsClient, {
      enableScheduledJobs: false,
      bootstrapFrontMonthsOnStartup: true,
      bootstrapSnapshotsOnStartup: true,
      rebuildHotCacheOnStartup: false,
      now: () => now,
    });

    expect(snapshotRefreshSpy).not.toHaveBeenCalled();
    expect(frontMonthRefreshSpy).not.toHaveBeenCalled();
    expect(clearScheduleSpy).not.toHaveBeenCalled();
    expect(refreshScheduleSpy).not.toHaveBeenCalled();
    expect(snapshotScheduleSpy).not.toHaveBeenCalled();
    expect(frontMonthScheduleSpy).not.toHaveBeenCalled();
  });

  test("can rebuild Redis hot cache from durable bars on startup", async () => {
    const now = Date.parse("2026-04-03T15:00:00.000Z");
    const wsClient = { name: "fake-client" } as any;

    spyOn(monthlySubscriptionJob, "attachClient").mockImplementation(() => {});
    spyOn(dailyClearJob, "loadStatus").mockResolvedValue();
    spyOn(monthlySubscriptionJob, "loadStatus").mockResolvedValue();
    spyOn(frontMonthJob, "loadStatus").mockResolvedValue();
    spyOn(snapshotJob, "loadStatus").mockResolvedValue();
    spyOn(redisStore, "getSubscribedSymbols").mockResolvedValue(["ESH6", "NQH6"]);
    const rebuildSpy = spyOn(
      hotCacheRebuilder,
      "rebuildLatestWindow",
    ).mockResolvedValue({
      symbols: 2,
      hydratedSymbols: 1,
      barsLoaded: 120,
      skippedSymbols: ["NQH6"],
    });
    const operationalRunSpy = spyOn(
      timescaleStore,
      "recordOperationalRun",
    ).mockResolvedValue(true);

    await initializeJobRuntime(wsClient, {
      enableScheduledJobs: false,
      bootstrapFrontMonthsOnStartup: false,
      bootstrapSnapshotsOnStartup: false,
      rebuildHotCacheOnStartup: true,
      now: () => now,
    });

    expect(rebuildSpy).toHaveBeenCalledWith(["ESH6", "NQH6"], {
      dryRun: false,
      nowMs: now,
    });
    expect(operationalRunSpy).toHaveBeenCalledTimes(2);
    expect(operationalRunSpy.mock.calls[1]?.[0].status).toBe("success");
    expect(operationalRunSpy.mock.calls[1]?.[0].counts?.barsLoaded).toBe(120);
  });

  test("does not block startup when hot-cache rebuild fails", async () => {
    const wsClient = { name: "fake-client" } as any;

    spyOn(monthlySubscriptionJob, "attachClient").mockImplementation(() => {});
    spyOn(dailyClearJob, "loadStatus").mockResolvedValue();
    spyOn(monthlySubscriptionJob, "loadStatus").mockResolvedValue();
    spyOn(frontMonthJob, "loadStatus").mockResolvedValue();
    spyOn(snapshotJob, "loadStatus").mockResolvedValue();
    spyOn(redisStore, "getSubscribedSymbols").mockResolvedValue(["ESH6"]);
    spyOn(hotCacheRebuilder, "rebuildLatestWindow").mockRejectedValue(
      new Error("durable unavailable"),
    );
    spyOn(console, "error").mockImplementation(() => {});
    const operationalRunSpy = spyOn(
      timescaleStore,
      "recordOperationalRun",
    ).mockResolvedValue(true);

    await initializeJobRuntime(wsClient, {
      enableScheduledJobs: false,
      bootstrapFrontMonthsOnStartup: false,
      bootstrapSnapshotsOnStartup: false,
      rebuildHotCacheOnStartup: true,
      now: () => Date.parse("2026-04-03T15:00:00.000Z"),
    });

    expect(operationalRunSpy).toHaveBeenCalledTimes(2);
    expect(operationalRunSpy.mock.calls[1]?.[0].status).toBe("failed");
    expect(operationalRunSpy.mock.calls[1]?.[0].error).toBe("durable unavailable");
  });

  test("stops all recurring schedules", () => {
    const clearStopSpy = spyOn(dailyClearJob, "stopSchedule").mockImplementation(() => {});
    const refreshStopSpy = spyOn(
      monthlySubscriptionJob,
      "stopSchedule",
    ).mockImplementation(() => {});
    const snapshotStopSpy = spyOn(snapshotJob, "stopSchedule").mockImplementation(() => {});
    const frontMonthStopSpy = spyOn(
      frontMonthJob,
      "stopSchedule",
    ).mockImplementation(() => {});

    stopJobRuntime();

    expect(clearStopSpy).toHaveBeenCalledTimes(1);
    expect(refreshStopSpy).toHaveBeenCalledTimes(1);
    expect(snapshotStopSpy).toHaveBeenCalledTimes(1);
    expect(frontMonthStopSpy).toHaveBeenCalledTimes(1);
  });
});
