function getEnvVar(key: string): string {
  const value = Bun.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getOptionalEnvVar(key: string): string | undefined {
  const value = Bun.env[key];
  return value && value.length > 0 ? value : undefined;
}

function getOptionalEnvVarAsInt(key: string): number | undefined {
  const value = getOptionalEnvVar(key);
  if (value === undefined) return undefined;

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number`);
  }
  return parsed;
}

function getOptionalEnvVarAsBoolean(key: string): boolean | undefined {
  const value = getOptionalEnvVar(key);
  if (value === undefined) return undefined;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Environment variable ${key} must be a valid boolean`);
}

function getEnvVarAsInt(key: string): number {
  const value = getEnvVar(key);
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number`);
  }
  return parsed;
}

// Parse REDIS_URL (Railway format) or fall back to REDIS_HOST/REDIS_PORT (local Docker)
function getRedisConfig(): { host: string; port: number; password?: string } {
  const redisUrl = Bun.env.REDIS_URL;
  if (redisUrl) {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port, 10) || 6379,
      password: url.password || undefined,
    };
  }
  return {
    host: getEnvVar("REDIS_HOST"),
    port: getEnvVarAsInt("REDIS_PORT"),
  };
}

const redisConfig = getRedisConfig();

export const MASSIVE_API_KEY = getEnvVar("MASSIVE_API_KEY");
export const MASSIVE_API_URL = getEnvVar("MASSIVE_API_URL");
export const HUB_HOST = getOptionalEnvVar("HUB_HOST") ?? "::";
export const HUB_PORT = getEnvVarAsInt("HUB_PORT");
export const REDIS_HOST = redisConfig.host;
export const REDIS_PORT = redisConfig.port;
export const REDIS_PASSWORD = redisConfig.password;
export const DATABASE_URL = getOptionalEnvVar("DATABASE_URL");
export const HUB_API_KEY = getEnvVar("HUB_API_KEY");
export const HUB_ALLOWED_ORIGINS = getOptionalEnvVar("HUB_ALLOWED_ORIGINS");
export const HUB_ADMIN_ALLOWED_ORIGINS = getOptionalEnvVar(
  "HUB_ADMIN_ALLOWED_ORIGINS",
);
export const HUB_PUBLIC_RATE_LIMIT_WINDOW_MS =
  getOptionalEnvVarAsInt("HUB_PUBLIC_RATE_LIMIT_WINDOW_MS");
export const HUB_PUBLIC_RATE_LIMIT_MAX =
  getOptionalEnvVarAsInt("HUB_PUBLIC_RATE_LIMIT_MAX");
export const HUB_ADMIN_RATE_LIMIT_WINDOW_MS =
  getOptionalEnvVarAsInt("HUB_ADMIN_RATE_LIMIT_WINDOW_MS");
export const HUB_ADMIN_RATE_LIMIT_MAX =
  getOptionalEnvVarAsInt("HUB_ADMIN_RATE_LIMIT_MAX");
export const HUB_ENABLE_SCHEDULED_JOBS =
  getOptionalEnvVarAsBoolean("HUB_ENABLE_SCHEDULED_JOBS") ?? true;
export const HUB_BOOTSTRAP_FRONT_MONTHS_ON_STARTUP =
  getOptionalEnvVarAsBoolean("HUB_BOOTSTRAP_FRONT_MONTHS_ON_STARTUP") ?? true;
export const HUB_BOOTSTRAP_SNAPSHOTS_ON_STARTUP =
  getOptionalEnvVarAsBoolean("HUB_BOOTSTRAP_SNAPSHOTS_ON_STARTUP") ?? true;
export const HUB_REBUILD_HOT_CACHE_ON_STARTUP =
  getOptionalEnvVarAsBoolean("HUB_REBUILD_HOT_CACHE_ON_STARTUP") ?? false;
export const HUB_DISABLE_PROVIDER_CONNECTION =
  getOptionalEnvVarAsBoolean("HUB_DISABLE_PROVIDER_CONNECTION") ?? false;
export const DATA_QUALITY_GAP_THRESHOLD_MS =
  getOptionalEnvVarAsInt("DATA_QUALITY_GAP_THRESHOLD_MS") ?? 90_000;
export const DATA_QUALITY_SPIKE_THRESHOLD_PCT =
  Number(getOptionalEnvVar("DATA_QUALITY_SPIKE_THRESHOLD_PCT") ?? "0.25");

if (
  !Number.isFinite(DATA_QUALITY_SPIKE_THRESHOLD_PCT) ||
  DATA_QUALITY_SPIKE_THRESHOLD_PCT <= 0
) {
  throw new Error(
    "Environment variable DATA_QUALITY_SPIKE_THRESHOLD_PCT must be a positive number",
  );
}
