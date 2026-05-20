import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { logger } from "@/utils/logger.js";
import { telemetry } from "@/utils/telemetry.js";

const originalNodeEnv = Bun.env.NODE_ENV;

describe("telemetry", () => {
  afterEach(() => {
    Bun.env.NODE_ENV = originalNodeEnv;
  });

  test("does not emit metric logs in test mode", () => {
    Bun.env.NODE_ENV = "test";
    const logSpy = spyOn(logger, "info").mockImplementation(() => {});

    telemetry.metric({
      name: "mk3.test.metric",
      type: "counter",
      value: 1,
    });

    expect(logSpy).not.toHaveBeenCalled();
  });

  test("emits structured metric payloads and removes empty tags", () => {
    Bun.env.NODE_ENV = "production";
    const logSpy = spyOn(logger, "info").mockImplementation(() => {});

    telemetry.metric({
      name: "mk3.test.metric",
      type: "gauge",
      value: 2,
      timestamp: 123,
      tags: {
        symbol: "ESH6",
        ok: true,
        empty: null,
        missing: undefined,
      },
    });

    expect(logSpy).toHaveBeenCalledWith("metric", {
      metric: "mk3.test.metric",
      metricType: "gauge",
      value: 2,
      tags: {
        symbol: "ESH6",
        ok: true,
      },
      timestamp: 123,
    });
  });
});
