import {
  durableBarWriter,
  type DurableBarsWriteResult,
} from "@/services/durable_bar_writer.js";
import { recoveryService } from "@/services/recovery_service.js";
import { redisStore } from "@/server/data/redis_store.js";
import {
  timescaleStore,
  type BarIngestionSource,
} from "@/server/data/timescale_store.js";
import type { Bar } from "@/types/common.types.js";
import { captureMessageWithContext } from "@/utils/sentry.js";
import { telemetry } from "@/utils/telemetry.js";

export interface MarketDataWriteResult {
  redis: "ok" | "failed";
  recovery: "ok" | "failed";
  durable: "ok" | "failed" | "disabled";
  errors: {
    redis?: string;
    recovery?: string;
    durable?: string;
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class MarketDataWriter {
  async writeLiveBar(bar: Bar): Promise<MarketDataWriteResult> {
    const operations = await Promise.allSettled([
      redisStore.writeBar(bar),
      recoveryService.persistLiveBar(bar),
      timescaleStore.upsertBar1m(bar, "live_ws"),
    ]);

    const result: MarketDataWriteResult = {
      redis: operations[0]?.status === "fulfilled" ? "ok" : "failed",
      recovery: operations[1]?.status === "fulfilled" ? "ok" : "failed",
      durable:
        operations[2]?.status === "fulfilled"
          ? operations[2].value > 0
            ? "ok"
            : "disabled"
          : "failed",
      errors: {},
    };

    if (operations[0]?.status === "rejected") {
      result.errors.redis = errorMessage(operations[0].reason);
    }
    if (operations[1]?.status === "rejected") {
      result.errors.recovery = errorMessage(operations[1].reason);
    }
    if (operations[2]?.status === "rejected") {
      result.errors.durable = errorMessage(operations[2].reason);
    }

    if (Object.keys(result.errors).length > 0) {
      telemetry.metric({
        name: "swordfish.market_data.write_partial_failure",
        type: "counter",
        value: 1,
        tags: {
          symbol: bar.symbol,
          redis: result.redis,
          recovery: result.recovery,
          durable: result.durable,
        },
      });
      captureMessageWithContext("Live market data write partially failed", {
        level: "warning",
        tags: {
          component: "market-data-writer",
          symbol: bar.symbol,
          ingestion_source: "live_ws",
          redis: result.redis,
          recovery: result.recovery,
          durable: result.durable,
        },
        extra: {
          result,
          barStartTime: bar.startTime,
        },
      });
    } else {
      telemetry.metric({
        name: "swordfish.market_data.write_success",
        type: "counter",
        value: 1,
        tags: {
          symbol: bar.symbol,
          durable: result.durable,
        },
      });
    }

    return result;
  }

  async writeDurableBars(
    bars: Bar[],
    source: Exclude<BarIngestionSource, "live_ws">,
  ): Promise<DurableBarsWriteResult> {
    return durableBarWriter.writeDurableBars(bars, source);
  }
}

export const marketDataWriter = new MarketDataWriter();
