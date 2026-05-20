import { timescaleStore } from "@/server/data/timescale_store.js";
import type {
  OperationalRunRecord,
  OperationalRunStatus,
  OperationalRunType,
} from "@/types/operational.types.js";
import { telemetry } from "@/utils/telemetry.js";

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function createOperationalRunId(
  runType: OperationalRunType,
  name: string,
  startedAt = Date.now(),
): string {
  const random = crypto.randomUUID().slice(0, 8);
  return `${runType}:${sanitizeName(name)}:${startedAt}:${random}`;
}

export async function recordOperationalRun(
  record: OperationalRunRecord,
): Promise<void> {
  await timescaleStore.recordOperationalRun(record);
  telemetry.metric({
    name: "mk3.operational_run.recorded",
    type: "counter",
    value: 1,
    tags: {
      run_type: record.runType,
      name: record.name,
      status: record.status,
      trigger: record.trigger,
    },
  });
}

export async function startOperationalRun({
  runType,
  name,
  trigger,
  metadata,
}: {
  runType: OperationalRunType;
  name: string;
  trigger: string;
  metadata?: Record<string, unknown>;
}): Promise<OperationalRunRecord> {
  const startedAt = Date.now();
  const record: OperationalRunRecord = {
    runId: createOperationalRunId(runType, name, startedAt),
    runType,
    name,
    status: "started",
    trigger,
    startedAt,
    completedAt: null,
    durationMs: null,
    counts: {},
    error: null,
    metadata,
  };

  await recordOperationalRun(record);
  telemetry.breadcrumb("operational_run", "started", {
    runId: record.runId,
    runType: record.runType,
    name: record.name,
    trigger: record.trigger,
  });
  return record;
}

export async function finishOperationalRun(
  record: OperationalRunRecord,
  status: Exclude<OperationalRunStatus, "started">,
  options: {
    counts?: Record<string, number>;
    error?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const completedAt = Date.now();
  const completedRecord: OperationalRunRecord = {
    ...record,
    status,
    completedAt,
    durationMs: completedAt - record.startedAt,
    counts: options.counts ?? record.counts,
    error: options.error ?? null,
    metadata: {
      ...(record.metadata ?? {}),
      ...(options.metadata ?? {}),
    },
  };

  await recordOperationalRun(completedRecord);
  telemetry.metric({
    name: "mk3.operational_run.duration_ms",
    type: "distribution",
    value: completedRecord.durationMs ?? 0,
    tags: {
      run_type: completedRecord.runType,
      name: completedRecord.name,
      status: completedRecord.status,
      trigger: completedRecord.trigger,
    },
  });
}
