import * as Sentry from "@sentry/bun";

const dsn = Bun.env.SENTRY_DSN;
const tracesSampleRate = Number(Bun.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1");
const environment = Bun.env.SENTRY_ENVIRONMENT ?? Bun.env.NODE_ENV ?? "development";
const release = Bun.env.SENTRY_RELEASE;

export const sentryEnabled = Boolean(dsn);

export function buildSentryInitOptions(env: Record<string, string | undefined>) {
  const envDsn = env.SENTRY_DSN;
  if (!envDsn) {
    return null;
  }

  return {
    dsn: envDsn,
    enabled: env.NODE_ENV === "production",
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? "development",
    release: env.SENTRY_RELEASE,
    tracesSampleRate: Number(env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    serverName: "mk3-backend",
  };
}

export function initSentry() {
  const options = buildSentryInitOptions({
    SENTRY_DSN: dsn,
    SENTRY_ENVIRONMENT: environment,
    SENTRY_RELEASE: release,
    SENTRY_TRACES_SAMPLE_RATE: Bun.env.SENTRY_TRACES_SAMPLE_RATE,
    NODE_ENV: Bun.env.NODE_ENV,
  });
  if (!options) {
    return;
  }

  Sentry.init(options);
}

export async function flushSentry(timeoutMs = 2000) {
  if (!sentryEnabled) {
    return;
  }

  await Sentry.flush(timeoutMs);
}

export function captureExceptionWithContext(
  error: unknown,
  context: {
    tags?: Record<string, string | number | boolean | null | undefined>;
    extra?: Record<string, unknown>;
  } = {},
) {
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context.tags ?? {})) {
      if (value !== null && value !== undefined) {
        scope.setTag(key, value);
      }
    }
    if (context.extra) {
      scope.setContext("mk3", context.extra);
    }
    Sentry.captureException(error);
  });
}

export function captureMessageWithContext(
  message: string,
  context: {
    level?: "fatal" | "error" | "warning" | "log" | "info" | "debug";
    tags?: Record<string, string | number | boolean | null | undefined>;
    extra?: Record<string, unknown>;
  } = {},
) {
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context.tags ?? {})) {
      if (value !== null && value !== undefined) {
        scope.setTag(key, value);
      }
    }
    if (context.extra) {
      scope.setContext("mk3", context.extra);
    }
    Sentry.captureMessage(message, context.level);
  });
}

export { Sentry };
