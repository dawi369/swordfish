import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { redisStore } from "@/server/data/redis_store.js";
import type { ActiveContract } from "@/types/contract.types.js";
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

describe.skipIf(!runRedisTests)("RedisStore contract and subscription metadata", () => {
  const productCode = "TESTROOT";
  const contractKey = `contracts:active:${productCode}`;
  const symbolA = "TESTA";
  const symbolB = "TESTB";

  beforeAll(async () => {
    await ensureRedisAvailable();
  });

  afterAll(async () => {
    try {
      await redisStore.redis.del(
        contractKey,
        "meta:subscribed_symbols",
        "bar:latest",
        "market_data",
        `snapshot:${symbolA}`,
      );
      const sessionKeys = await redisStore.redis.keys(`session:${symbolA}:*`);
      if (sessionKeys.length > 0) {
        await redisStore.redis.del(...sessionKeys);
      }
      await redisStore.redis.srem("meta:index:snapshots", symbolA);
      await redisStore.redis.srem("meta:index:active_contracts", productCode);
    } catch {
      // Ignore cleanup failures when Redis is already unavailable.
    }
  });

  test("stores subscribed symbols as a sorted unique list", async () => {
    await redisStore.setSubscribedSymbols([symbolB, symbolA, symbolB]);

    const symbols = await redisStore.getSubscribedSymbols();
    expect(symbols).toEqual([symbolA, symbolB]);
  });

  test("stores and reads active contracts per product", async () => {
    const contracts: ActiveContract[] = [
      {
        ticker: "TESTM6",
        productCode,
        lastTradeDate: "2026-06-20",
        active: true,
      },
      {
        ticker: "TESTU6",
        productCode,
        lastTradeDate: "2026-09-20",
        active: true,
      },
    ];

    await redisStore.writeActiveContracts(productCode, contracts);

    const stored = await redisStore.getActiveContracts(productCode);
    expect(stored).not.toBeNull();
    expect(stored?.productCode).toBe(productCode);
    expect(stored?.contracts).toHaveLength(2);

    const allContracts = await redisStore.getAllActiveContracts();
    expect(allContracts).toHaveProperty(productCode);

    const symbols = await redisStore.getCachedActiveContractSymbols();
    expect(symbols).toContain("TESTM6");
    expect(symbols).toContain("TESTU6");
  });

  test("clearTodayData also removes snapshots while keeping active-contract metadata", async () => {
    const bar: Bar = {
      symbol: symbolA,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      volume: 100,
      trades: 5,
      startTime: Date.now(),
      endTime: Date.now() + 1000,
    };

    await redisStore.writeBar(bar);
    await redisStore.writeSnapshot(symbolA, {
      productCode,
      settlementDate: "2026-06-20",
      sessionOpen: 10,
      sessionHigh: 12,
      sessionLow: 9,
      sessionClose: 11,
      settlementPrice: 11,
      prevSettlement: 10,
      change: 1,
      changePct: 0.1,
      openInterest: 50,
      timestamp: Date.now(),
    });

    await redisStore.writeActiveContracts(productCode, [
      {
        ticker: "TESTM6",
        productCode,
        lastTradeDate: "2026-06-20",
        active: true,
      },
    ]);

    await redisStore.clearTodayData(true);

    expect(await redisStore.getSnapshot(symbolA)).toBeNull();
    expect(await redisStore.getSession(symbolA)).toBeNull();
    expect(await redisStore.getLatest(symbolA)).toBeNull();
    expect(await redisStore.getActiveContracts(productCode)).not.toBeNull();
  });
});
