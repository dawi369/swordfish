import { Sentry, sentryEnabled } from "@/utils/sentry.js";
import { logger } from "@/utils/logger.js";

type MetricType = "counter" | "gauge" | "distribution";

interface MetricPayload {
  name: string;
  type: MetricType;
  value: number;
  tags?: Record<string, string | number | boolean | null | undefined>;
  timestamp?: number;
}

function cleanTags(
  tags?: MetricPayload["tags"],
): Record<string, string | number | boolean> {
  const cleaned: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (value !== null && value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

export function emitMetric(payload: MetricPayload): void {
  if (Bun.env.NODE_ENV === "test") {
    return;
  }

  logger.info("metric", {
    metric: payload.name,
    metricType: payload.type,
    value: payload.value,
    tags: cleanTags(payload.tags),
    timestamp: payload.timestamp ?? Date.now(),
  });
}

export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!sentryEnabled) {
    return;
  }

  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level: "info",
  });
}

export const telemetry = {
  metric: emitMetric,
  breadcrumb: addBreadcrumb,
};
