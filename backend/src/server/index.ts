import { MassiveWSClient } from "@/server/api/massive/ws_client.js";
import { redisStore } from "@/server/data/redis_store.js";
import { timescaleStore } from "@/server/data/timescale_store.js";
import type { MassiveMarketType } from "@/types/massive.types.js";
import { startHubRESTApi } from "@/server/api/rest_client.js";
import { scheduleBuilder } from "@/utils/cbs/schedule_cb.js";
import { recoveryService } from "@/services/recovery_service.js";
import { initializeJobRuntime, stopJobRuntime } from "@/server/job_runtime.js";
import { flushSentry, initSentry, Sentry } from "@/utils/sentry.js";
import { HUB_DISABLE_PROVIDER_CONNECTION } from "@/config/env.js";

// Global reference for graceful shutdown
let massiveClient: MassiveWSClient | null = null;
let statsInterval: Timer | null = null;

initSentry();

/**
 * Main Hub server startup
 * If Redis connection fails, process will exit and can be restarted
 */
async function startHubServer() {
  try {
    console.log("Starting Hub server...");

    await redisStore.ping();
    await recoveryService.init();

    if (timescaleStore.isEnabled) {
      await timescaleStore.init();
    } else {
      console.log("TimescaleDB disabled for current runtime");
    }

    massiveClient = new MassiveWSClient();
    const futuresMarket: MassiveMarketType = "futures";

    // Expose health and public API before slower market-data warmup so deploy
    // healthchecks are not blocked by provider latency.
    await startHubRESTApi(massiveClient);

    if (HUB_DISABLE_PROVIDER_CONNECTION) {
      console.warn(
        "Provider connection disabled by HUB_DISABLE_PROVIDER_CONNECTION=true; serving health/admin APIs without Massive live ingestion.",
      );
      console.log("Hub server running in provider-disabled mode\n");
      return;
    }

    await massiveClient.connect(futuresMarket);

    // Build requests dynamically using API
    console.log("Building subscription requests...");

    const usIndicesReq = await scheduleBuilder.buildRequestAsync("us_indices", "A");
    const metalsReq = await scheduleBuilder.buildRequestAsync("metals", "A");
    const currenciesReq = await scheduleBuilder.buildRequestAsync("currencies", "A");
    const grainsReq = await scheduleBuilder.buildRequestAsync("grains", "A");
    const softsReq = await scheduleBuilder.buildRequestAsync("softs", "A");
    const volatilesReq = await scheduleBuilder.buildRequestAsync("volatiles", "A");

    await massiveClient.subscribe(usIndicesReq);
    await massiveClient.subscribe(metalsReq);
    await massiveClient.subscribe(currenciesReq);
    await massiveClient.subscribe(grainsReq);
    await massiveClient.subscribe(softsReq);
    await massiveClient.subscribe(volatilesReq);

    const subscribedSymbols = massiveClient.getSubscribedSymbols();
    await redisStore.setSubscribedSymbols(subscribedSymbols);

    const rehydration = await recoveryService.hydrateRedisFromRecoveryStore(
      subscribedSymbols,
    );
    console.log(
      `[Recovery] Rehydrated ${rehydration.barsLoaded} bars across ${rehydration.hydratedSymbols} symbols`,
    );

    console.log(
      "[Recovery] Provider REST backfill is disabled; live WebSocket bars are the only current production fill path.",
    );

    // Brief pause before continuing
    await Bun.sleep(1000);

    await initializeJobRuntime(massiveClient);

    console.log("Hub server running\n");

    // Log stats every 5 seconds
    statsInterval = setInterval(async () => {
      const stats = await redisStore.getStats();
      console.log(
        `[Stats] Date: ${stats.date} | Symbols: ${stats.symbolCount} | Bars: ${stats.barCount}`,
      );
    }, 5000);
  } catch (err) {
    Sentry.captureException(err);
    console.error("Hub server startup failed:", err);
    const retrySeconds = 10;
    console.error(`Retrying in ${retrySeconds} seconds...`);
    setTimeout(() => {
      startHubServer();
    }, retrySeconds * 1000);
  }
}

/**
 * Graceful shutdown - cleanup all connections
 */
async function gracefulShutdown(signal: string) {
  console.log(`\n[${signal}] Graceful shutdown initiated...`);

  // Stop stats logging
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }

  // Disconnect Massive WebSocket
  if (massiveClient) {
    console.log("Disconnecting Massive WebSocket...");
    massiveClient.disconnect();
    massiveClient = null;
  }

  console.log("Stopping scheduled jobs...");
  stopJobRuntime();

  // Close TimescaleDB connections
  console.log("Closing TimescaleDB connections...");
  await timescaleStore.close();

  // Close Redis connection
  console.log("Closing Redis connection...");
  await redisStore.redis.quit();

  console.log("Shutdown complete.");
  await flushSentry();
  process.exit(0);
}

// Handle process exit signals
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Start server
startHubServer();
