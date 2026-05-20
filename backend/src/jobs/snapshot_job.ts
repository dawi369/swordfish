import { CronJob } from "cron";
import { redisStore } from "@/server/data/redis_store.js";
import {
  fetchTickerSnapshotContract,
  snapshotContractToSnapshotData,
} from "@/utils/massive_snapshots.js";
import { captureExceptionWithContext } from "@/utils/sentry.js";
import {
  finishOperationalRun,
  startOperationalRun,
} from "@/utils/operational_runs.js";
const REDIS_STATUS_KEY = "job:snapshot:status";

interface SnapshotJobStatus {
  lastRunTime: number | null;
  lastSuccess: boolean;
  lastError: string | null;
  symbolsUpdated: number;
  totalRuns: number;
}

export class SnapshotJob {
  private cronJob: CronJob | null = null;
  private status: SnapshotJobStatus = {
    lastRunTime: null,
    lastSuccess: false,
    lastError: null,
    symbolsUpdated: 0,
    totalRuns: 0,
  };

  async loadStatus(): Promise<void> {
    try {
      const saved = await redisStore.redis.get(REDIS_STATUS_KEY);
      if (saved) {
        this.status = JSON.parse(saved);
        console.log(
          `[SnapshotJob] Loaded status: ${this.status.totalRuns} runs, last: ${
            this.status.lastRunTime
              ? new Date(this.status.lastRunTime).toISOString()
              : "never"
          }`
        );
      }
    } catch (err) {
      console.error("[SnapshotJob] Failed to load status:", err);
    }
  }

  private async saveStatus(): Promise<void> {
    try {
      await redisStore.redis.set(REDIS_STATUS_KEY, JSON.stringify(this.status));
    } catch (err) {
      console.error("[SnapshotJob] Failed to save status:", err);
    }
  }

  /**
   * Fetch and store snapshots for all active symbols
   */
  async runRefresh(trigger = "schedule"): Promise<void> {
    console.log("--- SnapshotJob ---");
    console.log("[SnapshotJob] Running snapshot refresh...");

    this.status.totalRuns++;
    this.status.lastRunTime = Date.now();
    const run = await startOperationalRun({
      runType: "job",
      name: "snapshot-refresh",
      trigger,
    });

    try {
      const [subscribedSymbols, cachedContractSymbols] = await Promise.all([
        redisStore.getSubscribedSymbols(),
        redisStore.getCachedActiveContractSymbols(),
      ]);

      const symbols = Array.from(
        new Set([...subscribedSymbols, ...cachedContractSymbols]),
      ).sort();

      if (symbols.length === 0) {
        console.log("[SnapshotJob] No active symbols found");
        this.status.lastSuccess = true;
        this.status.symbolsUpdated = 0;
        await this.saveStatus();
        await finishOperationalRun(run, "skipped", {
          counts: { symbols: 0, symbolsUpdated: 0 },
          metadata: { reason: "no_active_symbols" },
        });
        return;
      }

      console.log(`[SnapshotJob] Fetching snapshots for ${symbols.length} symbols`);

      let updated = 0;
      for (const symbol of symbols) {
        const contract = await fetchTickerSnapshotContract(symbol);
        const snapshot = contract ? snapshotContractToSnapshotData(contract) : null;

        if (snapshot) {
          await redisStore.writeSnapshot(symbol, snapshot);
          updated++;
          console.log(
            `[SnapshotJob] ${symbol}: prevSettlement=${snapshot.prevSettlement}, settlement=${snapshot.settlementPrice}`
          );
        }

        // Rate limiting: 100ms between requests
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      this.status.lastSuccess = true;
      this.status.lastError = null;
      this.status.symbolsUpdated = updated;

      await this.saveStatus();
      await finishOperationalRun(run, updated === symbols.length ? "success" : "partial_success", {
        counts: {
          symbols: symbols.length,
          symbolsUpdated: updated,
          symbolsMissing: symbols.length - updated,
        },
      });

      console.log(`[SnapshotJob] Completed: ${updated}/${symbols.length} symbols updated`);
      console.log("");
    } catch (err) {
      this.status.lastSuccess = false;
      this.status.lastError = err instanceof Error ? err.message : String(err);
      captureExceptionWithContext(err, {
        tags: {
          job_name: "snapshot-refresh",
          run_id: run.runId,
        },
      });
      await this.saveStatus();
      await finishOperationalRun(run, "failed", {
        error: this.status.lastError,
      });
      console.error("[SnapshotJob] Failed:", err);
    }
  }

  getStatus(): SnapshotJobStatus {
    return { ...this.status };
  }

  getSchedule() {
    return {
      id: "snapshot-refresh",
      label: "Snapshot refresh",
      cron: "5 2 * * *",
      timezone: "America/New_York",
      description: "Refreshes cached contract snapshots after daily Redis maintenance.",
      nextRunTime: this.cronJob ? this.cronJob.nextDate().toMillis() : null,
      scheduled: Boolean(this.cronJob),
    };
  }

  /**
   * Schedule job to run at 2:05 AM ET (after daily clear at 2:00 AM)
   */
  schedule(): void {
    if (this.cronJob) {
      return;
    }

    this.cronJob = new CronJob(
      "5 2 * * *",
      async () => {
        await this.runRefresh();
      },
      null,
      true,
      "America/New_York"
    );

    console.log("[SnapshotJob] Scheduled (2:05 AM ET daily)");
  }

  stopSchedule(): void {
    this.cronJob?.stop();
    this.cronJob = null;
  }
}

export const snapshotJob = new SnapshotJob();
