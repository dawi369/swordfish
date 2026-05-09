import { CronJob } from "cron";
import { redisStore } from "@/server/data/redis_store.js";
import type { MassiveWSClient } from "@/server/api/massive/ws_client.js";
import type { MassiveAssetClass, MassiveWsRequest } from "@/types/massive.types.js";
import type { RefreshJobStatus, RefreshDetails } from "@/types/common.types.js";
import { scheduleBuilder } from "@/utils/cbs/schedule_cb.js";
import { Sentry } from "@/utils/sentry.js";

class MonthlySubscriptionJob {
  private cronJob: CronJob | null = null;
  private wsClient: MassiveWSClient | null = null;
  private status: RefreshJobStatus = {
    lastRunTime: null,
    lastSuccess: false,
    lastError: null,
    lastRefreshDetails: [],
    totalRuns: 0,
  };

  async loadStatus(): Promise<void> {
    try {
      const saved = await redisStore.redis.get("job:refresh:status");
      if (saved) {
        this.status = JSON.parse(saved);
        console.log(
          `Loaded refresh job status: ${this.status.totalRuns} runs, last: ${
            this.status.lastRunTime ? new Date(this.status.lastRunTime).toISOString() : "never"
          }`
        );
      }
    } catch (err) {
      console.error("Failed to load refresh job status:", err);
    }
  }

  private async saveStatus(): Promise<void> {
    try {
      await redisStore.redis.set("job:refresh:status", JSON.stringify(this.status));
    } catch (err) {
      console.error("Failed to save refresh job status:", err);
    }
  }

  attachClient(wsClient: MassiveWSClient): void {
    this.wsClient = wsClient;
  }

  private findSubscriptionByAssetClass(
    subscriptions: MassiveWsRequest[],
    assetClass: MassiveAssetClass,
    eventType: "A" | "AM"
  ): MassiveWsRequest | undefined {
    return subscriptions.find((sub) => sub.assetClass === assetClass && sub.ev === eventType);
  }

  private async refreshAssetClass(
    assetClass: MassiveAssetClass,
    eventType: "A" | "AM"
  ): Promise<RefreshDetails> {
    const details: RefreshDetails = {
      assetClass,
      eventType,
      oldSymbols: [],
      newSymbols: [],
      changed: false,
      success: false,
    };

    try {
      if (!this.wsClient) {
        throw new Error("WS client not initialized");
      }

      // Build new request based on asset class and config
      // Build new request based on asset class and config
      const newRequest = await scheduleBuilder.buildRequestAsync(assetClass, eventType);

      details.newSymbols = newRequest.symbols;

      // Find current subscription for this asset class
      const currentSubscriptions = this.wsClient.getSubscriptions();
      const currentSub = this.findSubscriptionByAssetClass(
        currentSubscriptions,
        assetClass,
        eventType
      );

      if (currentSub) {
        details.oldSymbols = currentSub.symbols;

        // Compare symbols
        const oldSymbolsSet = new Set(currentSub.symbols.sort());
        const newSymbolsSet = new Set(newRequest.symbols.sort());

        const oldStr = Array.from(oldSymbolsSet).join(",");
        const newStr = Array.from(newSymbolsSet).join(",");

        if (oldStr !== newStr) {
          details.changed = true;
          console.log(`[${assetClass}/${eventType}] Symbols changed, updating subscription...`);
          console.log(`  Old: ${currentSub.symbols.join(", ")}`);
          console.log(`  New: ${newRequest.symbols.join(", ")}`);

          await this.wsClient.updateSubscription(currentSub, newRequest);
          details.success = true;
        } else {
          console.log(`[${assetClass}/${eventType}] No change needed`);
          details.success = true;
        }
      } else {
        // No existing subscription, just subscribe
        details.changed = true;
        console.log(`[${assetClass}/${eventType}] No existing subscription, subscribing...`);
        await this.wsClient.subscribe(newRequest);
        details.success = true;
      }
    } catch (err) {
      details.success = false;
      details.error = err instanceof Error ? err.message : String(err);
      console.error(`[${assetClass}/${eventType}] Refresh failed:`, err);
    }

    return details;
  }

  async runRefresh(): Promise<void> {
    console.log("\n--- MonthlySubscriptionJob ---");
    console.log("Running subscription refresh job...");

    this.status.totalRuns++;
    this.status.lastRunTime = Date.now();
    this.status.lastRefreshDetails = [];

    const refreshTasks: Promise<RefreshDetails>[] = [];
    const assetClasses: MassiveAssetClass[] = [
      "us_indices",
      "metals",
      "currencies",
      "grains",
      "softs",
      "volatiles",
    ];

    for (const assetClass of assetClasses) {
      // Check if we should even try to refresh this asset class
      // For now, we try all of them. If the builder returns empty symbols (e.g. no schedule),
      // it handles it gracefully (returns empty list).
      // However, we might want to skip if count is 0?
      // But let's assume config is > 0.

      refreshTasks.push(this.refreshAssetClass(assetClass, "A"));
    }

    // Execute all refreshes
    const results = await Promise.all(refreshTasks);
    this.status.lastRefreshDetails = results;

    // Determine overall success (partial success if any succeeded)
    const anySuccess = results.some((r) => r.success);
    const anyFailure = results.some((r) => !r.success);

    if (anyFailure) {
      const errors = results
        .filter((r) => !r.success)
        .map((r) => r.error)
        .join("; ");
      this.status.lastError = errors;
      this.status.lastSuccess = anySuccess; // Partial success if at least one succeeded
      Sentry.captureMessage("Subscription refresh completed with failures", {
        level: "warning",
        tags: {
          job: "subscription-refresh",
        },
        extra: {
          errors,
          results,
        },
      });
      console.log(`⚠️  Refresh completed with failures: ${errors}`);
    } else {
      this.status.lastError = null;
      this.status.lastSuccess = true;
      console.log("✓ Refresh completed successfully");
    }

    if (this.wsClient) {
      const nextSymbols = this.wsClient
        .getSubscriptions()
        .flatMap((subscription) => subscription.symbols);
      await redisStore.setSubscribedSymbols(nextSymbols);
    }

    await this.saveStatus();

    // Summary
    const changedCount = results.filter((r) => r.changed).length;
    const successCount = results.filter((r) => r.success).length;
    console.log(`Summary: ${successCount}/${results.length} successful, ${changedCount} changed`);
    console.log("-----------------------------------\n");
    console.log("");
  }

  getStatus(): RefreshJobStatus {
    return { ...this.status };
  }

  getSchedule() {
    return {
      id: "subscription-refresh",
      label: "Subscription refresh",
      cron: "5 0 1 * *",
      timezone: "America/New_York",
      description: "Rebuilds upstream Massive subscriptions from active contracts.",
      nextRunTime: this.cronJob ? this.cronJob.nextDate().toMillis() : null,
      scheduled: Boolean(this.cronJob),
    };
  }

  schedule(wsClient: MassiveWSClient): void {
    this.wsClient = wsClient;

    if (this.cronJob) {
      return;
    }

    // Run at 00:05 ET on the 1st of every month
    this.cronJob = new CronJob(
      "5 0 1 * *",
      async () => {
        await this.runRefresh();
      },
      null,
      true,
      "America/New_York"
    );

    console.log("Monthly subscription refresh job scheduled (1st of month @ 00:05 ET)");
  }

  stopSchedule(): void {
    this.cronJob?.stop();
    this.cronJob = null;
  }
}

export const monthlySubscriptionJob = new MonthlySubscriptionJob();
