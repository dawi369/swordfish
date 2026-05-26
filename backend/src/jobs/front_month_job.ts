import { CronJob } from "cron";
import { redisStore } from "@/server/data/redis_store.js";
import type {
  FrontMonthCache,
  FrontMonthJobStatus,
} from "@/types/front_month.types.js";
import { getAllConfiguredProducts } from "@/utils/futures_universe.js";
import { contractProvider } from "@/utils/contract_provider.js";
import { fetchTickerSnapshotContract } from "@/utils/massive_snapshots.js";
import { resolveFrontMonth } from "@/utils/front_month_resolver.js";
import { buildGeneratedContracts } from "@/utils/contracts_calendar.js";
import type { MassiveAssetClass } from "@/types/massive.types.js";
import type { ActiveContract } from "@/types/contract.types.js";
import { captureExceptionWithContext } from "@/utils/sentry.js";
import {
  finishOperationalRun,
  startOperationalRun,
} from "@/utils/operational_runs.js";
import { recordJobFinished, recordJobStarted } from "@/utils/job_observability.js";

const REDIS_CACHE_KEY = "cache:front-months";
const REDIS_STATUS_KEY = "job:front-months:status";
const JOB_NAME = "front-month-refresh";

const FRONT_MONTH_CANDIDATE_LIMITS: Record<MassiveAssetClass, number> = {
  us_indices: 4,
  metals: 6,
  currencies: 4,
  grains: 6,
  softs: 6,
  volatiles: 6,
};

function mergeContracts(
  providerContracts: ActiveContract[],
  generatedContracts: ActiveContract[],
): ActiveContract[] {
  const merged = new Map<string, ActiveContract>();

  for (const contract of [...providerContracts, ...generatedContracts]) {
    if (!merged.has(contract.ticker)) {
      merged.set(contract.ticker, contract);
    }
  }

  return Array.from(merged.values()).sort(
    (a, b) =>
      new Date(a.lastTradeDate).getTime() - new Date(b.lastTradeDate).getTime(),
  );
}

export class FrontMonthJob {
  private cronJob: CronJob | null = null;
  private status: FrontMonthJobStatus = {
    lastRunTime: null,
    lastSuccess: false,
    lastError: null,
    productsUpdated: 0,
    totalRuns: 0,
  };

  private cache: FrontMonthCache | null = null;

  async loadStatus(): Promise<void> {
    try {
      const [savedStatus, savedCache] = await Promise.all([
        redisStore.redis.get(REDIS_STATUS_KEY),
        redisStore.redis.get(REDIS_CACHE_KEY),
      ]);

      if (savedStatus) {
        this.status = JSON.parse(savedStatus);
        console.log(
          `[FrontMonthJob] Loaded status: ${this.status.totalRuns} runs, last: ${
            this.status.lastRunTime ? new Date(this.status.lastRunTime).toISOString() : "never"
          }`
        );
      }

      if (savedCache) {
        this.cache = JSON.parse(savedCache);
        console.log(
          `[FrontMonthJob] Loaded cache with ${Object.keys(this.cache?.products || {}).length} products`
        );
      }
    } catch (err) {
      console.error("[FrontMonthJob] Failed to load status:", err);
    }
  }

  private async saveStatus(): Promise<void> {
    try {
      await redisStore.redis.set(REDIS_STATUS_KEY, JSON.stringify(this.status));
    } catch (err) {
      console.error("[FrontMonthJob] Failed to save status:", err);
    }
  }

  private async saveCache(): Promise<void> {
    try {
      if (this.cache) {
        await redisStore.redis.set(REDIS_CACHE_KEY, JSON.stringify(this.cache));
      }
    } catch (err) {
      console.error("[FrontMonthJob] Failed to save cache:", err);
    }
  }

  async runRefresh(trigger = "schedule"): Promise<void> {
    console.log("--- FrontMonthJob ---");
    console.log("[FrontMonthJob] Running front month detection...");

    this.status.totalRuns++;
    this.status.lastRunTime = Date.now();
    const run = await startOperationalRun({
      runType: "job",
      name: JOB_NAME,
      trigger,
    });
    recordJobStarted({ jobName: JOB_NAME, trigger, runId: run.runId });

    try {
      const products = await getAllConfiguredProducts();
      const newCache: FrontMonthCache = {
        lastUpdated: Date.now(),
        products: {},
      };

      for (const { code, assetClass } of products) {
        const providerContracts =
          await contractProvider.fetchActiveContractsDetailed(code);
        const generatedContracts = buildGeneratedContracts(
          code,
          FRONT_MONTH_CANDIDATE_LIMITS[assetClass],
        );
        const contracts = mergeContracts(providerContracts, generatedContracts);
        await redisStore.writeActiveContracts(code, contracts);

        const snapshots = await Promise.all(
          contracts.map(async (contract) => ({
            contract,
            snapshot: await fetchTickerSnapshotContract(contract.ticker),
          })),
        );

        const frontMonth = resolveFrontMonth(snapshots, code, assetClass);

        if (frontMonth) {
          newCache.products[code] = frontMonth;
          const rollIndicator = frontMonth.isRolling ? " (ROLLING)" : "";
          console.log(
            `[FrontMonthJob] ${code}: ${frontMonth.frontMonth} (${frontMonth.volume.toLocaleString()} vol, confidence=${frontMonth.confidence})${rollIndicator}`
          );
        } else {
          console.warn(`[FrontMonthJob] ${code}: No front month detected`);
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      this.cache = newCache;
      this.status.lastSuccess = true;
      this.status.lastError = null;
      this.status.productsUpdated = Object.keys(newCache.products).length;

      await Promise.all([this.saveStatus(), this.saveCache()]);
      const status =
        this.status.productsUpdated === products.length
          ? "success"
          : "partial_success";
      const counts = {
        products: products.length,
        productsUpdated: this.status.productsUpdated,
        productsMissing: products.length - this.status.productsUpdated,
      };
      await finishOperationalRun(run, status, {
        counts,
      });
      recordJobFinished({
        jobName: JOB_NAME,
        trigger,
        runId: run.runId,
        status,
        startedAt: run.startedAt,
        counts,
      });

      console.log(
        `[FrontMonthJob] Completed: ${this.status.productsUpdated} products updated`
      );
      console.log("");
    } catch (err) {
      this.status.lastSuccess = false;
      this.status.lastError = err instanceof Error ? err.message : String(err);
      captureExceptionWithContext(err, {
        tags: {
          job_name: "front-month-refresh",
          run_id: run.runId,
        },
      });
      await this.saveStatus();
      await finishOperationalRun(run, "failed", {
        error: this.status.lastError,
      });
      recordJobFinished({
        jobName: JOB_NAME,
        trigger,
        runId: run.runId,
        status: "failed",
        startedAt: run.startedAt,
      });
      console.error("[FrontMonthJob] Failed:", err);
    }
  }

  getStatus(): FrontMonthJobStatus {
    return { ...this.status };
  }

  getCache(): FrontMonthCache | null {
    return this.cache;
  }

  getSchedule() {
    return {
      id: "front-month-refresh",
      label: "Front month refresh",
      cron: "0 3 * * *",
      timezone: "America/New_York",
      description: "Refreshes active contracts and front-month ranking.",
      nextRunTime: this.cronJob ? this.cronJob.nextDate().toMillis() : null,
      scheduled: Boolean(this.cronJob),
    };
  }

  schedule(): void {
    if (this.cronJob) {
      return;
    }

    // Run at 3 AM ET daily (after the 2 AM clear job)
    this.cronJob = new CronJob(
      "0 3 * * *",
      async () => {
        await this.runRefresh();
      },
      null,
      true,
      "America/New_York"
    );

    console.log("[FrontMonthJob] Scheduled (3 AM ET daily)");
  }

  stopSchedule(): void {
    this.cronJob?.stop();
    this.cronJob = null;
  }
}

export const frontMonthJob = new FrontMonthJob();
