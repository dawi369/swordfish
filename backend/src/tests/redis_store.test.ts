import { describe, test, expect, beforeAll, afterAll, mock, spyOn } from "bun:test";
import { redisStore } from "@/server/data/redis_store.js";
import type { Bar } from "@/types/common.types.js";

const runRedisTests = Bun.env.RUN_REDIS_TESTS === "1";

async function ensureRedisAvailable(): Promise<void> {
  try {
    const pong = await redisStore.redis.ping();
    if (pong === "PONG") {
      return;
    }
  } catch {
    // Fall through to an explicit connect attempt.
  }

  const status = redisStore.redis.status;
  if (status === "wait" || status === "end") {
    try {
      await redisStore.redis.connect();
    } catch (error) {
      redisStore.redis.disconnect();
      throw new Error(
        `Redis test runtime requires a reachable Redis instance: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (status === "connecting" || status === "connect") {
    const deadline = Date.now() + 2_000;
    while (
      (redisStore.redis.status === "connecting" || redisStore.redis.status === "connect") &&
      Date.now() < deadline
    ) {
      await Bun.sleep(25);
    }
  }

  try {
    const pong = await redisStore.redis.ping();
    if (pong !== "PONG") {
      throw new Error("Unexpected Redis ping response");
    }
  } catch (error) {
    throw new Error(
      `Redis test runtime requires a reachable Redis instance: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Redis Store Unit Tests
 *
 * Run with: bun test src/tests/redis_store.test.ts
 */

describe.skipIf(!runRedisTests)("RedisStore", () => {
  const testSymbol = "ESZ8";

  beforeAll(async () => {
    await ensureRedisAvailable();
  });

  afterAll(async () => {
    try {
      const sessionKeys = await redisStore.redis.keys(`session:${testSymbol}:*`);
      if (sessionKeys.length > 0) {
        await redisStore.redis.del(...sessionKeys);
      }
      await redisStore.redis.hdel("bar:latest", testSymbol);
      await redisStore.redis.del(`snapshot:${testSymbol}`);
      await redisStore.redis.srem("meta:index:snapshots", testSymbol);
    } catch {
      // Ignore cleanup failures when Redis is already unavailable.
    }
  });

  describe("ping", () => {
    test("returns PONG when Redis is connected", async () => {
      const result = await redisStore.ping();
      expect(result).toBe("PONG");
    });
  });

  describe("writeBar", () => {
    test("writes bar to latest hash", async () => {
      const bar: Bar = {
        symbol: testSymbol,
        open: 5000,
        high: 5010,
        low: 4990,
        close: 5005,
        volume: 100,
        trades: 50,
        startTime: Date.now(),
        endTime: Date.now() + 60000,
        dollarVolume: 500500,
      };

      await redisStore.writeBar(bar);

      // Verify it was written to the hash
      const stored = await redisStore.redis.hget("bar:latest", testSymbol);
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed.symbol).toBe(testSymbol);
      expect(parsed.close).toBe(5005);
    });

    test("writes bar to timeseries", async () => {
      const now = Date.now();
      const bar: Bar = {
        symbol: testSymbol,
        open: 5010,
        high: 5020,
        low: 5000,
        close: 5015,
        volume: 150,
        trades: 75,
        startTime: now,
        endTime: now + 60000,
        dollarVolume: 752250,
      };

      await redisStore.writeBar(bar);

      const bars = await redisStore.getBarsRange(testSymbol, now - 1000, now + 1000, "1s");
      expect(bars.length).toBeGreaterThan(0);
      expect(bars[bars.length - 1]!.close).toBe(5015);
    });
  });

  describe("getLatest", () => {
    test("returns null for non-existent symbol", async () => {
      const result = await redisStore.getLatest("NONEXISTENT_SYMBOL_XYZ");
      expect(result).toBeNull();
    });

    test("returns bar for existing symbol", async () => {
      // First write a bar
      const bar: Bar = {
        symbol: testSymbol,
        open: 5020,
        high: 5030,
        low: 5010,
        close: 5025,
        volume: 200,
        trades: 100,
        startTime: Date.now(),
        endTime: Date.now() + 60000,
        dollarVolume: 1005000,
      };
      await redisStore.writeBar(bar);

      const result = await redisStore.getLatest(testSymbol);
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe(testSymbol);
      expect(result!.close).toBe(5025);
    });
  });

  describe("getAllLatest", () => {
    test("returns map of symbol to bar", async () => {
      const result = await redisStore.getAllLatest();
      expect(typeof result).toBe("object");

      // Should include our test symbol if tests ran in order
      if (testSymbol in result) {
        expect(result[testSymbol]!.symbol).toBe(testSymbol);
      }
    });
  });

  describe("getAllLatestArray", () => {
    test("returns array of bars", async () => {
      const result = await redisStore.getAllLatestArray();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getSymbols", () => {
    test("returns array of symbol strings", async () => {
      const symbols = await redisStore.getSymbols();
      expect(Array.isArray(symbols)).toBe(true);
      expect(symbols).toContain(testSymbol);
    });
  });

  describe("getStats", () => {
    test("returns stats object with expected fields", async () => {
      const stats = await redisStore.getStats();
      expect(stats).toHaveProperty("date");
      expect(stats).toHaveProperty("barCount");
      expect(stats).toHaveProperty("symbolCount");
      expect(typeof stats.symbolCount).toBe("number");
    });
  });

  describe("session data", () => {
    test("getSession returns null for non-existent symbol", async () => {
      const result = await redisStore.getSession("NONEXISTENT_SESSION_XYZ");
      expect(result).toBeNull();
    });

    test("writeBar creates session data", async () => {
      // Write a bar - this should also create session data
      const bar: Bar = {
        symbol: testSymbol,
        open: 5100,
        high: 5110,
        low: 5090,
        close: 5105,
        volume: 500,
        trades: 25,
        startTime: Date.now(),
        endTime: Date.now() + 60000,
        dollarVolume: 2552500,
      };

      await redisStore.writeBar(bar);

      const session = await redisStore.getSession(testSymbol);
      expect(session).not.toBeNull();
      expect(typeof session!.dayOpen).toBe("number");
      expect(session!.dayHigh).toBeGreaterThanOrEqual(bar.high);
      expect(session!.dayLow).toBeLessThanOrEqual(bar.low);
      expect(session!.cvol).toBeGreaterThan(0);
      expect(session!.vwap).toBeGreaterThan(0);
      expect(session!.sessionId.length).toBeGreaterThan(0);
      expect(session!.rootSymbol).toBe("ES");
      expect(session!.timezone).toBe("America/Chicago");
    });

    test("resets session state when a new Chicago session starts", async () => {
      const rolloverSymbol = "ESH7";
      await redisStore.redis.hdel("bar:latest", rolloverSymbol);
      await redisStore.redis.del(`session:${rolloverSymbol}`);

      const firstNow = Date.UTC(2026, 2, 25, 20, 30, 0, 0);
      const nowSpy = spyOn(Date, "now").mockReturnValue(firstNow);

      await redisStore.writeBar({
        symbol: rolloverSymbol,
        open: 5100,
        high: 5110,
        low: 5090,
        close: 5105,
        volume: 500,
        trades: 25,
        startTime: Date.UTC(2026, 2, 24, 23, 0, 0, 0),
        endTime: Date.UTC(2026, 2, 24, 23, 1, 0, 0),
      });

      const firstSession = await redisStore.getSession(rolloverSymbol);
      expect(firstSession?.sessionId).toBe("2026-03-25");
      expect(firstSession?.cvol).toBe(500);

      const secondNow = Date.UTC(2026, 2, 25, 23, 30, 0, 0);
      nowSpy.mockReturnValue(secondNow);

      await redisStore.writeBar({
        symbol: rolloverSymbol,
        open: 5200,
        high: 5210,
        low: 5190,
        close: 5205,
        volume: 250,
        trades: 10,
        startTime: Date.UTC(2026, 2, 25, 23, 10, 0, 0),
        endTime: Date.UTC(2026, 2, 25, 23, 11, 0, 0),
      });

      const secondSession = await redisStore.getSession(rolloverSymbol);
      expect(secondSession?.sessionId).toBe("2026-03-26");
      expect(secondSession?.dayOpen).toBe(5200);
      expect(secondSession?.cvol).toBe(250);

      await redisStore.redis.hdel("bar:latest", rolloverSymbol);
      await redisStore.redis.del(`session:${rolloverSymbol}`);
    });

    test("getAllSessions returns object of sessions", async () => {
      const sessions = await redisStore.getAllSessions();
      expect(typeof sessions).toBe("object");
      // Should include our test symbol
      if (testSymbol in sessions) {
        expect(sessions[testSymbol]!.dayOpen).toBeGreaterThan(0);
      }
    });

    test("stores and retrieves multiple sessions across the retained window", async () => {
      const historySymbol = "NQM7";
      await redisStore.redis.hdel("bar:latest", historySymbol);
      const historyKeys = await redisStore.redis.keys(`session:${historySymbol}:*`);
      if (historyKeys.length > 0) {
        await redisStore.redis.del(...historyKeys);
      }

      await redisStore.writeRecoveredBar({
        symbol: historySymbol,
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 50,
        trades: 5,
        startTime: Date.UTC(2026, 2, 24, 23, 0, 0, 0),
        endTime: Date.UTC(2026, 2, 24, 23, 1, 0, 0),
      });

      await redisStore.writeRecoveredBar({
        symbol: historySymbol,
        open: 102,
        high: 103,
        low: 101,
        close: 102.5,
        volume: 75,
        trades: 6,
        startTime: Date.UTC(2026, 2, 25, 23, 10, 0, 0),
        endTime: Date.UTC(2026, 2, 25, 23, 11, 0, 0),
      });

      const sessions = await redisStore.getSessionHistory(
        historySymbol,
        Date.UTC(2026, 2, 24, 0, 0, 0, 0),
        Date.UTC(2026, 2, 27, 0, 0, 0, 0),
      );

      expect(sessions).toHaveLength(2);
      expect(sessions.map((session) => session.sessionId)).toEqual([
        "2026-03-25",
        "2026-03-26",
      ]);

      const cleanupKeys = await redisStore.redis.keys(`session:${historySymbol}:*`);
      if (cleanupKeys.length > 0) {
        await redisStore.redis.del(...cleanupKeys);
      }
      await redisStore.redis.hdel("bar:latest", historySymbol);
    });
  });

  describe("snapshot data", () => {
    test("getSnapshot returns null for non-existent symbol", async () => {
      const result = await redisStore.getSnapshot("NONEXISTENT_SNAP_XYZ");
      expect(result).toBeNull();
    });

    test("writeSnapshot and getSnapshot work together", async () => {
      const snapshotData = {
        productCode: "TEST",
        settlementDate: "2026-03-20",
        sessionOpen: 5000,
        sessionHigh: 5050,
        sessionLow: 4950,
        sessionClose: 5020,
        settlementPrice: 5015,
        prevSettlement: 5010,
        change: 5,
        changePct: 0.1,
        openInterest: 12345,
        timestamp: Date.now(),
      };

      await redisStore.writeSnapshot(testSymbol, snapshotData);

      const retrieved = await redisStore.getSnapshot(testSymbol);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.productCode).toBe("TEST");
      expect(retrieved!.settlementPrice).toBe(5015);
      expect(retrieved!.prevSettlement).toBe(5010);
      expect(retrieved!.openInterest).toBe(12345);
    });

    test("getAllSnapshots returns object of snapshots", async () => {
      const snapshots = await redisStore.getAllSnapshots();
      expect(typeof snapshots).toBe("object");
    });
  });
});
