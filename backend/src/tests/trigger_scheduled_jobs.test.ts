import { describe, expect, test } from "bun:test";

const scheduledJobsSource = await Bun.file(
  new URL("../trigger/scheduled_jobs.ts", import.meta.url),
).text();

const triggerConfigSource = await Bun.file(
  new URL("../../trigger.config.ts", import.meta.url),
).text();

describe("Trigger.dev scheduled jobs", () => {
  test("keeps Trigger tasks out of the live Massive WebSocket ownership path", () => {
    expect(scheduledJobsSource).not.toContain("MassiveWSClient");
    expect(scheduledJobsSource).not.toContain("ws_client");
    expect(scheduledJobsSource).not.toContain(".connect(");
  });

  test("keeps subscription refresh bound to the running backend process", () => {
    expect(scheduledJobsSource).toContain(
      'callBackendAdmin("/admin/refresh-subscriptions")',
    );
    expect(scheduledJobsSource).toContain("BACKEND_BASE_URL");
  });

  test("keeps all production schedules backend-bound at task runtime", () => {
    expect(scheduledJobsSource).not.toContain("@/config/env");
    expect(scheduledJobsSource).not.toContain("@/jobs/");
    expect(scheduledJobsSource).toContain(
      'callBackendAdmin("/admin/clear-redis?force=false")',
    );
    expect(scheduledJobsSource).toContain(
      'callBackendAdmin("/admin/refresh-snapshots")',
    );
    expect(scheduledJobsSource).toContain(
      'callBackendAdmin("/admin/refresh-front-months")',
    );
  });

  test("uses the explicit Bun Trigger.dev build configuration", () => {
    expect(triggerConfigSource).toContain('runtime: "bun"');
    expect(triggerConfigSource).toContain("maxDuration");
    expect(triggerConfigSource).toContain('dirs: ["./src/trigger"]');
  });
});
