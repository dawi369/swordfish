import { redisStore } from "@/server/data/redis_store.js";
import { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD } from "@/config/env.js";
import { Redis } from "ioredis";
import { timescaleStore } from "@/server/data/timescale_store.js";
import {
  HUB_HOST,
  HUB_PORT,
  HUB_API_KEY,
  HUB_ALLOWED_ORIGINS,
  HUB_ADMIN_ALLOWED_ORIGINS,
  HUB_PUBLIC_RATE_LIMIT_WINDOW_MS,
  HUB_PUBLIC_RATE_LIMIT_MAX,
  HUB_ADMIN_RATE_LIMIT_WINDOW_MS,
  HUB_ADMIN_RATE_LIMIT_MAX,
} from "@/config/env.js";
import { dailyClearJob } from "@/jobs/clear_daily.js";
import { monthlySubscriptionJob } from "@/jobs/refresh_subscriptions.js";
import { frontMonthJob } from "@/jobs/front_month_job.js";
import { snapshotJob } from "@/jobs/snapshot_job.js";
import type { MassiveWSClient } from "@/server/api/massive/ws_client.js";
import type { Server, ServerWebSocket } from "bun";
import { logger } from "@/utils/logger.js";
import { recoveryService } from "@/services/recovery_service.js";
import { Sentry } from "@/utils/sentry.js";
import { hotCacheRebuilder } from "@/services/hot_cache_rebuilder.js";
import { marketDataRepository } from "@/services/market_data_repository.js";
import type { DurableStoreStats } from "@/server/data/timescale_store.js";
import type { StoredProviderFetchOutcomeRecord } from "@/server/data/timescale_store.js";
import type { Bar } from "@/types/common.types.js";
import type { StoredActiveContracts } from "@/types/contract.types.js";
import {
  finishOperationalRun,
  startOperationalRun,
} from "@/utils/operational_runs.js";
import { telemetry } from "@/utils/telemetry.js";

let massiveClient: MassiveWSClient | null = null;

export function setMassiveClientForTesting(client: MassiveWSClient | null): void {
  massiveClient = client;
}

// Helper for CORS headers
const baseCorsHeaders = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  Vary: "Origin",
};

const DEV_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3010",
  "http://127.0.0.1:3010",
];

const ALLOWED_ORIGINS = new Set(
  [
    ...(HUB_ALLOWED_ORIGINS?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? []),
    ...(Bun.env.NODE_ENV === "production" ? [] : DEV_ALLOWED_ORIGINS),
  ].map((origin) => origin.replace(/\/+$/, "")),
);

const ADMIN_ALLOWED_ORIGINS = new Set(
  (HUB_ADMIN_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? []
  ).map((origin) => origin.replace(/\/+$/, "")),
);

const ALLOWED_TIMEFRAMES = new Set([
  "1s",
  "15s",
  "30s",
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "1d",
]);

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_RATE_LIMIT_WINDOW_MS = HUB_PUBLIC_RATE_LIMIT_WINDOW_MS ?? 60_000;
const PUBLIC_RATE_LIMIT_MAX = HUB_PUBLIC_RATE_LIMIT_MAX ?? 240;
const ADMIN_RATE_LIMIT_WINDOW_MS = HUB_ADMIN_RATE_LIMIT_WINDOW_MS ?? 60_000;
const ADMIN_RATE_LIMIT_MAX = HUB_ADMIN_RATE_LIMIT_MAX ?? 60;

type RateLimitScope = "public" | "admin";

type AdminJobKey =
  | "dailyClear"
  | "subscriptionRefresh"
  | "snapshotRefresh"
  | "frontMonthRefresh";

interface AdminCommandDefinition {
  id: string;
  label: string;
  description: string;
}

type AdminOpsStatus = "ok" | "warming" | "degraded";

interface RateLimitState {
  count: number;
  resetAt: number;
}

interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds?: number;
}

const rateLimitBuckets = new Map<string, RateLimitState>();

const ADMIN_COMMAND_RUNS_KEY = "admin:command:runs";
const ADMIN_COMMAND_RUN_LIMIT = 50;
const ADMIN_COMMANDS: AdminCommandDefinition[] = [
  {
    id: "health",
    label: "Health",
    description: "Service connectivity, Redis stats, and job health summary.",
  },
  {
    id: "redis-summary",
    label: "Redis summary",
    description: "Hot-store counts and cache freshness without dumping raw keys.",
  },
  {
    id: "jobs-status",
    label: "Jobs status",
    description: "Cron metadata, last run state, and last errors.",
  },
  {
    id: "subscriptions",
    label: "Subscriptions",
    description: "Current upstream and persisted subscription counts.",
  },
  {
    id: "coverage",
    label: "Coverage",
    description: "Classifies subscribed, latest, and durable symbol coverage.",
  },
  {
    id: "front-months-summary",
    label: "Front months",
    description: "Front-month cache status by product.",
  },
  {
    id: "recovery-checkpoints",
    label: "Recovery checkpoints",
    description: "Recovery checkpoint count and newest checkpoint age.",
  },
  {
    id: "hot-cache-rebuild-dry-run",
    label: "Hot cache dry run",
    description: "Checks how many subscribed symbols could rebuild latest-week Redis cache from Timescale.",
  },
  {
    id: "hot-cache-rebuild",
    label: "Hot cache rebuild",
    description: "Rebuilds latest-week Redis cache from durable 1m bars.",
  },
];

function maxTimestamp(values: Array<number | null | undefined>): number | null {
  const timestamps = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

function minTimestamp(values: Array<number | null | undefined>): number | null {
  const timestamps = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return timestamps.length > 0 ? Math.min(...timestamps) : null;
}

function ageMs(timestamp: number | null, now: number): number | null {
  return timestamp ? Math.max(0, now - timestamp) : null;
}

function summarizeAges(timestamps: Array<number | null | undefined>, now: number) {
  const ages = timestamps
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map((timestamp) => Math.max(0, now - timestamp))
    .sort((left, right) => left - right);

  if (ages.length === 0) {
    return {
      count: 0,
      minAgeMs: null,
      medianAgeMs: null,
      maxAgeMs: null,
    };
  }

  return {
    count: ages.length,
    minAgeMs: ages[0] ?? null,
    medianAgeMs: ages[Math.floor(ages.length / 2)] ?? null,
    maxAgeMs: ages[ages.length - 1] ?? null,
  };
}

type SymbolCoverageStatus =
  | "ok"
  | "not_subscribed"
  | "subscribed_no_live_data"
  | "provider_no_data"
  | "stale_contract"
  | "backfill_pending";

interface SymbolCoverageRow {
  symbol: string;
  status: SymbolCoverageStatus;
  subscribed: boolean;
  hasLatest: boolean;
  hasDurableBars: boolean;
  latestBarTs: number | null;
  latestAgeMs: number | null;
  durableLastBarTs: number | null;
  durableAgeMs: number | null;
  durableBarCount: number;
  gapCount: number;
  spikeCount: number;
  providerStatus: "success" | "empty" | "failed" | null;
  providerOutcomeAt: number | null;
}

function buildSymbolCoverage({
  latestBars,
  subscribedSymbols,
  durableStats,
  providerOutcomes,
  activeContracts,
  now,
}: {
  latestBars: Bar[];
  subscribedSymbols: string[];
  durableStats: DurableStoreStats;
  providerOutcomes?: StoredProviderFetchOutcomeRecord[];
  activeContracts?: Record<string, StoredActiveContracts>;
  now: number;
}) {
  const latestBySymbol = new Map(latestBars.map((bar) => [bar.symbol, bar]));
  const subscribed = new Set(subscribedSymbols);
  const durableBySymbol = new Map(
    durableStats.symbols.map((symbolStats) => [symbolStats.symbol, symbolStats]),
  );
  const latestProviderOutcomeBySymbol = new Map<string, StoredProviderFetchOutcomeRecord>();
  for (const outcome of providerOutcomes ?? []) {
    const existing = latestProviderOutcomeBySymbol.get(outcome.symbol);
    if (!existing || outcome.createdAt > existing.createdAt) {
      latestProviderOutcomeBySymbol.set(outcome.symbol, outcome);
    }
  }
  const activeContractSymbols = new Set(
    Object.values(activeContracts ?? {}).flatMap((contractSet) =>
      contractSet.contracts.map((contract) => contract.ticker),
    ),
  );
  const allSymbols = Array.from(
    new Set([
      ...subscribed,
      ...latestBySymbol.keys(),
      ...durableBySymbol.keys(),
      ...latestProviderOutcomeBySymbol.keys(),
    ]),
  ).sort();
  const staleLatestThresholdMs = 15 * 60 * 1000;

  const symbols: SymbolCoverageRow[] = allSymbols.map((symbol) => {
    const latest = latestBySymbol.get(symbol);
    const durable = durableBySymbol.get(symbol);
    const latestAge = ageMs(latest?.startTime ?? null, now);
    const durableAge = ageMs(durable?.lastBarTs ?? null, now);
    const isSubscribed = subscribed.has(symbol);
    const hasLatest = Boolean(latest);
    const hasDurableBars = Boolean(durable && durable.barCount > 0);
    const providerOutcome = latestProviderOutcomeBySymbol.get(symbol);
    const providerReturnedEmpty = providerOutcome?.status === "empty";
    const activeContractKnown =
      activeContractSymbols.size === 0 || activeContractSymbols.has(symbol);
    const staleLatest =
      hasLatest &&
      latestAge !== null &&
      latestAge > staleLatestThresholdMs;

    let status: SymbolCoverageStatus = "ok";
    if (staleLatest && (!isSubscribed || !activeContractKnown)) {
      status = "stale_contract";
    } else if (!isSubscribed) {
      status = "not_subscribed";
    } else if (!hasLatest && !hasDurableBars) {
      status = providerReturnedEmpty ? "provider_no_data" : "backfill_pending";
    } else if (!hasLatest) {
      status = "subscribed_no_live_data";
    } else if (staleLatest) {
      status = "stale_contract";
    } else if (!hasDurableBars && durableStats.enabled) {
      status = "backfill_pending";
    }

    return {
      symbol,
      status,
      subscribed: isSubscribed,
      hasLatest,
      hasDurableBars,
      latestBarTs: latest?.startTime ?? null,
      latestAgeMs: latestAge,
      durableLastBarTs: durable?.lastBarTs ?? null,
      durableAgeMs: durableAge,
      durableBarCount: durable?.barCount ?? 0,
      gapCount: durable?.gapCount ?? 0,
      spikeCount: durable?.spikeCount ?? 0,
      providerStatus: providerOutcome?.status ?? null,
      providerOutcomeAt: providerOutcome?.createdAt ?? null,
    };
  });

  const byStatus = symbols.reduce<Record<SymbolCoverageStatus, number>>(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    {
      ok: 0,
      not_subscribed: 0,
      subscribed_no_live_data: 0,
      provider_no_data: 0,
      stale_contract: 0,
      backfill_pending: 0,
    },
  );

  return {
    summary: {
      totalSymbols: symbols.length,
      subscribedSymbols: subscribed.size,
      latestSymbols: latestBySymbol.size,
      durableSymbols: durableBySymbol.size,
      staleSymbols: byStatus.stale_contract,
      gapSymbols: symbols.filter((row) => row.gapCount > 0).length,
      spikeSymbols: symbols.filter((row) => row.spikeCount > 0).length,
      byStatus,
    },
    symbols,
  };
}

function classifyJob(job: { status: { lastRunTime: number | null; lastSuccess: boolean; lastError: string | null } }) {
  if (!job.status.lastRunTime) return "not_run";
  if (job.status.lastSuccess) return "ok";
  return "failed";
}

function buildJobState() {
  return {
    dailyClear: {
      ...dailyClearJob.getSchedule(),
      status: dailyClearJob.getStatus(),
    },
    subscriptionRefresh: {
      ...monthlySubscriptionJob.getSchedule(),
      status: monthlySubscriptionJob.getStatus(),
    },
    snapshotRefresh: {
      ...snapshotJob.getSchedule(),
      status: snapshotJob.getStatus(),
    },
    frontMonthRefresh: {
      ...frontMonthJob.getSchedule(),
      status: frontMonthJob.getStatus(),
    },
  } satisfies Record<AdminJobKey, unknown>;
}

function getCurrentSubscriptions() {
  return typeof massiveClient?.getSubscriptions === "function"
    ? massiveClient.getSubscriptions()
    : [];
}

async function buildAdminOpsPayload() {
  const now = Date.now();
  let redisOk = false;
  let timescaleOk = false;
  const timescaleEnabled = timescaleStore.isEnabled;

  try {
    redisOk = (await redisStore.ping()) === "PONG";
  } catch {
    redisOk = false;
  }

  if (timescaleEnabled) {
    try {
      timescaleOk = await timescaleStore.ping();
    } catch {
      timescaleOk = false;
    }
  }

  const [
    redisStats,
    latestBars,
    snapshots,
    activeContracts,
    recoveryCheckpoints,
    subscribedSymbols,
  ] = await Promise.all([
    redisStore.getStats(),
    redisStore.getAllLatestArray(),
    redisStore.getAllSnapshots(),
    redisStore.getAllActiveContracts(),
    redisStore.getAllRecoveryCheckpoints(),
    redisStore.getSubscribedSymbols(),
  ]);

  const snapshotTimestamps = Object.values(snapshots).map(
    (snapshot) => snapshot.timestamp,
  );
  const activeContractTimestamps = Object.values(activeContracts).map(
    (contractSet) => contractSet.updatedAt,
  );
  const recoveryTimestamps = Object.values(recoveryCheckpoints).map(
    (checkpoint) => checkpoint.updatedAt,
  );
  const latestBarTimestamps = latestBars.map((bar) => bar.startTime);
  const newestBarTime = maxTimestamp(latestBarTimestamps);
  const oldestBarTime = minTimestamp(latestBarTimestamps);
  const durableStats = await timescaleStore.getDurableStats(subscribedSymbols, {
    startMs: now - ONE_WEEK_MS,
    endMs: now,
  });
  const providerOutcomes = await timescaleStore.getProviderFetchOutcomes({
    limit: 500,
  });
  const coverage = buildSymbolCoverage({
    latestBars,
    subscribedSymbols,
    durableStats,
    providerOutcomes,
    activeContracts,
    now,
  });
  const latestSnapshotTime = maxTimestamp(snapshotTimestamps);
  const oldestSnapshotTime = minTimestamp(snapshotTimestamps);
  const latestActiveContractTime = maxTimestamp(activeContractTimestamps);
  const latestRecoveryCheckpointTime = maxTimestamp(recoveryTimestamps);
  const wsConnected = massiveClient?.isConnected() || false;
  const currentSubscriptions = getCurrentSubscriptions();
  const servicesHealthy =
    redisOk && wsConnected && (!timescaleEnabled || timescaleOk);
  const jobs = buildJobState();
  const jobStates = Object.fromEntries(
    Object.entries(jobs).map(([key, job]) => [
      key,
      classifyJob(
        job as {
          status: {
            lastRunTime: number | null;
            lastSuccess: boolean;
            lastError: string | null;
          };
        },
      ),
    ]),
  );
  const failedJobs = Object.entries(jobStates)
    .filter(([, state]) => state === "failed")
    .map(([key]) => key);
  const pendingJobs = Object.entries(jobStates)
    .filter(([, state]) => state === "not_run")
    .map(([key]) => key);
  const status: AdminOpsStatus = !servicesHealthy
    ? "degraded"
    : failedJobs.length > 0
      ? "degraded"
      : coverage.summary.staleSymbols > 0 || coverage.summary.spikeSymbols > 0
        ? "degraded"
      : pendingJobs.length > 0
        ? "warming"
        : "ok";

  telemetry.metric({
    name: "mk3.admin_ops.status",
    type: "gauge",
    value: status === "ok" ? 1 : status === "warming" ? 0.5 : 0,
    tags: {
      status,
      redis: redisOk,
      timescale_enabled: timescaleEnabled,
      timescale_connected: timescaleOk,
      massive_ws: wsConnected,
    },
  });
  telemetry.metric({
    name: "mk3.data_coverage.stale_symbols",
    type: "gauge",
    value: coverage.summary.staleSymbols,
  });
  telemetry.metric({
    name: "mk3.data_coverage.spike_symbols",
    type: "gauge",
    value: coverage.summary.spikeSymbols,
  });

  return {
    status,
    timestamp: now,
    services: {
      redis: redisOk ? "connected" : "disconnected",
      timescaledb: timescaleEnabled
        ? timescaleOk
          ? "connected"
          : "disconnected"
        : "disabled",
      massiveWs: wsConnected ? "connected" : "disconnected",
    },
    redis: {
      ...redisStats,
      latestBarCount: latestBars.length,
      snapshotCount: Object.keys(snapshots).length,
      activeContractProductCount: Object.keys(activeContracts).length,
      recoveryCheckpointCount: Object.keys(recoveryCheckpoints).length,
      subscribedSymbolCount: subscribedSymbols.length,
      streamLength: redisStats.streamLength,
      dbSize: redisStats.dbSize,
      usedMemoryBytes: redisStats.usedMemoryBytes,
      indexCounts: redisStats.indexCounts,
    },
    durable: durableStats,
    coverage,
    freshness: {
      latestBars: {
        newestTimestamp: newestBarTime,
        newestAgeMs: ageMs(newestBarTime, now),
        oldestTimestamp: oldestBarTime,
        oldestAgeMs: ageMs(oldestBarTime, now),
        ageSummary: summarizeAges(latestBarTimestamps, now),
      },
      snapshots: {
        newestTimestamp: latestSnapshotTime,
        newestAgeMs: ageMs(latestSnapshotTime, now),
        oldestTimestamp: oldestSnapshotTime,
        oldestAgeMs: ageMs(oldestSnapshotTime, now),
        ageSummary: summarizeAges(snapshotTimestamps, now),
      },
      activeContracts: {
        newestTimestamp: latestActiveContractTime,
        newestAgeMs: ageMs(latestActiveContractTime, now),
        ageSummary: summarizeAges(activeContractTimestamps, now),
      },
      recoveryCheckpoints: {
        newestTimestamp: latestRecoveryCheckpointTime,
        newestAgeMs: ageMs(latestRecoveryCheckpointTime, now),
        ageSummary: summarizeAges(recoveryTimestamps, now),
      },
    },
    jobs,
    jobSummary: {
      states: jobStates,
      failedJobs,
      pendingJobs,
      totalJobs: Object.keys(jobs).length,
      successfulJobs: Object.values(jobStates).filter((state) => state === "ok").length,
    },
    subscriptions: {
      upstreamCount: currentSubscriptions.length,
      totalSymbols: currentSubscriptions.reduce(
        (sum, sub) => sum + sub.symbols.length,
        0,
      ),
      persistedSymbols: subscribedSymbols,
    },
    frontMonths: frontMonthJob.getCache(),
  };
}

async function persistAdminCommandRun(run: unknown): Promise<void> {
  try {
    await redisStore.redis
      .multi()
      .lpush(ADMIN_COMMAND_RUNS_KEY, JSON.stringify(run))
      .ltrim(ADMIN_COMMAND_RUNS_KEY, 0, ADMIN_COMMAND_RUN_LIMIT - 1)
      .exec();
  } catch (err) {
    logger.warn("Failed to persist admin command run", { error: String(err) });
  }
}

async function runAdminCommand(commandId: string) {
  const definition = ADMIN_COMMANDS.find((command) => command.id === commandId);
  if (!definition) {
    return null;
  }

  const startedAt = Date.now();
  const auditRun = await startOperationalRun({
    runType: "admin_action",
    name: commandId,
    trigger: "api",
    metadata: {
      command: definition,
    },
  });
  const ops = await buildAdminOpsPayload();
  let output: unknown;
  let lines: string[] = [];
  let status: "success" | "failed" = "success";
  let auditError: string | null = null;

  try {
    switch (commandId) {
      case "health":
        output = {
          status: ops.status,
          services: ops.services,
          redis: {
            date: ops.redis.date,
            barCount: ops.redis.barCount,
            symbolCount: ops.redis.symbolCount,
          },
          failedJobs: Object.values(ops.jobs)
            .filter((job) => !(job as { status: { lastSuccess: boolean } }).status.lastSuccess)
            .map((job) => (job as { label: string }).label),
        };
        lines = [
          `status=${ops.status}`,
          `redis=${ops.services.redis}`,
          `massiveWs=${ops.services.massiveWs}`,
          `symbols=${ops.redis.symbolCount}`,
        ];
        break;
      case "redis-summary":
        output = ops.redis;
        lines = [
          `date=${ops.redis.date}`,
          `latestBars=${ops.redis.latestBarCount}`,
          `snapshots=${ops.redis.snapshotCount}`,
          `activeContractProducts=${ops.redis.activeContractProductCount}`,
          `recoveryCheckpoints=${ops.redis.recoveryCheckpointCount}`,
        ];
        break;
      case "jobs-status":
        output = ops.jobs;
        lines = Object.values(ops.jobs).map((job) => {
          const typedJob = job as {
            label: string;
            scheduled: boolean;
            status: { lastSuccess: boolean; totalRuns: number; lastError: string | null };
          };
          return `${typedJob.label}: success=${typedJob.status.lastSuccess} runs=${typedJob.status.totalRuns} scheduled=${typedJob.scheduled} error=${typedJob.status.lastError ?? "none"}`;
        });
        break;
      case "subscriptions":
        output = ops.subscriptions;
        lines = [
          `upstreamSubscriptions=${ops.subscriptions.upstreamCount}`,
          `upstreamSymbols=${ops.subscriptions.totalSymbols}`,
          `persistedSymbols=${ops.subscriptions.persistedSymbols.length}`,
        ];
        break;
      case "coverage":
        output = ops.coverage;
        lines = [
          `totalSymbols=${ops.coverage.summary.totalSymbols}`,
          `ok=${ops.coverage.summary.byStatus.ok}`,
          `stale=${ops.coverage.summary.byStatus.stale_contract}`,
          `providerNoData=${ops.coverage.summary.byStatus.provider_no_data}`,
          `backfillPending=${ops.coverage.summary.byStatus.backfill_pending}`,
          `gapSymbols=${ops.coverage.summary.gapSymbols}`,
          `spikeSymbols=${ops.coverage.summary.spikeSymbols}`,
        ];
        break;
      case "front-months-summary": {
        const products = ops.frontMonths?.products ?? {};
        output = {
          lastUpdated: ops.frontMonths?.lastUpdated ?? null,
          productCount: Object.keys(products).length,
          products,
        };
        lines = [
          `lastUpdated=${ops.frontMonths?.lastUpdated ?? "never"}`,
          `products=${Object.keys(products).length}`,
          ...Object.entries(products)
            .slice(0, 20)
            .map(([code, value]) => {
              const frontMonth = (value as { frontMonth?: string }).frontMonth ?? "unknown";
              return `${code}=${frontMonth}`;
            }),
        ];
        break;
      }
      case "recovery-checkpoints":
        output = ops.freshness.recoveryCheckpoints;
        lines = [
          `checkpoints=${ops.redis.recoveryCheckpointCount}`,
          `newestTimestamp=${ops.freshness.recoveryCheckpoints.newestTimestamp ?? "never"}`,
          `newestAgeMs=${ops.freshness.recoveryCheckpoints.newestAgeMs ?? "unknown"}`,
        ];
        break;
      case "hot-cache-rebuild-dry-run": {
        const result = await hotCacheRebuilder.rebuildLatestWindow(
          ops.subscriptions.persistedSymbols,
          {
            dryRun: true,
          },
        );
        output = result;
        lines = [
          `symbols=${result.symbols}`,
          `hydratedSymbols=${result.hydratedSymbols}`,
          `barsLoaded=${result.barsLoaded}`,
          `skippedSymbols=${result.skippedSymbols.length}`,
        ];
        break;
      }
      case "hot-cache-rebuild": {
        const result = await hotCacheRebuilder.rebuildLatestWindow(
          ops.subscriptions.persistedSymbols,
          {
            dryRun: false,
          },
        );
        output = result;
        lines = [
          `symbols=${result.symbols}`,
          `hydratedSymbols=${result.hydratedSymbols}`,
          `barsLoaded=${result.barsLoaded}`,
          `skippedSymbols=${result.skippedSymbols.length}`,
        ];
        break;
      }
      default:
        output = {};
        lines = [];
    }
  } catch (error) {
    status = "failed";
    auditError = error instanceof Error ? error.message : String(error);
    output = {
      error: auditError,
    };
    lines = [`error=${auditError}`];
    throw error;
  } finally {
    await finishOperationalRun(auditRun, status, {
      counts: {
        lines: lines?.length ?? 0,
      },
      error: auditError,
      metadata: {
        commandId,
        lines: lines ?? [],
      },
    });
    telemetry.metric({
      name: "mk3.admin_command.run",
      type: "counter",
      value: 1,
      tags: {
        command: commandId,
        status,
      },
    });
  }

  const completedAt = Date.now();
  const run = {
    id: `${commandId}:${completedAt}`,
    command: definition,
    status: "success",
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
    lines,
    output,
  };

  await persistAdminCommandRun(run);
  return run;
}

function parseTimeframe(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  return ALLOWED_TIMEFRAMES.has(trimmed) ? trimmed : fallback;
}

function parseMsParam(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLimitParam(value: string | null, fallback = 100, max = 500): number {
  if (!value) return fallback;
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function parseCsvParam(value: string | null): string[] {
  return (
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin.replace(/\/+$/, ""));
}

function isAdminOriginAllowed(origin: string | null): boolean {
  if (!origin) return true;
  return ADMIN_ALLOWED_ORIGINS.has(origin.replace(/\/+$/, ""));
}

function buildCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get("Origin");
  if (origin && isOriginAllowed(origin)) {
    return {
      ...baseCorsHeaders,
      "Access-Control-Allow-Origin": origin,
    };
  }

  return { ...baseCorsHeaders };
}

function buildRateLimitHeaders(decision?: RateLimitDecision): Record<string, string> {
  if (!decision) return {};

  const headers: Record<string, string> = {
    "X-RateLimit-Limit": decision.limit.toString(),
    "X-RateLimit-Remaining": Math.max(0, decision.remaining).toString(),
    "X-RateLimit-Reset": Math.ceil(decision.resetAt / 1000).toString(),
  };

  if (!decision.allowed && decision.retryAfterSeconds !== undefined) {
    headers["Retry-After"] = decision.retryAfterSeconds.toString();
  }

  return headers;
}

function jsonResponse(
  data: any,
  status = 200,
  req?: Request,
  extraHeaders?: Record<string, string>,
) {
  return Response.json(data, {
    status,
    headers: {
      ...buildCorsHeaders(req),
      ...extraHeaders,
    },
  });
}

function errorResponse(
  message: string,
  status = 500,
  req?: Request,
  extraHeaders?: Record<string, string>,
) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        ...buildCorsHeaders(req),
        ...extraHeaders,
      },
    },
  );
}

// Auth middleware replacement
function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("Authorization");
  const apiKeyHeader = req.headers.get("X-API-Key");

  if (apiKeyHeader === HUB_API_KEY) return true;
  if (authHeader === `Bearer ${HUB_API_KEY}`) return true;

  return false;
}

function getClientIdentifier(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function evaluateRateLimit(req: Request, scope: RateLimitScope): RateLimitDecision {
  const now = Date.now();
  const clientId = getClientIdentifier(req);
  const windowMs =
    scope === "admin" ? ADMIN_RATE_LIMIT_WINDOW_MS : PUBLIC_RATE_LIMIT_WINDOW_MS;
  const limit = scope === "admin" ? ADMIN_RATE_LIMIT_MAX : PUBLIC_RATE_LIMIT_MAX;
  const key = `${scope}:${clientId}`;
  const existing = rateLimitBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const nextState: RateLimitState = {
      count: 1,
      resetAt: now + windowMs,
    };
    rateLimitBuckets.set(key, nextState);
    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      resetAt: nextState.resetAt,
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  rateLimitBuckets.set(key, existing);
  return {
    allowed: true,
    limit,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
  };
}

export function resetRateLimitsForTesting(): void {
  rateLimitBuckets.clear();
}

export function startHubRESTApi(client: MassiveWSClient): Promise<void> {
  massiveClient = client;

  const server = Bun.serve({
    hostname: HUB_HOST,
    port: HUB_PORT,
    async fetch(req: Request, server: Server<undefined>) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;
      const origin = req.headers.get("Origin");

      if (origin && !isOriginAllowed(origin)) {
        return errorResponse("Origin not allowed", 403, req);
      }
      if (path.startsWith("/admin") && origin && !isAdminOriginAllowed(origin)) {
        return errorResponse("Admin browser origin not allowed", 403, req);
      }

      // Handle WebSocket upgrade
      if (server.upgrade(req, { data: undefined })) {
        return undefined; // do not return a Response
      }

      // Handle CORS preflight (don't log these)
      if (method === "OPTIONS") {
        return new Response(null, {
          headers: buildCorsHeaders(req),
        });
      }

      // Start timing for request logging
      const startTime = performance.now();
      const response = await handleRequest(method, path, req);
      const durationMs = Math.round(performance.now() - startTime);

      // Log the request
      logger.request(method, path, response.status, durationMs);

      return response;
    },
    websocket: {
      async open(ws: ServerWebSocket<unknown>) {
        logger.info("WebSocket client connected");
        ws.subscribe("market_data");
        ws.send(
          JSON.stringify({
            type: "info",
            message: "Connected to Market Data Stream",
          }),
        );

        // Send recent history as snapshot (last 100 messages)
        try {
          const recentMessages = await redisStore.redis.xrevrange(
            "market_data",
            "+",
            "-",
            "COUNT",
            100,
          );

          for (const [id, fields] of recentMessages.reverse()) {
            const data: Record<string, any> = {};
            for (let i = 0; i < fields.length; i += 2) {
              const key = fields[i];
              const value = fields[i + 1];
              if (key !== undefined) {
                data[key] = value;
              }
            }

            const payload = JSON.stringify({
              type: "market_data",
              id,
              data: data.data ? JSON.parse(data.data) : data,
              snapshot: true,
            });

            ws.send(payload);
          }
        } catch (error) {
          logger.error("Error sending WebSocket snapshot", {
            error: String(error),
          });
        }
      },
      message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
        // Handle incoming messages if needed
      },
      close(ws: ServerWebSocket<unknown>) {
        logger.info("WebSocket client disconnected");
      },
    },
  });

  logger.info(`Hub REST & WebSocket API listening on port ${server.port}`);

  // Start Redis Stream Consumer for Broadcasting
  startStreamBroadcaster(server);

  return Promise.resolve();
}

/**
 * Handle incoming HTTP requests
 */
export async function handleRequest(
  method: string,
  path: string,
  req: Request,
): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("Origin");
  const scope: RateLimitScope = path.startsWith("/admin") ? "admin" : "public";
  const rateLimit = evaluateRateLimit(req, scope);
  const rateLimitHeaders = buildRateLimitHeaders(rateLimit);
  const respond = (data: any, status = 200) =>
    jsonResponse(data, status, req, rateLimitHeaders);
  const fail = (message: string, status = 500) =>
    errorResponse(message, status, req, rateLimitHeaders);

  if (origin && !isOriginAllowed(origin)) {
    return fail("Origin not allowed", 403);
  }
  if (path.startsWith("/admin") && origin && !isAdminOriginAllowed(origin)) {
    return fail("Admin browser origin not allowed", 403);
  }
  if (!rateLimit.allowed) {
    return fail("Too Many Requests", 429);
  }
  // --- Public Routes ---

  if (method === "GET" && path === "/health") {
    let redisOk = false;
    let timescaleOk = false;
    const timescaleEnabled = timescaleStore.isEnabled;

    try {
      const pong = await redisStore.ping();
      redisOk = pong === "PONG";
    } catch {
      redisOk = false;
    }

    if (timescaleEnabled) {
      try {
        timescaleOk = await timescaleStore.ping();
      } catch {
        timescaleOk = false;
      }
    }

    const wsConnected = massiveClient?.isConnected() || false;
    const allHealthy =
      redisOk && wsConnected && (!timescaleEnabled || timescaleOk);
    const status = allHealthy ? "ok" : "degraded";

    return respond({
      status,
      timestamp: Date.now(),
      services: {
        redis: redisOk ? "connected" : "disconnected",
        timescaledb: timescaleEnabled
          ? timescaleOk
            ? "connected"
            : "disconnected"
          : "disabled",
        massiveWs: wsConnected ? "connected" : "disconnected",
      },
    });
  }

  // Match /bars/range/:symbol
  const rangeMatch = path.match(/^\/bars\/range\/([^\/]+)$/);
  if (method === "GET" && rangeMatch) {
    const symbol = rangeMatch[1];
    if (!symbol) return fail("Invalid symbol", 400);

    const start = parseMsParam(url.searchParams.get("start"));
    const end = parseMsParam(url.searchParams.get("end"));
    const tf = parseTimeframe(url.searchParams.get("tf"), "1m");

    if (start === null || end === null) {
      return fail("start and end query params are required (ms)", 400);
    }

    const range = await marketDataRepository.getBarsRange(symbol, start, end, tf);
    return respond({ ...range, count: range.bars.length });
  }


  // Match /bars/today/:symbol
  const todayMatch = path.match(/^\/bars\/today\/([^\/]+)$/);
  if (method === "GET" && todayMatch) {
    const symbol = todayMatch[1];
    if (!symbol) return fail("Invalid symbol", 400);

    const tf = parseTimeframe(url.searchParams.get("tf"), "1s");
    const bars = await redisStore.getTodayBars(symbol, tf as any);
    return respond({ symbol, tf, bars, count: bars.length });
  }

  const sessionBarsMatch = path.match(/^\/bars\/session\/([^\/]+)$/);
  if (method === "GET" && sessionBarsMatch) {
    const symbol = sessionBarsMatch[1];
    if (!symbol) return fail("Invalid symbol", 400);

    const tf = parseTimeframe(url.searchParams.get("tf"), "1s");
    const ts = parseMsParam(url.searchParams.get("ts")) ?? Date.now();
    const bars = await redisStore.getSessionBars(symbol, ts, tf as any);
    return respond({ symbol, tf, bars, count: bars.length });
  }

  if (method === "GET" && path === "/symbols") {
    const symbols = await redisStore.getSymbols();
    return respond({ symbols, count: symbols.length });
  }

  // Session data endpoint (public - no auth required)
  if (method === "GET" && path === "/sessions") {
    const sessions = await redisStore.getAllSessions();
    return respond({ sessions, count: Object.keys(sessions).length });
  }

  const sessionHistoryMatch = path.match(/^\/sessions\/week\/([^\/]+)$/);
  if (method === "GET" && sessionHistoryMatch) {
    const symbol = sessionHistoryMatch[1];
    if (!symbol) return fail("Invalid symbol", 400);

    const end = parseMsParam(url.searchParams.get("end")) ?? Date.now();
    const start = parseMsParam(url.searchParams.get("start")) ?? end - ONE_WEEK_MS;
    const sessions = await redisStore.getSessionHistory(symbol, start, end);
    return respond({ symbol, start, end, sessions, count: sessions.length });
  }

  // Match /session/:symbol
  const sessionMatch = path.match(/^\/session\/([^\/]+)$/);
  if (method === "GET" && sessionMatch) {
    const symbol = sessionMatch[1];
    if (!symbol) return fail("Invalid symbol", 400);

    const ts = parseMsParam(url.searchParams.get("ts")) ?? Date.now();
    const session = await redisStore.getSession(symbol, ts);
    if (!session) {
      return fail("Session not found", 404);
    }
    return respond(session);
  }

  // Snapshot data endpoint (public - no auth required)
  if (method === "GET" && path === "/snapshots") {
    const snapshots = await redisStore.getAllSnapshots();
    return respond({ snapshots, count: Object.keys(snapshots).length });
  }

  // Match /snapshot/:symbol
  const snapshotMatch = path.match(/^\/snapshot\/([^\/]+)$/);
  if (method === "GET" && snapshotMatch) {
    const symbol = snapshotMatch[1];
    if (!symbol) return fail("Invalid symbol", 400);

    const snapshot = await redisStore.getSnapshot(symbol);
    if (!snapshot) {
      return fail("Snapshot not found", 404);
    }
    return respond(snapshot);
  }

  // --- Protected Routes ---

  // Check auth for all /admin routes
  if (path.startsWith("/admin")) {
    if (!isAuthorized(req)) {
      return fail("Unauthorized", 401);
    }

    if (method === "GET" && path === "/admin/recovery/checkpoints") {
      const checkpoints = await redisStore.getAllRecoveryCheckpoints();
      return respond({
        checkpoints,
        count: Object.keys(checkpoints).length,
      });
    }

    if (method === "GET" && path === "/admin/health") {
      const ops = await buildAdminOpsPayload();

      return respond({
        status: ops.status,
        timestamp: ops.timestamp,
        services: ops.services,
        symbols: ops.coverage.symbols.map((symbol) => symbol.symbol),
        symbolCount: ops.redis.symbolCount,
        redis: ops.redis,
        durable: ops.durable,
        coverage: ops.coverage,
        recovery: {
          checkpointCount: ops.redis.recoveryCheckpointCount,
        },
        dailyClearJob: dailyClearJob.getStatus(),
        subscriptionRefreshJob: monthlySubscriptionJob.getStatus(),
        snapshotRefreshJob: snapshotJob.getStatus(),
        frontMonthRefreshJob: frontMonthJob.getStatus(),
      });
    }

    if (method === "GET" && path === "/admin/ops") {
      try {
        return respond(await buildAdminOpsPayload());
      } catch (err) {
        Sentry.captureException(err, {
          tags: {
            route: "/admin/ops",
          },
        });
        throw err;
      }
    }

    if (method === "GET" && path === "/admin/coverage") {
      const ops = await buildAdminOpsPayload();
      return respond(ops.coverage);
    }

    if (method === "GET" && path === "/admin/durable/symbols") {
      const limit = parseLimitParam(url.searchParams.get("limit"));
      const symbols = await timescaleStore.getRecentDurableSymbols(limit);
      return respond({ symbols, count: symbols.length });
    }

    if (method === "GET" && path === "/admin/durable/bars/latest") {
      const limit = parseLimitParam(url.searchParams.get("limit"));
      const symbols = parseCsvParam(url.searchParams.get("symbols"));
      const source = url.searchParams.get("source")?.trim() as
        | "live_ws"
        | "provider_rest"
        | "flat_file"
        | "recovery"
        | undefined;

      if (source && !["live_ws", "provider_rest", "flat_file", "recovery"].includes(source)) {
        return fail("Invalid durable bar source", 400);
      }

      const bars = await timescaleStore.getLatestDurableBars(symbols, limit, source);
      return respond({ bars, count: bars.length });
    }

    if (method === "GET" && path === "/admin/durable/provider-outcomes") {
      const limit = parseLimitParam(url.searchParams.get("limit"));
      const symbol = url.searchParams.get("symbol")?.trim() || undefined;
      const status = url.searchParams.get("status")?.trim() as
        | "success"
        | "empty"
        | "failed"
        | undefined;

      if (status && !["success", "empty", "failed"].includes(status)) {
        return fail("Invalid provider outcome status", 400);
      }

      const outcomes = await timescaleStore.getProviderFetchOutcomes({
        symbol,
        status,
        limit,
      });
      return respond({ outcomes, count: outcomes.length });
    }

    if (method === "GET" && path === "/admin/durable/operational-runs") {
      const limit = parseLimitParam(url.searchParams.get("limit"));
      const runType = url.searchParams.get("runType")?.trim() || undefined;
      const status = url.searchParams.get("status")?.trim() || undefined;
      const runs = await timescaleStore.getOperationalRuns({
        runType,
        status,
        limit,
      });
      return respond({ runs, count: runs.length });
    }

    if (method === "GET" && path === "/admin/durable/ingestion-runs") {
      const limit = parseLimitParam(url.searchParams.get("limit"));
      const source = url.searchParams.get("source")?.trim() as
        | "provider_rest"
        | "flat_file"
        | "recovery"
        | undefined;
      const status = url.searchParams.get("status")?.trim() as
        | "started"
        | "success"
        | "failed"
        | undefined;

      if (source && !["provider_rest", "flat_file", "recovery"].includes(source)) {
        return fail("Invalid ingestion source", 400);
      }
      if (status && !["started", "success", "failed"].includes(status)) {
        return fail("Invalid ingestion status", 400);
      }

      const runs = await timescaleStore.getIngestionRuns({
        source,
        status,
        limit,
      });
      return respond({ runs, count: runs.length });
    }

    const qualityMatch = path.match(/^\/admin\/durable\/quality\/([^\/]+)$/);
    if (method === "GET" && qualityMatch) {
      const symbol = qualityMatch[1];
      if (!symbol) return fail("Invalid symbol", 400);

      const start = parseMsParam(url.searchParams.get("start"));
      const end = parseMsParam(url.searchParams.get("end"));
      const gapThresholdMs = parseMsParam(url.searchParams.get("gapThresholdMs")) ?? undefined;
      const spikeThresholdPct = url.searchParams.get("spikeThresholdPct")
        ? Number(url.searchParams.get("spikeThresholdPct"))
        : undefined;

      if (start === null || end === null) {
        return fail("start and end query params are required (ms)", 400);
      }
      if (
        spikeThresholdPct !== undefined &&
        (!Number.isFinite(spikeThresholdPct) || spikeThresholdPct <= 0)
      ) {
        return fail("Invalid spikeThresholdPct", 400);
      }

      const quality = await timescaleStore.getDurableQualitySummary(symbol, start, end, {
        gapThresholdMs,
        spikeThresholdPct,
        recordSummary: true,
        metadata: {
          route: "/admin/durable/quality/:symbol",
        },
      });
      return respond(quality);
    }

    if (method === "GET" && path === "/admin/commands") {
      return respond({
        commands: ADMIN_COMMANDS,
        count: ADMIN_COMMANDS.length,
      });
    }

    const commandRunMatch = path.match(/^\/admin\/commands\/([^\/]+)\/run$/);
    if (method === "POST" && commandRunMatch) {
      const commandId = commandRunMatch[1];
      if (!commandId) {
        return fail("Invalid command id", 400);
      }

      const run = await runAdminCommand(commandId);
      if (!run) {
        return fail("Unknown admin command", 404);
      }

      return respond(run);
    }

    if (method === "GET" && path === "/admin/front-months") {
      const cache = frontMonthJob.getCache();
      if (!cache) {
        return respond({
          lastUpdated: null,
          products: {},
          message:
            "Cache not yet populated. Refresh will occur at 3 AM ET or trigger manually via admin endpoint.",
        });
      }
      return respond(cache);
    }

    if (method === "GET" && path === "/admin/contracts/active") {
      const contracts = await redisStore.getAllActiveContracts();
      return respond({
        products: contracts,
        count: Object.keys(contracts).length,
      });
    }

    if (method === "GET" && path === "/admin/bars/latest") {
      const bars = await redisStore.getAllLatestArray();
      return respond({ bars, count: bars.length });
    }

    const latestMatch = path.match(/^\/admin\/bars\/latest\/([^\/]+)$/);
    if (method === "GET" && latestMatch) {
      const symbol = latestMatch[1];
      if (!symbol) return fail("Invalid symbol", 400);

      const bar = await redisStore.getLatest(symbol);
      if (!bar) {
        return fail("Symbol not found", 404);
      }
      return respond(bar);
    }

    const weekMatch = path.match(/^\/admin\/bars\/week\/([^\/]+)$/);
    if (method === "GET" && weekMatch) {
      const symbol = weekMatch[1];
      if (!symbol) return fail("Invalid symbol", 400);

      const tf = parseTimeframe(url.searchParams.get("tf"), "1m");
      const end = Date.now();
      const start = end - ONE_WEEK_MS;
      const bars = await redisStore.getBarsRange(symbol, start, end, tf as any);
      return respond({ symbol, tf, start, end, bars, count: bars.length });
    }

    const activeContractsMatch = path.match(/^\/admin\/contracts\/active\/([^\/]+)$/);
    if (method === "GET" && activeContractsMatch) {
      const productCode = activeContractsMatch[1];
      if (!productCode) return fail("Invalid product code", 400);

      const contracts = await redisStore.getActiveContracts(productCode);
      if (!contracts) {
        return fail("Contracts not found", 404);
      }

      return respond(contracts);
    }

    if (method === "POST" && path === "/admin/clear-redis") {
      // Manual clear always uses force=true to bypass daily check
      await dailyClearJob.runClear(true, "manual");
      const status = dailyClearJob.getStatus();
      return respond({ message: "Manual clear triggered", status });
    }

    if (method === "POST" && path === "/admin/refresh-subscriptions") {
      try {
        await monthlySubscriptionJob.runRefresh("manual");
        const status = monthlySubscriptionJob.getStatus();
        return respond({
          message: "Manual subscription refresh triggered",
          status,
        });
      } catch (err) {
        return respond(
          {
            error: "Refresh failed",
            details: err instanceof Error ? err.message : String(err),
          },
          500,
        );
      }
    }

    if (method === "GET" && path === "/admin/subscriptions") {
      if (!massiveClient) {
        return fail("Massive client not initialized", 503);
      }

      const subscriptions = massiveClient.getSubscriptions();
      return respond({
        subscriptions,
        count: subscriptions.length,
        totalSymbols: subscriptions.reduce(
          (sum, sub) => sum + sub.symbols.length,
          0,
        ),
      });
    }

    if (method === "POST" && path === "/admin/refresh-front-months") {
      // Run in background to prevent timeout
      frontMonthJob.runRefresh("manual").catch((err) => {
        console.error("[FrontMonthJob] Background refresh failed:", err);
      });

      return respond({
        message: "Front month refresh started (running in background)",
        status: frontMonthJob.getStatus(),
        cache: frontMonthJob.getCache(), // Return current cache immediately
      });
    }

    if (method === "POST" && path === "/admin/refresh-snapshots") {
      // Run job in background (don't await) - prevents HTTP timeout
      snapshotJob.runRefresh("manual").catch((err) => {
        console.error("[SnapshotJob] Background refresh failed:", err);
      });

      return respond({
        message: "Snapshot refresh started (running in background)",
        status: snapshotJob.getStatus(),
      });
    }

    if (method === "POST" && path === "/admin/recovery/backfill") {
      const requestedSymbols = url.searchParams
        .get("symbols")
        ?.split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      const symbols = requestedSymbols?.length
        ? Array.from(new Set(requestedSymbols))
        : await redisStore.getSubscribedSymbols();
      const results = await recoveryService.backfillSymbolsFromProvider(symbols, {
        source: "manual",
        excludeCurrentMinute: true,
      });

      return respond({
        message: "Manual recovery backfill completed",
        symbols,
        results,
        providerBars: results.reduce((sum, result) => sum + result.providerBars, 0),
      });
    }

    if (method === "POST" && path === "/admin/hot-cache/rebuild") {
      const dryRun = url.searchParams.get("dryRun") !== "false";
      const symbols = await redisStore.getSubscribedSymbols();
      const result = await hotCacheRebuilder.rebuildLatestWindow(symbols, {
        dryRun,
      });

      return respond({
        message: dryRun
          ? "Hot-cache rebuild dry run completed"
          : "Hot-cache rebuild completed",
        dryRun,
        result,
      });
    }
  }

  return fail("Not Found", 404);
}

async function startStreamBroadcaster(server: Server<undefined>) {
  logger.info("Starting Redis Stream Broadcaster...");
  // Create a dedicated Redis client for blocking operations (not a duplicate to avoid command queue conflicts)
  const subRedis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
  });
  let lastId = "$"; // Start reading from new messages

  while (true) {
    try {
      // Block for 5 seconds waiting for new messages
      const streams = await subRedis.xread(
        "BLOCK",
        5000,
        "STREAMS",
        "market_data",
        lastId,
      );

      if (streams && streams[0]) {
        const [streamName, messages] = streams[0];

        for (const [id, fields] of messages) {
          lastId = id;

          // Parse fields
          const data: Record<string, any> = {};
          for (let i = 0; i < fields.length; i += 2) {
            const key = fields[i];
            const value = fields[i + 1];
            if (key !== undefined) {
              data[key] = value;
            }
          }

          // Broadcast to all connected clients
          const payload = JSON.stringify({
            type: "market_data",
            id,
            data: data.data ? JSON.parse(data.data) : data,
            snapshot: false,
          });

          server.publish("market_data", payload);
        }
      }
    } catch (error) {
      logger.error("Error in Stream Broadcaster", { error: String(error) });
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait before retrying
    }
  }
}
