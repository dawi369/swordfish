import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  handleRequest,
  getProviderConnectionHealth,
  resetRateLimitsForTesting,
  setMassiveClientForTesting,
} from "@/server/api/rest_client.js";
import { redisStore } from "@/server/data/redis_store.js";
import { timescaleStore } from "@/server/data/timescale_store.js";
import { hotCacheRebuilder } from "@/services/hot_cache_rebuilder.js";
import { marketDataRepository } from "@/services/market_data_repository.js";
import { dailyClearJob } from "@/jobs/clear_daily.js";
import { frontMonthJob } from "@/jobs/front_month_job.js";
import { monthlySubscriptionJob } from "@/jobs/refresh_subscriptions.js";
import { telemetry } from "@/utils/telemetry.js";

function createRequest(
  path: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Request {
  return new Request(`http://localhost${path}`, {
    method: init?.method ?? "GET",
    headers: init?.headers,
    body: init?.body,
  });
}

describe("REST request handler", () => {
  beforeEach(() => {
    resetRateLimitsForTesting();
  });

  test("treats provider-disabled mode as healthy without a websocket", () => {
    expect(getProviderConnectionHealth(false, true)).toEqual({
      healthy: true,
      status: "disabled",
    });
  });

  test("returns minimal public health status", async () => {
    setMassiveClientForTesting({
      isConnected: () => true,
    } as any);

    spyOn(redisStore, "ping").mockResolvedValue("PONG");
    spyOn(redisStore, "getStats").mockResolvedValue({
      date: "2026-03-25",
      barCount: 10,
      symbolCount: 2,
      streamLength: 0,
    } as any);
    spyOn(redisStore, "getSymbols").mockResolvedValue(["ESH6", "NQH6"]);
    spyOn(timescaleStore, "ping").mockResolvedValue(true);
    spyOn(timescaleStore, "getDurableStats").mockResolvedValue({
      enabled: false,
      connected: false,
      timescaleAvailable: false,
      bars1m: {
        symbolCount: 0,
        barCount: 0,
        oldestBarTs: null,
        newestBarTs: null,
      },
      symbols: [],
    });
    spyOn(redisStore, "getAllLatestArray").mockResolvedValue([
      {
        symbol: "ESH6",
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 100,
        trades: 10,
        startTime: Date.now(),
        endTime: Date.now() + 60_000,
      },
      {
        symbol: "NQH6",
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 100,
        trades: 10,
        startTime: Date.now(),
        endTime: Date.now() + 60_000,
      },
    ]);
    spyOn(redisStore, "getAllSnapshots").mockResolvedValue({});
    spyOn(redisStore, "getAllActiveContracts").mockResolvedValue({});
    spyOn(redisStore, "getSubscribedSymbols").mockResolvedValue(["ESH6", "NQH6"]);
    spyOn(redisStore, "getAllRecoveryCheckpoints").mockResolvedValue({
      "1m:ESH6": { symbol: "ESH6" },
      "1m:NQH6": { symbol: "NQH6" },
    } as any);

    const response = await handleRequest(
      "GET",
      "/health",
      createRequest("/health"),
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.status).toBe("ok");
    expect(payload.services.massiveWs).toBe("connected");
    expect(payload.recovery).toBeUndefined();
    expect(payload.symbols).toBeUndefined();
  });

  test("returns detailed admin health status when authorized", async () => {
    setMassiveClientForTesting({
      isConnected: () => true,
    } as any);

    spyOn(redisStore, "ping").mockResolvedValue("PONG");
    spyOn(redisStore, "getStats").mockResolvedValue({
      date: "2026-03-25",
      barCount: 10,
      symbolCount: 2,
      streamLength: 0,
    } as any);
    spyOn(redisStore, "getSymbols").mockResolvedValue(["ESH6", "NQH6"]);
    spyOn(timescaleStore, "ping").mockResolvedValue(true);
    spyOn(timescaleStore, "getDurableStats").mockResolvedValue({
      enabled: false,
      connected: false,
      timescaleAvailable: false,
      bars1m: {
        symbolCount: 0,
        barCount: 0,
        oldestBarTs: null,
        newestBarTs: null,
      },
      symbols: [],
    });
    spyOn(redisStore, "getAllLatestArray").mockResolvedValue([
      {
        symbol: "ESH6",
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 100,
        trades: 10,
        startTime: Date.now(),
        endTime: Date.now() + 60_000,
      },
      {
        symbol: "NQH6",
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 100,
        trades: 10,
        startTime: Date.now(),
        endTime: Date.now() + 60_000,
      },
    ]);
    spyOn(redisStore, "getAllSnapshots").mockResolvedValue({});
    spyOn(redisStore, "getAllActiveContracts").mockResolvedValue({});
    spyOn(redisStore, "getSubscribedSymbols").mockResolvedValue(["ESH6", "NQH6"]);
    spyOn(redisStore, "getAllRecoveryCheckpoints").mockResolvedValue({
      "1m:ESH6": { symbol: "ESH6" },
      "1m:NQH6": { symbol: "NQH6" },
    } as any);

    const response = await handleRequest(
      "GET",
      "/admin/health",
      createRequest("/admin/health", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.status).toBe("warming");
    expect(payload.recovery.checkpointCount).toBe(2);
    expect(payload.symbols).toEqual(["ESH6", "NQH6"]);
    expect(payload.coverage.summary.byStatus.ok).toBe(2);
  });

  test("returns consolidated admin ops status when authorized", async () => {
    setMassiveClientForTesting({
      isConnected: () => true,
      getSubscriptions: () => [
        { ev: "A", assetClass: "us_indices", symbols: ["ESH6", "NQH6"] },
      ],
    } as any);

    spyOn(redisStore, "ping").mockResolvedValue("PONG");
    spyOn(redisStore, "getStats").mockResolvedValue({
      date: "2026-03-25",
      barCount: 10,
      symbolCount: 2,
    } as any);
    spyOn(timescaleStore, "ping").mockResolvedValue(true);
    spyOn(redisStore, "getAllLatestArray").mockResolvedValue([
      {
        symbol: "ESH6",
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 100,
        trades: 10,
        startTime: 1_774_404_000_000,
        endTime: 1_774_404_060_000,
      },
    ]);
    spyOn(redisStore, "getAllSnapshots").mockResolvedValue({
      ESH6: { productCode: "ES", timestamp: 1_774_404_000_000 },
    } as any);
    spyOn(redisStore, "getAllActiveContracts").mockResolvedValue({
      ES: { productCode: "ES", updatedAt: 1_774_404_000_000, contracts: [] },
    } as any);
    spyOn(redisStore, "getAllRecoveryCheckpoints").mockResolvedValue({
      "1m:ESH6": {
        symbol: "ESH6",
        timeframe: "1m",
        lastSeenBarTs: 1_774_404_000_000,
        updatedAt: 1_774_404_000_000,
        source: "live",
      },
    } as any);
    spyOn(redisStore, "getSubscribedSymbols").mockResolvedValue(["ESH6", "NQH6"]);

    const response = await handleRequest(
      "GET",
      "/admin/ops",
      createRequest("/admin/ops", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.services.redis).toBe("connected");
    expect(payload.redis.latestBarCount).toBe(1);
    expect(payload.redis.snapshotCount).toBe(1);
    expect(payload.jobs.snapshotRefresh.id).toBe("snapshot-refresh");
    expect(payload.subscriptions.totalSymbols).toBe(2);
  });

  test("uses provider outcomes to distinguish no-data from pending backfill", async () => {
    setMassiveClientForTesting({
      isConnected: () => true,
      getSubscriptions: () => [],
    } as any);

    spyOn(redisStore, "ping").mockResolvedValue("PONG");
    spyOn(redisStore, "getStats").mockResolvedValue({
      date: "2026-03-25",
      barCount: 0,
      symbolCount: 0,
    } as any);
    spyOn(timescaleStore, "ping").mockResolvedValue(true);
    spyOn(redisStore, "getAllLatestArray").mockResolvedValue([]);
    spyOn(redisStore, "getAllSnapshots").mockResolvedValue({});
    spyOn(redisStore, "getAllActiveContracts").mockResolvedValue({});
    spyOn(redisStore, "getAllRecoveryCheckpoints").mockResolvedValue({});
    spyOn(redisStore, "getSubscribedSymbols").mockResolvedValue(["ESH6", "NQH6"]);
    spyOn(timescaleStore, "getDurableStats").mockResolvedValue({
      enabled: true,
      connected: true,
      timescaleAvailable: false,
      bars1m: {
        symbolCount: 0,
        barCount: 0,
        oldestBarTs: null,
        newestBarTs: null,
      },
      symbols: [],
    });
    spyOn(timescaleStore, "getProviderFetchOutcomes").mockResolvedValue([
      {
        outcomeId: "provider:ESH6:1",
        provider: "massive",
        source: "provider_rest",
        symbol: "ESH6",
        timeframe: "1m",
        status: "empty",
        startMs: 1,
        endMs: 2,
        barCount: 0,
        error: null,
        metadata: {},
        createdAt: 3,
      },
    ]);

    const response = await handleRequest(
      "GET",
      "/admin/coverage",
      createRequest("/admin/coverage", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.summary.byStatus.provider_no_data).toBe(1);
    expect(payload.summary.byStatus.backfill_pending).toBe(1);
    expect(payload.symbols.find((row: any) => row.symbol === "ESH6").providerStatus).toBe(
      "empty",
    );
  });

  test("classifies stale latest bars outside active contracts", async () => {
    setMassiveClientForTesting({
      isConnected: () => true,
      getSubscriptions: () => [],
    } as any);

    spyOn(redisStore, "ping").mockResolvedValue("PONG");
    spyOn(redisStore, "getStats").mockResolvedValue({
      date: "2026-03-25",
      barCount: 1,
      symbolCount: 1,
    } as any);
    spyOn(timescaleStore, "ping").mockResolvedValue(true);
    spyOn(redisStore, "getAllLatestArray").mockResolvedValue([
      {
        symbol: "ESZ1",
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 100,
        trades: 10,
        startTime: 1,
        endTime: 60_001,
      },
    ]);
    spyOn(redisStore, "getAllSnapshots").mockResolvedValue({});
    spyOn(redisStore, "getAllActiveContracts").mockResolvedValue({
      ES: {
        productCode: "ES",
        updatedAt: Date.now(),
        contracts: [{ ticker: "ESH6", productCode: "ES", lastTradeDate: "2026-03-20", active: true }],
      },
    } as any);
    spyOn(redisStore, "getAllRecoveryCheckpoints").mockResolvedValue({});
    spyOn(redisStore, "getSubscribedSymbols").mockResolvedValue([]);
    spyOn(timescaleStore, "getDurableStats").mockResolvedValue({
      enabled: true,
      connected: true,
      timescaleAvailable: false,
      bars1m: {
        symbolCount: 0,
        barCount: 0,
        oldestBarTs: null,
        newestBarTs: null,
      },
      symbols: [],
    });
    spyOn(timescaleStore, "getProviderFetchOutcomes").mockResolvedValue([]);

    const response = await handleRequest(
      "GET",
      "/admin/coverage",
      createRequest("/admin/coverage", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.summary.byStatus.stale_contract).toBe(1);
    expect(payload.symbols[0].status).toBe("stale_contract");
  });

  test("classifies every coverage status deterministically", async () => {
    setMassiveClientForTesting({
      isConnected: () => true,
      getSubscriptions: () => [],
    } as any);

    const now = Date.now();
    spyOn(redisStore, "ping").mockResolvedValue("PONG");
    spyOn(redisStore, "getStats").mockResolvedValue({
      date: "2026-03-25",
      barCount: 3,
      symbolCount: 6,
    } as any);
    spyOn(timescaleStore, "ping").mockResolvedValue(true);
    spyOn(redisStore, "getAllLatestArray").mockResolvedValue([
      {
        symbol: "OKM6",
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 100,
        trades: 10,
        startTime: now,
        endTime: now + 60_000,
      },
      {
        symbol: "OLDM6",
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 100,
        trades: 10,
        startTime: now - 60 * 60 * 1000,
        endTime: now - 59 * 60 * 1000,
      },
      {
        symbol: "UNSUBM6",
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 100,
        trades: 10,
        startTime: now,
        endTime: now + 60_000,
      },
    ]);
    spyOn(redisStore, "getAllSnapshots").mockResolvedValue({});
    spyOn(redisStore, "getAllActiveContracts").mockResolvedValue({
      OK: {
        productCode: "OK",
        updatedAt: now,
        contracts: [
          { ticker: "OKM6", productCode: "OK", lastTradeDate: "2026-06-19", active: true },
        ],
      },
      OLD: {
        productCode: "OLD",
        updatedAt: now,
        contracts: [
          { ticker: "CURRENTM6", productCode: "OLD", lastTradeDate: "2026-06-19", active: true },
        ],
      },
    } as any);
    spyOn(redisStore, "getAllRecoveryCheckpoints").mockResolvedValue({});
    spyOn(redisStore, "getSubscribedSymbols").mockResolvedValue([
      "OKM6",
      "NOLIVEM6",
      "EMPTYM6",
      "PENDINGM6",
      "OLDM6",
    ]);
    spyOn(timescaleStore, "getDurableStats").mockResolvedValue({
      enabled: true,
      connected: true,
      timescaleAvailable: false,
      bars1m: {
        symbolCount: 2,
        barCount: 20,
        oldestBarTs: now - 60 * 60 * 1000,
        newestBarTs: now,
      },
      symbols: [
        {
          symbol: "OKM6",
          barCount: 10,
          firstBarTs: now - 10 * 60_000,
          lastBarTs: now,
          gapCount: 0,
          spikeCount: 0,
        },
        {
          symbol: "NOLIVEM6",
          barCount: 10,
          firstBarTs: now - 10 * 60_000,
          lastBarTs: now,
          gapCount: 0,
          spikeCount: 0,
        },
      ],
    });
    spyOn(timescaleStore, "getProviderFetchOutcomes").mockResolvedValue([
      {
        outcomeId: "provider:EMPTYM6:1",
        provider: "massive",
        source: "provider_rest",
        symbol: "EMPTYM6",
        timeframe: "1m",
        status: "empty",
        startMs: 1,
        endMs: 2,
        barCount: 0,
        error: null,
        metadata: {},
        createdAt: 3,
      },
    ]);

    const response = await handleRequest(
      "GET",
      "/admin/coverage",
      createRequest("/admin/coverage", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const payload = (await response.json()) as any;
    const statuses = Object.fromEntries(
      payload.symbols.map((row: any) => [row.symbol, row.status]),
    );

    expect(response.status).toBe(200);
    expect(statuses.OKM6).toBe("ok");
    expect(statuses.UNSUBM6).toBe("not_subscribed");
    expect(statuses.NOLIVEM6).toBe("subscribed_no_live_data");
    expect(statuses.EMPTYM6).toBe("provider_no_data");
    expect(statuses.PENDINGM6).toBe("backfill_pending");
    expect(statuses.OLDM6).toBe("stale_contract");
    expect(payload.summary.byStatus.ok).toBe(1);
    expect(payload.summary.byStatus.not_subscribed).toBe(1);
    expect(payload.summary.byStatus.subscribed_no_live_data).toBe(1);
    expect(payload.summary.byStatus.provider_no_data).toBe(1);
    expect(payload.summary.byStatus.backfill_pending).toBe(1);
    expect(payload.summary.byStatus.stale_contract).toBe(1);
  });

  test("returns durable inspection endpoints when authorized", async () => {
    spyOn(timescaleStore, "getRecentDurableSymbols").mockResolvedValue([
      {
        symbol: "ESH6",
        barCount: 120,
        firstBarTs: 1_774_400_000_000,
        lastBarTs: 1_774_407_200_000,
        gapCount: 1,
        spikeCount: 0,
      },
    ]);
    const latestBarsSpy = spyOn(timescaleStore, "getLatestDurableBars").mockResolvedValue([
      {
        symbol: "ESH6",
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 100,
        trades: 10,
        startTime: 1_774_407_200_000,
        endTime: 1_774_407_260_000,
        source: "live_ws",
        qualityFlags: {},
        ingestedAt: 1_774_407_261_000,
      },
    ]);
    spyOn(timescaleStore, "getProviderFetchOutcomes").mockResolvedValue([
      {
        outcomeId: "provider:ESH6:1",
        provider: "massive",
        source: "provider_rest",
        symbol: "ESH6",
        timeframe: "1m",
        status: "empty",
        startMs: 1,
        endMs: 2,
        barCount: 0,
        error: null,
        metadata: {},
        createdAt: 3,
      },
    ]);
    spyOn(timescaleStore, "getOperationalRuns").mockResolvedValue([
      {
        runId: "job:snapshot:1",
        runType: "job",
        name: "snapshot-refresh",
        status: "failed",
        trigger: "schedule",
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        counts: {},
        error: "boom",
        metadata: {},
      },
    ]);
    spyOn(timescaleStore, "getIngestionRuns").mockResolvedValue([
      {
        runId: "ingestion:flat_file:1",
        source: "flat_file",
        status: "success",
        startedAt: 1,
        completedAt: 2,
        symbolCount: 1,
        barCount: 120,
        error: null,
        metadata: {},
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    spyOn(timescaleStore, "getDurableQualitySummary").mockResolvedValue({
      symbol: "ESH6",
      startMs: 1,
      endMs: 2,
      barCount: 120,
      gapCount: 1,
      spikeCount: 2,
      invalidOhlcCount: 0,
      zeroVolumeCount: 3,
      negativeVolumeCount: 0,
      oldestBarTs: 1,
      newestBarTs: 2,
    });

    const headers = { "X-API-Key": Bun.env.HUB_API_KEY ?? "" };
    const symbolsResponse = await handleRequest(
      "GET",
      "/admin/durable/symbols",
      createRequest("/admin/durable/symbols?limit=10", { headers }),
    );
    const latestResponse = await handleRequest(
      "GET",
      "/admin/durable/bars/latest",
      createRequest("/admin/durable/bars/latest?symbols=ESH6,NQH6&limit=10&source=live_ws", {
        headers,
      }),
    );
    const outcomesResponse = await handleRequest(
      "GET",
      "/admin/durable/provider-outcomes",
      createRequest("/admin/durable/provider-outcomes?symbol=ESH6&status=empty", {
        headers,
      }),
    );
    const runsResponse = await handleRequest(
      "GET",
      "/admin/durable/operational-runs",
      createRequest("/admin/durable/operational-runs?runType=job&status=failed", {
        headers,
      }),
    );
    const ingestionRunsResponse = await handleRequest(
      "GET",
      "/admin/durable/ingestion-runs",
      createRequest("/admin/durable/ingestion-runs?source=flat_file&status=success", {
        headers,
      }),
    );
    const qualityResponse = await handleRequest(
      "GET",
      "/admin/durable/quality/ESH6",
      createRequest("/admin/durable/quality/ESH6?start=1&end=2", { headers }),
    );

    expect(symbolsResponse.status).toBe(200);
    expect(((await symbolsResponse.json()) as any).symbols[0].symbol).toBe("ESH6");
    expect(((await latestResponse.json()) as any).bars[0].source).toBe("live_ws");
    expect(latestBarsSpy).toHaveBeenCalledWith(["ESH6", "NQH6"], 10, "live_ws");
    expect(((await outcomesResponse.json()) as any).outcomes[0].status).toBe("empty");
    expect(((await runsResponse.json()) as any).runs[0].error).toBe("boom");
    expect(((await ingestionRunsResponse.json()) as any).runs[0].source).toBe("flat_file");
    expect(((await qualityResponse.json()) as any).spikeCount).toBe(2);
  });

  test("returns empty durable inspection payloads when durable data is absent", async () => {
    spyOn(timescaleStore, "getRecentDurableSymbols").mockResolvedValue([]);
    spyOn(timescaleStore, "getLatestDurableBars").mockResolvedValue([]);
    spyOn(timescaleStore, "getProviderFetchOutcomes").mockResolvedValue([]);
    spyOn(timescaleStore, "getOperationalRuns").mockResolvedValue([]);
    spyOn(timescaleStore, "getIngestionRuns").mockResolvedValue([]);
    spyOn(timescaleStore, "getDurableQualitySummary").mockResolvedValue({
      symbol: "ESH6",
      startMs: 1,
      endMs: 2,
      barCount: 0,
      gapCount: 0,
      spikeCount: 0,
      invalidOhlcCount: 0,
      zeroVolumeCount: 0,
      negativeVolumeCount: 0,
      oldestBarTs: null,
      newestBarTs: null,
    });

    const headers = { "X-API-Key": Bun.env.HUB_API_KEY ?? "" };
    const symbolsResponse = await handleRequest(
      "GET",
      "/admin/durable/symbols",
      createRequest("/admin/durable/symbols", { headers }),
    );
    const latestResponse = await handleRequest(
      "GET",
      "/admin/durable/bars/latest",
      createRequest("/admin/durable/bars/latest", { headers }),
    );
    const outcomesResponse = await handleRequest(
      "GET",
      "/admin/durable/provider-outcomes",
      createRequest("/admin/durable/provider-outcomes", { headers }),
    );
    const runsResponse = await handleRequest(
      "GET",
      "/admin/durable/operational-runs",
      createRequest("/admin/durable/operational-runs", { headers }),
    );
    const ingestionRunsResponse = await handleRequest(
      "GET",
      "/admin/durable/ingestion-runs",
      createRequest("/admin/durable/ingestion-runs", { headers }),
    );
    const qualityResponse = await handleRequest(
      "GET",
      "/admin/durable/quality/ESH6",
      createRequest("/admin/durable/quality/ESH6?start=1&end=2", { headers }),
    );

    expect(((await symbolsResponse.json()) as any).count).toBe(0);
    expect(((await latestResponse.json()) as any).bars).toEqual([]);
    expect(((await outcomesResponse.json()) as any).count).toBe(0);
    expect(((await runsResponse.json()) as any).runs).toEqual([]);
    expect(((await ingestionRunsResponse.json()) as any).runs).toEqual([]);
    expect(((await qualityResponse.json()) as any).barCount).toBe(0);
  });

  test("protects and validates durable inspection endpoints", async () => {
    const unauthorized = await handleRequest(
      "GET",
      "/admin/durable/symbols",
      createRequest("/admin/durable/symbols"),
    );
    const badOutcomeStatus = await handleRequest(
      "GET",
      "/admin/durable/provider-outcomes",
      createRequest("/admin/durable/provider-outcomes?status=weird", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const badIngestionSource = await handleRequest(
      "GET",
      "/admin/durable/ingestion-runs",
      createRequest("/admin/durable/ingestion-runs?source=live_ws", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const badLatestSource = await handleRequest(
      "GET",
      "/admin/durable/bars/latest",
      createRequest("/admin/durable/bars/latest?source=bad_source", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const missingRange = await handleRequest(
      "GET",
      "/admin/durable/quality/ESH6",
      createRequest("/admin/durable/quality/ESH6", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );

    expect(unauthorized.status).toBe(401);
    expect(badOutcomeStatus.status).toBe(400);
    expect(badIngestionSource.status).toBe(400);
    expect(badLatestSource.status).toBe(400);
    expect(missingRange.status).toBe(400);
  });

  test("lists and runs allowlisted admin diagnostic commands", async () => {
    setMassiveClientForTesting({
      isConnected: () => true,
      getSubscriptions: () => [
        { ev: "A", assetClass: "us_indices", symbols: ["ESH6", "NQH6"] },
      ],
    } as any);

    spyOn(redisStore, "ping").mockResolvedValue("PONG");
    spyOn(redisStore, "getStats").mockResolvedValue({
      date: "2026-03-25",
      barCount: 10,
      symbolCount: 2,
    } as any);
    spyOn(timescaleStore, "ping").mockResolvedValue(true);
    spyOn(redisStore, "getAllLatestArray").mockResolvedValue([]);
    spyOn(redisStore, "getAllSnapshots").mockResolvedValue({});
    spyOn(redisStore, "getAllActiveContracts").mockResolvedValue({});
    spyOn(redisStore, "getAllRecoveryCheckpoints").mockResolvedValue({});
    spyOn(redisStore, "getSubscribedSymbols").mockResolvedValue(["ESH6", "NQH6"]);
    spyOn(hotCacheRebuilder, "rebuildLatestWindow").mockResolvedValue({
      symbols: 2,
      hydratedSymbols: 1,
      barsLoaded: 120,
      skippedSymbols: ["NQH6"],
    });
    spyOn(redisStore.redis, "multi").mockReturnValue({
      lpush: () => ({
        ltrim: () => ({
          exec: async () => [],
        }),
      }),
    } as any);

    const listResponse = await handleRequest(
      "GET",
      "/admin/commands",
      createRequest("/admin/commands", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const listPayload = (await listResponse.json()) as any;

    expect(listResponse.status).toBe(200);
    expect(listPayload.commands.some((command: any) => command.id === "health")).toBe(true);

    const runResponse = await handleRequest(
      "POST",
      "/admin/commands/health/run",
      createRequest("/admin/commands/health/run", {
        method: "POST",
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const runPayload = (await runResponse.json()) as any;

    expect(runResponse.status).toBe(200);
    expect(runPayload.command.id).toBe("health");
    expect(runPayload.lines.length).toBeGreaterThan(0);
    expect(runPayload.output.status).toBe("warming");

    const dryRunResponse = await handleRequest(
      "POST",
      "/admin/commands/hot-cache-rebuild-dry-run/run",
      createRequest("/admin/commands/hot-cache-rebuild-dry-run/run", {
        method: "POST",
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const dryRunPayload = (await dryRunResponse.json()) as any;

    expect(dryRunResponse.status).toBe(200);
    expect(dryRunPayload.command.id).toBe("hot-cache-rebuild-dry-run");
    expect(dryRunPayload.output.barsLoaded).toBe(120);
  });

  test("returns recovery checkpoints when authorized", async () => {
    spyOn(redisStore, "getAllRecoveryCheckpoints").mockResolvedValue({
      "1m:ESH6": {
        symbol: "ESH6",
        timeframe: "1m",
        lastSeenBarTs: 1,
        updatedAt: 2,
        source: "live",
      },
    } as any);

    const response = await handleRequest(
      "GET",
      "/admin/recovery/checkpoints",
      createRequest("/admin/recovery/checkpoints", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(payload.checkpoints["1m:ESH6"].symbol).toBe("ESH6");
  });

  test("rejects recovery checkpoints when unauthorized", async () => {
    const response = await handleRequest(
      "GET",
      "/admin/recovery/checkpoints",
      createRequest("/admin/recovery/checkpoints"),
    );

    expect(response.status).toBe(401);
  });

  test("reflects allowed local dev origins and rejects disallowed origins", async () => {
    setMassiveClientForTesting({
      isConnected: () => true,
    } as any);

    spyOn(redisStore, "ping").mockResolvedValue("PONG");
    spyOn(redisStore, "getStats").mockResolvedValue({
      date: "2026-03-25",
      barCount: 10,
      symbolCount: 2,
      streamLength: 0,
    } as any);
    spyOn(redisStore, "getSymbols").mockResolvedValue(["ESH6", "NQH6"]);
    spyOn(timescaleStore, "ping").mockResolvedValue(true);
    spyOn(redisStore, "getAllRecoveryCheckpoints").mockResolvedValue({} as any);

    const allowed = await handleRequest(
      "GET",
      "/health",
      createRequest("/health", {
        headers: { Origin: "http://localhost:3010" },
      }),
    );
    const denied = await handleRequest(
      "GET",
      "/health",
      createRequest("/health", {
        headers: { Origin: "https://evil.example" },
      }),
    );

    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3010",
    );
    expect(denied.status).toBe(403);
  });

  test("validates required range query params", async () => {
    const response = await handleRequest(
      "GET",
      "/bars/range/ESH9",
      createRequest("/bars/range/ESH9"),
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(400);
    expect(payload.error).toContain("start and end");
  });

  test("returns degraded range payloads from the repository without failing the route", async () => {
    spyOn(marketDataRepository, "getBarsRange").mockResolvedValue({
      symbol: "ESH9",
      tf: "1m",
      start: 1,
      end: 2,
      source: "empty",
      bars: [],
      quality: {
        gapCount: 0,
        spikeCount: 0,
        invalidOhlcCount: 0,
        zeroVolumeCount: 0,
        negativeVolumeCount: 0,
        oldestBarTs: null,
        newestBarTs: null,
        freshness: "unknown",
      },
    });

    const response = await handleRequest(
      "GET",
      "/bars/range/ESH9",
      createRequest("/bars/range/ESH9?start=1&end=2&tf=1m"),
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(payload.source).toBe("empty");
    expect(payload.count).toBe(0);
    expect(payload.quality.freshness).toBe("unknown");
  });

  test("returns latest bars and symbol-specific latest responses", async () => {
    spyOn(redisStore, "getAllLatestArray").mockResolvedValue([
      {
        symbol: "ESH9",
        close: 10.5,
      },
    ] as any);
    spyOn(redisStore, "getLatest").mockResolvedValue({
      symbol: "ESH9",
      close: 10.5,
    } as any);

    const latestResponse = await handleRequest(
      "GET",
      "/admin/bars/latest",
      createRequest("/admin/bars/latest", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const symbolResponse = await handleRequest(
      "GET",
      "/admin/bars/latest/ESH9",
      createRequest("/admin/bars/latest/ESH9", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const latestPayload = (await latestResponse.json()) as any;
    const symbolPayload = (await symbolResponse.json()) as any;

    expect(latestPayload.count).toBe(1);
    expect(symbolPayload.symbol).toBe("ESH9");
  });

  test("sets and reads the public open ticker for 1s Redis retention", async () => {
    const setSpy = spyOn(redisStore, "setOpenTicker").mockResolvedValue();
    const getSpy = spyOn(redisStore, "getOpenTicker").mockResolvedValue("ESH6");

    const setResponse = await handleRequest(
      "POST",
      "/bars/open-ticker",
      createRequest("/bars/open-ticker", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3010",
        },
        body: JSON.stringify({ symbol: "esh6" }),
      }),
    );
    const setPayload = (await setResponse.json()) as any;

    const getResponse = await handleRequest(
      "GET",
      "/bars/open-ticker",
      createRequest("/bars/open-ticker"),
    );
    const getPayload = (await getResponse.json()) as any;
    const clearResponse = await handleRequest(
      "DELETE",
      "/bars/open-ticker",
      createRequest("/bars/open-ticker", {
        method: "DELETE",
        headers: {
          Origin: "http://localhost:3010",
        },
      }),
    );
    const clearPayload = (await clearResponse.json()) as any;

    expect(setResponse.status).toBe(200);
    expect(setResponse.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
    expect(setSpy).toHaveBeenCalledWith("ESH6");
    expect(setPayload.symbol).toBe("ESH6");
    expect(getResponse.status).toBe(200);
    expect(getSpy).toHaveBeenCalled();
    expect(getPayload.symbol).toBe("ESH6");
    expect(clearResponse.status).toBe(200);
    expect(setSpy).toHaveBeenCalledWith(null);
    expect(clearPayload.symbol).toBeNull();
  });

  test("rejects open ticker mutations without an allowed browser origin", async () => {
    const setSpy = spyOn(redisStore, "setOpenTicker").mockResolvedValue();

    const noOriginResponse = await handleRequest(
      "POST",
      "/bars/open-ticker",
      createRequest("/bars/open-ticker", {
        method: "POST",
        body: JSON.stringify({ symbol: "ESH6" }),
      }),
    );
    const badOriginResponse = await handleRequest(
      "POST",
      "/bars/open-ticker",
      createRequest("/bars/open-ticker", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ symbol: "ESH6" }),
      }),
    );

    expect(noOriginResponse.status).toBe(403);
    expect(badOriginResponse.status).toBe(403);
    expect(setSpy).not.toHaveBeenCalled();
  });

  test("returns 404 for unknown latest/session/snapshot resources", async () => {
    spyOn(redisStore, "getLatest").mockResolvedValue(null);
    spyOn(redisStore, "getSession").mockResolvedValue(null);
    spyOn(redisStore, "getSnapshot").mockResolvedValue(null);

    const latest = await handleRequest(
      "GET",
      "/admin/bars/latest/NOPE",
      createRequest("/admin/bars/latest/NOPE", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const session = await handleRequest(
      "GET",
      "/session/NOPE",
      createRequest("/session/NOPE"),
    );
    const snapshot = await handleRequest(
      "GET",
      "/snapshot/NOPE",
      createRequest("/snapshot/NOPE"),
    );

    expect(latest.status).toBe(404);
    expect(session.status).toBe(404);
    expect(snapshot.status).toBe(404);
  });

  test("returns current-session bars and week session history", async () => {
    spyOn(redisStore, "getSessionBars").mockResolvedValue([
      {
        symbol: "ESH9",
        close: 10.5,
      },
    ] as any);
    spyOn(redisStore, "getSessionHistory").mockResolvedValue([
      {
        sessionId: "2026-03-25",
        dayOpen: 10,
      },
      {
        sessionId: "2026-03-26",
        dayOpen: 11,
      },
    ] as any);

    const barsResponse = await handleRequest(
      "GET",
      "/bars/session/ESH9",
      createRequest("/bars/session/ESH9?tf=1m&ts=123"),
    );
    const historyResponse = await handleRequest(
      "GET",
      "/sessions/week/ESH9",
      createRequest("/sessions/week/ESH9?start=1&end=2"),
    );
    const barsPayload = (await barsResponse.json()) as any;
    const historyPayload = (await historyResponse.json()) as any;

    expect(barsPayload.count).toBe(1);
    expect(historyPayload.count).toBe(2);
    expect(historyPayload.sessions[0].sessionId).toBe("2026-03-25");
  });

  test("returns empty front-month bootstrap payload when cache is missing", async () => {
    spyOn(frontMonthJob, "getCache").mockReturnValue(null);

    const response = await handleRequest(
      "GET",
      "/admin/front-months",
      createRequest("/admin/front-months", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const payload = (await response.json()) as any;

    expect(payload.lastUpdated).toBeNull();
    expect(payload.products).toEqual({});
    expect(payload.message).toContain("Cache not yet populated");
  });

  test("returns contract metadata and admin subscriptions when authorized", async () => {
    spyOn(redisStore, "getActiveContracts").mockResolvedValue({
      productCode: "ES",
      contracts: [{ ticker: "ESH9" }],
    } as any);

    setMassiveClientForTesting({
      getSubscriptions: () => [
        { ev: "A", symbols: ["ESH9", "NQH9"], assetClass: "us_indices" },
      ],
    } as any);

    const contractsResponse = await handleRequest(
      "GET",
      "/admin/contracts/active/ES",
      createRequest("/admin/contracts/active/ES", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const adminResponse = await handleRequest(
      "GET",
      "/admin/subscriptions",
      createRequest("/admin/subscriptions", {
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const contractsPayload = (await contractsResponse.json()) as any;
    const adminPayload = (await adminResponse.json()) as any;

    expect(contractsPayload.productCode).toBe("ES");
    expect(adminPayload.totalSymbols).toBe(2);
  });

  test("rejects browser-origin admin requests unless explicitly allowed", async () => {
    setMassiveClientForTesting({
      getSubscriptions: () => [],
    } as any);

    const allowedResponse = await handleRequest(
      "GET",
      "/admin/subscriptions",
      createRequest("/admin/subscriptions", {
        headers: {
          "X-API-Key": Bun.env.HUB_API_KEY ?? "",
          Origin: "http://localhost:3010",
        },
      }),
    );
    const rejectedResponse = await handleRequest(
      "GET",
      "/admin/subscriptions",
      createRequest("/admin/subscriptions", {
        headers: {
          "X-API-Key": Bun.env.HUB_API_KEY ?? "",
          Origin: "https://disallowed-admin-origin.example",
        },
      }),
    );

    expect(allowedResponse.status).toBe(200);
    expect(allowedResponse.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3010",
    );
    expect(rejectedResponse.status).toBe(403);
  });

  test("rejects unauthenticated admin recovery backfill requests", async () => {
    const response = await handleRequest(
      "POST",
      "/admin/recovery/backfill",
      createRequest("/admin/recovery/backfill", { method: "POST" }),
    );

    expect(response.status).toBe(401);
  });

  test("returns disabled for authorized manual recovery backfill requests", async () => {
    const metricSpy = spyOn(telemetry, "metric").mockImplementation(() => {});

    const response = await handleRequest(
      "POST",
      "/admin/recovery/backfill",
      createRequest("/admin/recovery/backfill", {
        method: "POST",
        headers: {
          "X-API-Key": Bun.env.HUB_API_KEY ?? "",
        },
      }),
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(410);
    expect(payload.status).toBe("disabled");
    expect(payload.providerBars).toBe(0);
    expect(payload.message).toContain("Provider REST backfill is disabled");
    expect(metricSpy).toHaveBeenCalledWith({
      name: "swordfish.admin_action.run",
      type: "counter",
      value: 1,
      tags: {
        action: "recovery-backfill-disabled",
        status: "success",
      },
    });
  });

  test("does not resolve symbols for targeted manual recovery backfill requests", async () => {
    const getSubscribedSpy = spyOn(redisStore, "getSubscribedSymbols");

    const response = await handleRequest(
      "POST",
      "/admin/recovery/backfill",
      createRequest("/admin/recovery/backfill?symbols=esh6,ESH6", {
        method: "POST",
        headers: {
          "X-API-Key": Bun.env.HUB_API_KEY ?? "",
        },
      }),
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(410);
    expect(getSubscribedSpy).not.toHaveBeenCalled();
    expect(payload.status).toBe("disabled");
    expect(payload.providerBars).toBe(0);
  });

  test("returns not found for unknown routes and handles refresh-subscription failures", async () => {
    spyOn(monthlySubscriptionJob, "runRefresh").mockRejectedValue(
      new Error("refresh failed"),
    );

    const notFound = await handleRequest(
      "GET",
      "/definitely-missing",
      createRequest("/definitely-missing"),
    );
    const refresh = await handleRequest(
      "POST",
      "/admin/refresh-subscriptions",
      createRequest("/admin/refresh-subscriptions", {
        method: "POST",
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );

    expect(notFound.status).toBe(404);
    expect(refresh.status).toBe(500);
    expect(((await refresh.json()) as any).details).toContain("refresh failed");
  });

  test("allows Trigger.dev to run scheduled Redis maintenance without forcing a clear", async () => {
    const runClearSpy = spyOn(dailyClearJob, "runClear").mockResolvedValue();
    spyOn(dailyClearJob, "getStatus").mockReturnValue({
      lastRunTime: 1,
      lastSuccess: true,
      lastError: null,
      clearedKeys: 0,
      totalRuns: 1,
    } as any);

    const response = await handleRequest(
      "POST",
      "/admin/clear-redis",
      createRequest("/admin/clear-redis?force=false", {
        method: "POST",
        headers: { "X-API-Key": Bun.env.HUB_API_KEY ?? "" },
      }),
    );
    const payload = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(runClearSpy).toHaveBeenCalledWith(false, "trigger.dev");
    expect(payload.message).toBe("Scheduled Redis maintenance triggered");
  });

  test("rate limits repeated public requests from the same client", async () => {
    setMassiveClientForTesting({
      isConnected: () => true,
    } as any);

    spyOn(redisStore, "ping").mockResolvedValue("PONG");
    spyOn(redisStore, "getStats").mockResolvedValue({
      date: "2026-03-25",
      barCount: 10,
      symbolCount: 2,
      streamLength: 0,
    } as any);
    spyOn(redisStore, "getSymbols").mockResolvedValue(["ESH6", "NQH6"]);
    spyOn(timescaleStore, "ping").mockResolvedValue(true);
    spyOn(redisStore, "getAllRecoveryCheckpoints").mockResolvedValue({} as any);

    let response: Response | null = null;
    for (let i = 0; i <= 240; i++) {
      response = await handleRequest(
        "GET",
        "/health",
        createRequest("/health", {
          headers: { "x-forwarded-for": "203.0.113.10" },
        }),
      );
    }

    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).not.toBeNull();
  });

  test("rate limits repeated admin requests from the same client", async () => {
    setMassiveClientForTesting({
      getSubscriptions: () => [],
    } as any);

    let response: Response | null = null;
    for (let i = 0; i <= 60; i++) {
      response = await handleRequest(
        "GET",
        "/admin/subscriptions",
        createRequest("/admin/subscriptions", {
          headers: {
            "X-API-Key": Bun.env.HUB_API_KEY ?? "",
            "x-forwarded-for": "203.0.113.11",
          },
        }),
      );
    }

    expect(response?.status).toBe(429);
    expect(response?.headers.get("X-RateLimit-Limit")).toBe("60");
  });
});
