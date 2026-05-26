import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  recordJobFinished,
  recordJobStarted,
} from "@/utils/job_observability.js";
import { logger } from "@/utils/logger.js";

const originalNodeEnv = Bun.env.NODE_ENV;

describe("job observability", () => {
  afterEach(() => {
    Bun.env.NODE_ENV = originalNodeEnv;
  });

  test("emits stable job start and completion metric logs", () => {
    Bun.env.NODE_ENV = "production";
    const logSpy = spyOn(logger, "info").mockImplementation(() => {});
    spyOn(Date, "now").mockReturnValue(1_250);

    recordJobStarted({
      jobName: "snapshot-refresh",
      trigger: "trigger.dev",
      runId: "run-1",
    });
    recordJobFinished({
      jobName: "snapshot-refresh",
      trigger: "trigger.dev",
      runId: "run-1",
      status: "success",
      startedAt: 1_000,
      counts: {
        symbols: 3,
        symbolsUpdated: 3,
      },
    });

    expect(logSpy).toHaveBeenCalledWith("metric", {
      metric: "swordfish.job.run_started",
      metricType: "counter",
      value: 1,
      tags: {
        job_name: "snapshot-refresh",
        trigger: "trigger.dev",
      },
      timestamp: 1_250,
    });
    expect(logSpy).toHaveBeenCalledWith("metric", {
      metric: "swordfish.job.run",
      metricType: "counter",
      value: 1,
      tags: {
        job_name: "snapshot-refresh",
        status: "success",
        trigger: "trigger.dev",
      },
      timestamp: 1_250,
    });
    expect(logSpy).toHaveBeenCalledWith("metric", {
      metric: "swordfish.job.duration_ms",
      metricType: "distribution",
      value: 250,
      tags: {
        job_name: "snapshot-refresh",
        status: "success",
        trigger: "trigger.dev",
      },
      timestamp: 1_250,
    });
  });
});
