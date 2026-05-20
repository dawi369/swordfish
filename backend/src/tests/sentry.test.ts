import { describe, expect, test } from "bun:test";
import { buildSentryInitOptions } from "@/utils/sentry.js";

describe("Sentry configuration", () => {
  test("does not initialize without a DSN", () => {
    expect(buildSentryInitOptions({ NODE_ENV: "production" })).toBeNull();
  });

  test("builds production init options with environment and release", () => {
    expect(
      buildSentryInitOptions({
        NODE_ENV: "production",
        SENTRY_DSN: "https://example@sentry.io/1",
        SENTRY_ENVIRONMENT: "production",
        SENTRY_RELEASE: "abc123",
        SENTRY_TRACES_SAMPLE_RATE: "0.25",
      }),
    ).toEqual({
      dsn: "https://example@sentry.io/1",
      enabled: true,
      environment: "production",
      release: "abc123",
      tracesSampleRate: 0.25,
      serverName: "mk3-backend",
    });
  });
});
