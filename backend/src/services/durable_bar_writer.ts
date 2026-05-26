import {
  timescaleStore,
  type BarIngestionSource,
} from "@/server/data/timescale_store.js";
import type { Bar } from "@/types/common.types.js";
import { captureMessageWithContext } from "@/utils/sentry.js";
import { telemetry } from "@/utils/telemetry.js";

export interface DurableBarsWriteResult {
  source: Exclude<BarIngestionSource, "live_ws">;
  bars: number;
  durable: "ok" | "failed" | "disabled";
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createIngestionRunId(
  source: Exclude<BarIngestionSource, "live_ws">,
  startedAt: number,
): string {
  return `ingestion:${source}:${startedAt}:${crypto.randomUUID().slice(0, 8)}`;
}

export class DurableBarWriter {
  async writeDurableBars(
    bars: Bar[],
    source: Exclude<BarIngestionSource, "live_ws">,
  ): Promise<DurableBarsWriteResult> {
    const startedAt = Date.now();
    const runId = createIngestionRunId(source, startedAt);
    const symbolCount = new Set(bars.map((bar) => bar.symbol)).size;

    await timescaleStore.recordIngestionRun({
      runId,
      source,
      status: "started",
      startedAt,
      completedAt: null,
      symbolCount,
      barCount: bars.length,
      metadata: {
        inputBars: bars.length,
      },
    });

    try {
      const written = await timescaleStore.upsertBars1m(bars, source);
      const result: DurableBarsWriteResult = {
        source,
        bars: written,
        durable: written > 0 ? "ok" : "disabled",
      };
      await timescaleStore.recordIngestionRun({
        runId,
        source,
        status: "success",
        startedAt,
        completedAt: Date.now(),
        symbolCount,
        barCount: written,
        metadata: {
          inputBars: bars.length,
        },
      });

      telemetry.metric({
        name: "swordfish.market_data.durable_write",
        type: "counter",
        value: 1,
        tags: {
          source,
          durable: result.durable,
        },
      });
      telemetry.metric({
        name: "swordfish.market_data.durable_bars",
        type: "gauge",
        value: written,
        tags: {
          source,
        },
      });

      return result;
    } catch (error) {
      const message = errorMessage(error);
      await timescaleStore.recordIngestionRun({
        runId,
        source,
        status: "failed",
        startedAt,
        completedAt: Date.now(),
        symbolCount,
        barCount: 0,
        error: message,
        metadata: {
          inputBars: bars.length,
        },
      });
      telemetry.metric({
        name: "swordfish.market_data.durable_write",
        type: "counter",
        value: 1,
        tags: {
          source,
          durable: "failed",
        },
      });
      captureMessageWithContext("Durable market data write failed", {
        level: "warning",
        tags: {
          component: "durable-bar-writer",
          ingestion_source: source,
        },
        extra: {
          bars: bars.length,
          error: message,
        },
      });

      return {
        source,
        bars: 0,
        durable: "failed",
        error: message,
      };
    }
  }
}

export const durableBarWriter = new DurableBarWriter();
