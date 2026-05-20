export type OperationalRunType =
  | "job"
  | "recovery"
  | "provider_fetch"
  | "admin_action";

export type OperationalRunStatus =
  | "started"
  | "success"
  | "partial_success"
  | "failed"
  | "skipped";

export interface OperationalRunRecord {
  runId: string;
  runType: OperationalRunType;
  name: string;
  status: OperationalRunStatus;
  trigger: string;
  startedAt: number;
  completedAt?: number | null;
  durationMs?: number | null;
  counts?: Record<string, number>;
  error?: string | null;
  metadata?: Record<string, unknown>;
}
