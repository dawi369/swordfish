import { describe, expect, test } from "bun:test";
import { runProductionDataLayerVerification } from "../../dev_scripts/verify_production_data_layer";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createVerifierFetch(overrides: Record<string, unknown> = {}) {
  const nowMs = Date.now();
  const calls: Array<{
    url: string;
    method: string;
    apiKey: string | null;
  }> = [];
  const payloads: Record<string, unknown> = {
    "/health": {
      status: "ok",
      services: {
        redis: "connected",
        timescaledb: "connected",
        massiveWs: "connected",
      },
    },
    "/admin/health": {
      durable: {
        enabled: true,
        connected: true,
        bars1m: {
          symbolCount: 1,
          barCount: 10,
        },
      },
    },
    "/admin/durable/symbols?limit=25": {
      count: 1,
      symbols: [
        {
          symbol: "ESH6",
          barCount: 10,
          lastBarTs: 1,
        },
      ],
    },
    "/admin/durable/bars/latest?limit=25&source=live_ws": {
      count: 1,
      bars: [
        {
          symbol: "ESH6",
          source: "live_ws",
          startTime: nowMs,
        },
      ],
    },
    "/admin/coverage": {
      summary: {
        durableSymbols: 1,
        byStatus: {
          ok: 1,
        },
      },
    },
    "/admin/durable/provider-outcomes?limit=25": {
      count: 1,
      outcomes: [
        {
          symbol: "ESH6",
          status: "success",
          barCount: 10,
        },
      ],
    },
    "/admin/durable/ingestion-runs?limit=25": {
      count: 1,
      runs: [
        {
          runId: "ingestion:provider_rest:1",
          source: "provider_rest",
          status: "success",
          barCount: 10,
        },
      ],
    },
    "/admin/commands/hot-cache-rebuild-dry-run/run": {
      output: {
        symbols: 1,
        hydratedSymbols: 1,
        barsLoaded: 10,
      },
    },
    ...overrides,
  };

  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname + parsedUrl.search;
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? "GET",
      apiKey: headers.get("X-API-Key"),
    });
    return jsonResponse(payloads[path] ?? {}, payloads[path] ? 200 : 404);
  };

  return { fetcher, calls };
}

describe("production data-layer verifier", () => {
  test("passes only after all production acceptance gates respond with durable evidence", async () => {
    const { fetcher, calls } = createVerifierFetch();

    const result = await runProductionDataLayerVerification({
      baseUrl: "https://backend.example.com/",
      apiKey: "test-key",
      fetcher,
      nowMs: Date.now(),
      log: () => {},
      error: () => {},
    });

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(8);
    expect(calls.map((call) => new URL(call.url).pathname + new URL(call.url).search)).toEqual([
      "/health",
      "/admin/health",
      "/admin/durable/symbols?limit=25",
      "/admin/durable/bars/latest?limit=25&source=live_ws",
      "/admin/coverage",
      "/admin/durable/provider-outcomes?limit=25",
      "/admin/durable/ingestion-runs?limit=25",
      "/admin/commands/hot-cache-rebuild-dry-run/run",
    ]);
    expect(calls.filter((call) => call.url.includes("/admin/")).every((call) => call.apiKey === "test-key")).toBe(true);
  });

  test("fails when durable rows exist but none came from the live websocket path", async () => {
    const { fetcher } = createVerifierFetch({
      "/admin/durable/bars/latest?limit=25&source=live_ws": {
        count: 1,
        bars: [
          {
            symbol: "ESH6",
            source: "provider_rest",
            startTime: 1,
          },
        ],
      },
    });

    const result = await runProductionDataLayerVerification({
      baseUrl: "https://backend.example.com",
      apiKey: "test-key",
      fetcher,
      nowMs: Date.now(),
      log: () => {},
      error: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.results.find((check) => check.name === "live durable bars_1m rows")).toEqual(
      expect.objectContaining({
        ok: false,
      }),
    );
  });

  test("fails when Redis hot serving is not healthy", async () => {
    const { fetcher } = createVerifierFetch({
      "/health": {
        status: "degraded",
        services: {
          redis: "disconnected",
          timescaledb: "connected",
          massiveWs: "connected",
        },
      },
    });

    const result = await runProductionDataLayerVerification({
      baseUrl: "https://backend.example.com",
      apiKey: "test-key",
      fetcher,
      nowMs: Date.now(),
      log: () => {},
      error: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.results.find((check) => check.name === "public health serving stores")).toEqual(
      expect.objectContaining({
        ok: false,
      }),
    );
  });

  test("fails when Massive websocket is not connected", async () => {
    const { fetcher } = createVerifierFetch({
      "/health": {
        status: "degraded",
        services: {
          redis: "connected",
          timescaledb: "connected",
          massiveWs: "disconnected",
        },
      },
    });

    const result = await runProductionDataLayerVerification({
      baseUrl: "https://backend.example.com",
      apiKey: "test-key",
      fetcher,
      nowMs: Date.now(),
      log: () => {},
      error: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.results.find((check) => check.name === "public health serving stores")).toEqual(
      expect.objectContaining({
        ok: false,
      }),
    );
  });

  test("fails when ingestion audit rows do not include a successful run with bars", async () => {
    const { fetcher } = createVerifierFetch({
      "/admin/durable/ingestion-runs?limit=25": {
        count: 2,
        runs: [
          {
            runId: "ingestion:provider_rest:1",
            source: "provider_rest",
            status: "failed",
            barCount: 0,
          },
          {
            runId: "ingestion:provider_rest:2",
            source: "provider_rest",
            status: "success",
            barCount: 0,
          },
        ],
      },
    });

    const result = await runProductionDataLayerVerification({
      baseUrl: "https://backend.example.com",
      apiKey: "test-key",
      fetcher,
      nowMs: Date.now(),
      log: () => {},
      error: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.results.find((check) => check.name === "durable ingestion runs")).toEqual(
      expect.objectContaining({
        ok: false,
      }),
    );
  });

  test("fails when provider outcome rows only record failed fetches", async () => {
    const { fetcher } = createVerifierFetch({
      "/admin/durable/provider-outcomes?limit=25": {
        count: 1,
        outcomes: [
          {
            symbol: "ESH6",
            status: "failed",
            barCount: 0,
          },
        ],
      },
    });

    const result = await runProductionDataLayerVerification({
      baseUrl: "https://backend.example.com",
      apiKey: "test-key",
      fetcher,
      nowMs: Date.now(),
      log: () => {},
      error: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.results.find((check) => check.name === "provider fetch outcomes")).toEqual(
      expect.objectContaining({
        ok: false,
      }),
    );
  });

  test("fails when the latest live websocket durable row is stale", async () => {
    const nowMs = 1_800_000;
    const { fetcher } = createVerifierFetch({
      "/admin/durable/bars/latest?limit=25&source=live_ws": {
        count: 1,
        bars: [
          {
            symbol: "ESH6",
            source: "live_ws",
            startTime: 1,
          },
        ],
      },
    });

    const result = await runProductionDataLayerVerification({
      baseUrl: "https://backend.example.com",
      apiKey: "test-key",
      fetcher,
      maxLiveBarAgeMs: 20 * 60 * 1000,
      nowMs,
      log: () => {},
      error: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.results.find((check) => check.name === "live durable bars_1m rows")).toEqual(
      expect.objectContaining({
        ok: false,
      }),
    );
  });
});
