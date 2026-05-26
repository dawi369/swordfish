import { describe, expect, mock, spyOn, test } from "bun:test";
import { ContractProvider } from "@/utils/contract_provider.js";
import { telemetry } from "@/utils/telemetry.js";

describe("ContractProvider", () => {
  test("filters, sorts, paginates, and caches active single contracts", async () => {
    const fetchMock = mock(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes("page=2")) {
        return new Response(
          JSON.stringify({
            results: [
            {
              ticker: "ESU9",
              product_code: "ES",
              last_trade_date: "2099-09-15",
              active: true,
              type: "single",
            },
          ],
        }),
        { status: 200 },
      );
      }

      return new Response(
        JSON.stringify({
          results: [
            {
              ticker: "ESZ9",
              product_code: "ES",
              last_trade_date: "2099-12-15",
              active: true,
              type: "single",
            },
            {
              ticker: "ESH9",
              product_code: "ES",
              last_trade_date: "2099-03-15",
              active: true,
            },
            {
              ticker: "ESM9-ESU9",
              product_code: "ES",
              last_trade_date: "2099-06-15",
              active: true,
              type: "single",
            },
            {
              ticker: "ESH9-ESM9",
              product_code: "ES",
              last_trade_date: "2099-06-15",
              active: true,
              type: "spread",
            },
            {
              ticker: "ESZ1",
              product_code: "ES",
              last_trade_date: "2001-01-01",
              active: true,
              type: "single",
            },
            {
              ticker: "ESBAD",
              product_code: "ES",
              last_trade_date: "2099-06-15",
              active: true,
              type: "single",
            },
            {
              ticker: "ESM9",
              product_code: "ES",
              last_trade_date: "2099-06-15",
              active: false,
              type: "single",
            },
          ],
          next_url: "https://example.test/contracts?page=2",
        }),
        { status: 200 },
      );
    });

    spyOn(globalThis, "fetch").mockImplementation(fetchMock as any);

    const provider = new ContractProvider("test-key");
    const first = await provider.fetchActiveContractsDetailed("ES");
    const second = await provider.fetchActiveContractsDetailed("ES");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.map((contract) => contract.ticker)).toEqual([
      "ESH9",
      "ESU9",
      "ESZ9",
    ]);
    expect(second).toEqual(first);
  });

  test("logs invalid tickers when the first page is empty", async () => {
    const provider = new ContractProvider("test-key");
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200 }) as any,
    );
    const metricSpy = spyOn(telemetry, "metric").mockImplementation(() => {});
    const logSpy = spyOn(provider as any, "logInvalidTicker").mockImplementation(
      () => undefined,
    );

    const contracts = await provider.fetchActiveContractsDetailed("BADROOT");

    expect(contracts).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith("BADROOT");
    expect(metricSpy).toHaveBeenCalledWith({
      name: "swordfish.provider_contract_fetch.run",
      type: "counter",
      value: 1,
      tags: {
        provider: "massive",
        root: "BADROOT",
        status: "empty",
      },
    });
  });

  test("emits provider telemetry when Massive returns an HTTP failure", async () => {
    const provider = new ContractProvider("test-key");
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }) as any,
    );
    const metricSpy = spyOn(telemetry, "metric").mockImplementation(() => {});

    const contracts = await provider.fetchActiveContractsDetailed("ES");

    expect(contracts).toEqual([]);
    expect(metricSpy).toHaveBeenCalledWith({
      name: "swordfish.provider_contract_fetch.run",
      type: "counter",
      value: 1,
      tags: {
        provider: "massive",
        root: "ES",
        status: "failed",
        http_status: 403,
      },
    });
  });

  test("throws when the fetch request itself fails", async () => {
    const provider = new ContractProvider("test-key");
    spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const metricSpy = spyOn(telemetry, "metric").mockImplementation(() => {});

    await expect(provider.fetchActiveContractsDetailed("ES")).rejects.toThrow(
      "network down",
    );
    expect(metricSpy).toHaveBeenCalledWith({
      name: "swordfish.provider_contract_fetch.run",
      type: "counter",
      value: 1,
      tags: {
        provider: "massive",
        root: "ES",
        status: "failed",
      },
    });
  });
});
