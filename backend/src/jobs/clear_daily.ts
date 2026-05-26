import { CronJob } from "cron";
import { redisStore } from "@/server/data/redis_store.js";
import { captureExceptionWithContext } from "@/utils/sentry.js";
import {
  finishOperationalRun,
  startOperationalRun,
} from "@/utils/operational_runs.js";
import { recordJobFinished, recordJobStarted } from "@/utils/job_observability.js";

const JOB_NAME = "daily-clear";

interface ClearJobStatus {
  lastRunTime: number | null;
  lastSuccess: boolean;
  lastError: string | null;
  clearedKeys: number;
  totalRuns: number;
}

export class DailyClearJob {
  private cronJob: CronJob | null = null;
  private status: ClearJobStatus = {
    lastRunTime: null,
    lastSuccess: false,
    lastError: null,
    clearedKeys: 0,
    totalRuns: 0,
  };

  async loadStatus(): Promise<void> {
    try {
      const saved = await redisStore.redis.get("job:clear:status");
      if (saved) {
        this.status = JSON.parse(saved);
        console.log(
          `Loaded clear job status: ${this.status.totalRuns} runs, last: ${
            this.status.lastRunTime ? new Date(this.status.lastRunTime).toISOString() : "never"
          }`
        );
      }
    } catch (err) {
      console.error("Failed to load clear job status:", err);
    }
  }

  private async saveStatus(): Promise<void> {
    try {
      await redisStore.redis.set("job:clear:status", JSON.stringify(this.status));
    } catch (err) {
      console.error("Failed to save clear job status:", err);
    }
  }

  async runClear(force = false, trigger = force ? "manual" : "schedule"): Promise<void> {
    console.log("--- DailyClearJob ---");
    console.log(`Running Redis maintenance job... (force: ${force})`);
    this.status.totalRuns++;
    this.status.lastRunTime = Date.now();
    const run = await startOperationalRun({
      runType: "job",
      name: JOB_NAME,
      trigger,
      metadata: { force },
    });
    recordJobStarted({ jobName: JOB_NAME, trigger, runId: run.runId });

    try {
      const result = force
        ? await redisStore.clearTodayData(true)
        : await redisStore.runDailyMaintenance();

      this.status.lastSuccess = true;
      this.status.lastError = null;
      this.status.clearedKeys = result.cleared;
      const counts = {
        clearedKeys: result.cleared,
      };

      await this.saveStatus();
      await finishOperationalRun(run, "success", {
        counts,
        metadata: {
          newDate: result.newDate,
          force,
        },
      });
      recordJobFinished({
        jobName: JOB_NAME,
        trigger,
        runId: run.runId,
        status: "success",
        startedAt: run.startedAt,
        counts,
      });

      console.log(
        `Daily maintenance completed: ${result.cleared} keys cleared, new date: ${result.newDate}`
      );
      console.log("");
    } catch (err) {
      this.status.lastSuccess = false;
      this.status.lastError = err instanceof Error ? err.message : String(err);
      captureExceptionWithContext(err, {
        tags: {
          job_name: "daily-clear",
          run_id: run.runId,
        },
      });

      await this.saveStatus();
      await finishOperationalRun(run, "failed", {
        error: this.status.lastError,
        metadata: { force },
      });
      recordJobFinished({
        jobName: JOB_NAME,
        trigger,
        runId: run.runId,
        status: "failed",
        startedAt: run.startedAt,
      });

      console.error("Daily clear job failed:", err);
    }
  }

  getStatus(): ClearJobStatus {
    return { ...this.status };
  }

  getSchedule() {
    return {
      id: "daily-clear",
      label: "Daily Redis maintenance",
      cron: "0 2 * * *",
      timezone: "America/New_York",
      description: "Clears hot intraday Redis data after the trading day boundary.",
      nextRunTime: this.cronJob ? this.cronJob.nextDate().toMillis() : null,
      scheduled: Boolean(this.cronJob),
    };
  }

  schedule(): void {
    if (this.cronJob) {
      return;
    }

    this.cronJob = new CronJob(
      "0 2 * * *",
      async () => {
        await this.runClear();
      },
      null,
      true,
      "America/New_York"
    );

    console.log("Daily clear job scheduled (2 AM ET)");
  }

  stopSchedule(): void {
    this.cronJob?.stop();
    this.cronJob = null;
  }
}

export const dailyClearJob = new DailyClearJob();
