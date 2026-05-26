import type { OperationalRunStatus } from "@/types/operational.types.js";
import { telemetry } from "@/utils/telemetry.js";

type CompletedJobStatus = Exclude<OperationalRunStatus, "started">;

interface JobTelemetryInput {
  jobName: string;
  trigger: string;
  runId: string;
}

interface JobCompletionTelemetryInput extends JobTelemetryInput {
  status: CompletedJobStatus;
  startedAt: number;
  counts?: Record<string, number>;
}

export function recordJobStarted({
  jobName,
  trigger,
  runId,
}: JobTelemetryInput): void {
  telemetry.breadcrumb("job", "started", {
    jobName,
    trigger,
    runId,
  });
  telemetry.metric({
    name: "swordfish.job.run_started",
    type: "counter",
    value: 1,
    tags: {
      job_name: jobName,
      trigger,
    },
  });
}

export function recordJobFinished({
  jobName,
  trigger,
  runId,
  status,
  startedAt,
  counts,
}: JobCompletionTelemetryInput): void {
  const durationMs = Math.max(0, Date.now() - startedAt);

  telemetry.breadcrumb("job", "finished", {
    jobName,
    trigger,
    runId,
    status,
    durationMs,
    counts,
  });
  telemetry.metric({
    name: "swordfish.job.run",
    type: "counter",
    value: 1,
    tags: {
      job_name: jobName,
      status,
      trigger,
    },
  });
  telemetry.metric({
    name: "swordfish.job.duration_ms",
    type: "distribution",
    value: durationMs,
    tags: {
      job_name: jobName,
      status,
      trigger,
    },
  });
}
