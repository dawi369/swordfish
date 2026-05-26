#!/usr/bin/env bun
/**
 * Verify the production data-layer acceptance gates after DATABASE_URL is wired.
 *
 * Usage:
 *   BACKEND_BASE_URL=https://swordfish-backend-production.up.railway.app \
 *   HUB_API_KEY=... \
 *   bun run verify:production-data-layer
 *
 * Optional:
 *   PRODUCTION_DATA_LAYER_MAX_LIVE_BAR_AGE_MS=7200000
 */

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

type VerifierFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface ProductionDataLayerVerifierOptions {
  baseUrl?: string;
  apiKey?: string;
  maxLiveBarAgeMs?: number;
  nowMs?: number;
  fetcher?: VerifierFetch;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

export interface ProductionDataLayerVerificationResult {
  ok: boolean;
  results: CheckResult[];
}

function createJsonGetter({
  baseUrl,
  apiKey,
  fetcher,
}: {
  baseUrl: string;
  apiKey?: string;
  fetcher: VerifierFetch;
}) {
  return async function getJson<T>(
    path: string,
    options: {
      method?: "GET" | "POST";
      admin?: boolean;
      expectedStatus?: number;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.admin) {
      if (!apiKey) {
        throw new Error("HUB_API_KEY is required for admin verification checks");
      }
      headers["X-API-Key"] = apiKey;
    }

    const response = await fetcher(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
    });
    const body = await response.json().catch(() => ({}));

    const expectedStatus = options.expectedStatus ?? 200;
    if (response.status !== expectedStatus) {
      throw new Error(
        `${options.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`,
      );
    }

    return body as T;
  };
}

function pass(name: string, detail: string): CheckResult {
  return { name, ok: true, detail };
}

function fail(name: string, detail: string): CheckResult {
  return { name, ok: false, detail };
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function checkPublicHealth(
  getJson: ReturnType<typeof createJsonGetter>,
): Promise<CheckResult> {
  const health = await getJson<{
    status: string;
    services?: {
      redis?: string;
      timescaledb?: string;
      massiveWs?: string;
    };
  }>("/health");

  const redisConnected = health.services?.redis === "connected";
  const durableConnected = health.services?.timescaledb === "connected";
  const wsConnected = health.services?.massiveWs === "connected";
  if (!redisConnected || !durableConnected || !wsConnected) {
    return fail(
      "public health serving stores",
      `redis=${health.services?.redis ?? "missing"} timescaledb=${health.services?.timescaledb ?? "missing"} massiveWs=${health.services?.massiveWs ?? "missing"}`,
    );
  }

  return pass(
    "public health serving stores",
    `status=${health.status} redis=${health.services?.redis} timescaledb=${health.services?.timescaledb} massiveWs=${health.services?.massiveWs}`,
  );
}

async function checkAdminHealth(
  getJson: ReturnType<typeof createJsonGetter>,
): Promise<CheckResult> {
  const health = await getJson<{
    durable?: {
      enabled?: boolean;
      connected?: boolean;
      bars1m?: {
        symbolCount?: number;
        barCount?: number;
      };
    };
  }>("/admin/health", { admin: true });

  if (!health.durable?.enabled || !health.durable.connected) {
    return fail(
      "admin health durable store",
      `enabled=${health.durable?.enabled} connected=${health.durable?.connected}`,
    );
  }

  return pass(
    "admin health durable store",
    `symbols=${health.durable.bars1m?.symbolCount ?? 0} bars=${health.durable.bars1m?.barCount ?? 0}`,
  );
}

async function checkDurableSymbols(
  getJson: ReturnType<typeof createJsonGetter>,
): Promise<CheckResult> {
  const payload = await getJson<{
    count: number;
    symbols: Array<{
      symbol: string;
      barCount: number;
      lastBarTs: number | null;
    }>;
  }>("/admin/durable/symbols?limit=25", { admin: true });

  const symbolsWithBars = payload.symbols.filter((symbol) => symbol.barCount > 0);
  if (symbolsWithBars.length === 0) {
    return fail("durable bars_1m rows", "no durable symbols with bars found");
  }

  return pass(
    "durable bars_1m rows",
    `durableSymbols=${payload.count} sample=${symbolsWithBars[0]?.symbol}`,
  );
}

async function checkLiveDurableBars(
  getJson: ReturnType<typeof createJsonGetter>,
  options: {
    maxLiveBarAgeMs: number;
    nowMs: number;
  },
): Promise<CheckResult> {
  const payload = await getJson<{
    count: number;
    bars: Array<{
      symbol: string;
      source: string;
      startTime: number;
    }>;
  }>("/admin/durable/bars/latest?limit=25&source=live_ws", { admin: true });

  const liveBar = payload.bars.find((bar) => bar.source === "live_ws");
  if (!liveBar) {
    return fail(
      "live durable bars_1m rows",
      "no latest durable bars with source=live_ws found",
    );
  }

  const ageMs = options.nowMs - liveBar.startTime;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > options.maxLiveBarAgeMs) {
    return fail(
      "live durable bars_1m rows",
      `latest source=live_ws row is stale or invalid: sample=${liveBar.symbol}:${liveBar.startTime} ageMs=${ageMs} maxAgeMs=${options.maxLiveBarAgeMs}`,
    );
  }

  return pass(
    "live durable bars_1m rows",
    `count=${payload.count} sample=${liveBar.symbol}:${liveBar.startTime} ageMs=${ageMs}`,
  );
}

async function checkCoverage(
  getJson: ReturnType<typeof createJsonGetter>,
): Promise<CheckResult> {
  const coverage = await getJson<{
    summary?: {
      durableSymbols?: number;
      byStatus?: Record<string, number>;
    };
  }>("/admin/coverage", { admin: true });

  const durableSymbols = coverage.summary?.durableSymbols ?? 0;
  if (durableSymbols <= 0) {
    return fail("coverage durable symbol counts", "durableSymbols=0");
  }

  return pass(
    "coverage durable symbol counts",
    `durableSymbols=${durableSymbols} statuses=${JSON.stringify(coverage.summary?.byStatus ?? {})}`,
  );
}

async function checkBackfillDisabled(
  getJson: ReturnType<typeof createJsonGetter>,
): Promise<CheckResult> {
  const payload = await getJson<{
    status?: string;
    providerBars?: number;
  }>("/admin/recovery/backfill", {
    method: "POST",
    admin: true,
    expectedStatus: 410,
  });

  if (payload.status !== "disabled" || payload.providerBars !== 0) {
    return fail(
      "provider REST backfill disabled",
      `status=${payload.status ?? "missing"} providerBars=${payload.providerBars ?? "missing"}`,
    );
  }

  return pass("provider REST backfill disabled", "admin backfill endpoint returns 410 disabled");
}

async function checkHotCacheDryRun(
  getJson: ReturnType<typeof createJsonGetter>,
): Promise<CheckResult> {
  const payload = await getJson<{
    output?: {
      symbols?: number;
      hydratedSymbols?: number;
      barsLoaded?: number;
    };
  }>("/admin/commands/hot-cache-rebuild-dry-run/run", {
    method: "POST",
    admin: true,
  });

  const barsLoaded = payload.output?.barsLoaded ?? 0;
  if (barsLoaded <= 0) {
    return fail(
      "hot cache rebuild dry run",
      `barsLoaded=${barsLoaded} hydratedSymbols=${payload.output?.hydratedSymbols ?? 0}`,
    );
  }

  return pass(
    "hot cache rebuild dry run",
    `symbols=${payload.output?.symbols ?? 0} hydrated=${payload.output?.hydratedSymbols ?? 0} barsLoaded=${barsLoaded}`,
  );
}

export async function runProductionDataLayerVerification(
  options: ProductionDataLayerVerifierOptions = {},
): Promise<ProductionDataLayerVerificationResult> {
  const baseUrl = (options.baseUrl ?? Bun.env.BACKEND_BASE_URL ?? "http://localhost:3001").replace(
    /\/+$/,
    "",
  );
  const getJson = createJsonGetter({
    baseUrl,
    apiKey: options.apiKey ?? Bun.env.HUB_API_KEY,
    fetcher: options.fetcher ?? fetch,
  });
  const log = options.log ?? console.log;
  const errorLog = options.error ?? console.error;
  const maxLiveBarAgeMs =
    options.maxLiveBarAgeMs ??
    parsePositiveNumber(
      Bun.env.PRODUCTION_DATA_LAYER_MAX_LIVE_BAR_AGE_MS,
      20 * 60 * 1000,
    );
  const nowMs = options.nowMs ?? Date.now();
  const checks = [
    checkPublicHealth,
    checkAdminHealth,
    checkDurableSymbols,
    (getJson: ReturnType<typeof createJsonGetter>) =>
      checkLiveDurableBars(getJson, { maxLiveBarAgeMs, nowMs }),
    checkCoverage,
    checkBackfillDisabled,
    checkHotCacheDryRun,
  ];
  const results: CheckResult[] = [];

  log(`Verifying data layer at ${baseUrl}`);

  for (const check of checks) {
    try {
      const result = await check(getJson);
      results.push(result);
      log(`${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.detail}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const result = fail(check.name, detail);
      results.push(result);
      log(`FAIL ${result.name}: ${result.detail}`);
    }
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    errorLog(`\n${failed.length} data-layer verification check(s) failed.`);
    return { ok: false, results };
  }

  log("\nAll production data-layer verification checks passed.");
  return { ok: true, results };
}

if (import.meta.main) {
  runProductionDataLayerVerification().then((result) => {
    if (!result.ok) {
      process.exit(1);
    }
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
