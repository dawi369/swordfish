/**
 * Server-only environment variables.
 * These are NOT exposed to the browser and should only be imported in API routes or server components.
 */

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getOptionalEnv(name: string, value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

// Email configuration is required lazily by email-sending routes/actions.
// Keeping it lazy prevents unrelated API routes from failing during Next build
// when the email provider is not configured in the build environment.
export function getResendApiKey(): string {
  return requireEnv("RESEND_API_KEY", process.env.RESEND_API_KEY);
}

export function getFeatureRequestEmail(): string {
  return requireEnv("FEATURE_REQUEST_EMAIL", process.env.FEATURE_REQUEST_EMAIL);
}

export const MASSIVE_API_KEY = getOptionalEnv("MASSIVE_API_KEY", process.env.MASSIVE_API_KEY);
export const MASSIVE_API_URL =
  getOptionalEnv("MASSIVE_API_URL", process.env.MASSIVE_API_URL) ?? "https://api.massive.com";
export const SENTRY_DSN = getOptionalEnv("SENTRY_DSN", process.env.SENTRY_DSN);
export const HUB_URL = getOptionalEnv("HUB_URL", process.env.HUB_URL) ??
  getOptionalEnv("NEXT_PUBLIC_HUB_URL", process.env.NEXT_PUBLIC_HUB_URL);
export const HUB_API_KEY = getOptionalEnv("HUB_API_KEY", process.env.HUB_API_KEY);
export const ADMIN_PANEL_PASSWORD = getOptionalEnv(
  "ADMIN_PANEL_PASSWORD",
  process.env.ADMIN_PANEL_PASSWORD,
) ?? (process.env.NODE_ENV === "production" ? undefined : "5565");
export const ADMIN_PANEL_SESSION_SECRET =
  getOptionalEnv("ADMIN_PANEL_SESSION_SECRET", process.env.ADMIN_PANEL_SESSION_SECRET) ??
  ADMIN_PANEL_PASSWORD;
export const WAITLIST_RATE_LIMIT_WINDOW_MS = Number(
  getOptionalEnv("WAITLIST_RATE_LIMIT_WINDOW_MS", process.env.WAITLIST_RATE_LIMIT_WINDOW_MS) ??
    "60000"
);
export const WAITLIST_RATE_LIMIT_MAX = Number(
  getOptionalEnv("WAITLIST_RATE_LIMIT_MAX", process.env.WAITLIST_RATE_LIMIT_MAX) ?? "5"
);
export const FEATURE_REQUEST_RATE_LIMIT_WINDOW_MS = Number(
  getOptionalEnv(
    "FEATURE_REQUEST_RATE_LIMIT_WINDOW_MS",
    process.env.FEATURE_REQUEST_RATE_LIMIT_WINDOW_MS
  ) ?? "60000"
);
export const FEATURE_REQUEST_RATE_LIMIT_MAX = Number(
  getOptionalEnv("FEATURE_REQUEST_RATE_LIMIT_MAX", process.env.FEATURE_REQUEST_RATE_LIMIT_MAX) ??
    "5"
);
