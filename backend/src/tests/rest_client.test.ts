import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  handleRequest,
  resetRateLimitsForTesting,
  setMassiveClientForTesting,
} from "@/server/api/rest_client.js";
import { redisStore } from "@/server/data/redis_store.js";
import { timescaleStore } from "@/server/data/timescale_store.js";
import { recoveryService } from "@/services/recovery_service.js";
import { frontMonthJob } from "@/jobs/front_month_job.js";
import { monthlySubscriptionJob } from "@/jobs/refresh_subscriptions.js";

function createRequest(
  path: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
  },
): Request {
  return new Request(`http://localhost${path}`, {
    method: init?.method ?? "GET",
    headers: init?.headers,
  });
}

describe("REST request handler", () => {
  beforeEach(() => {
    resetRateLimitsForTesting();
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
    expect(payload.status).toBe("ok");
    expect(payload.recovery.checkpointCount).toBe(2);
    expect(payload.symbols).toEqual(["ESH6", "NQH6"]);
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
    const response = await handleRequest(
      "GET",
      "/admin/subscriptions",
      createRequest("/admin/subscriptions", {
        headers: {
          "X-API-Key": Bun.env.HUB_API_KEY ?? "",
          Origin: "https://disallowed-admin-origin.example",
        },
      }),
    );

    expect(response.status).toBe(403);
  });

  test("rejects unauthenticated admin recovery backfill requests", async () => {
    const response = await handleRequest(
      "POST",
      "/admin/recovery/backfill",
      createRequest("/admin/recovery/backfill", { method: "POST" }),
    );

    expect(response.status).toBe(401);
  });

  test("runs manual recovery backfill for authorized requests", async () => {
    spyOn(redisStore, "getSubscribedSymbols").mockResolvedValue(["ESH6", "NQH6"]);
    const backfillSpy = spyOn(
      recoveryService,
      "backfillSymbolsFromProvider",
    ).mockResolvedValue([
      {
        symbol: "ESH6",
        source: "manual",
        startMs: 1,
        endMs: 2,
        providerBars: 3,
        checkpointBefore: 0,
        checkpointAfter: 1,
      },
      {
        symbol: "NQH6",
        source: "manual",
        startMs: 1,
        endMs: 2,
        providerBars: 4,
        checkpointBefore: 0,
        checkpointAfter: 1,
      },
    ]);

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

    expect(response.status).toBe(200);
    expect(backfillSpy).toHaveBeenCalledWith(["ESH6", "NQH6"], {
      source: "manual",
      excludeCurrentMinute: true,
    });
    expect(payload.providerBars).toBe(7);
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
