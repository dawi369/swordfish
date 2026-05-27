import * as Sentry from "@sentry/nextjs";
import { NEXT_PUBLIC_SENTRY_DSN } from "@/config/env";

const tracesSampleRate = Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1");
const replaySessionSampleRate = Number(
  process.env.NEXT_PUBLIC_SENTRY_REPLAY_SESSION_SAMPLE_RATE ?? "0"
);
const replayOnErrorSampleRate = Number(
  process.env.NEXT_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE ?? "1"
);
const environment =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV;
const release = process.env.NEXT_PUBLIC_SENTRY_RELEASE;

if (NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: NEXT_PUBLIC_SENTRY_DSN,
    enabled: process.env.NODE_ENV === "production",
    environment,
    release,
    tracesSampleRate,
    replaysSessionSampleRate: replaySessionSampleRate,
    replaysOnErrorSampleRate: replayOnErrorSampleRate,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
