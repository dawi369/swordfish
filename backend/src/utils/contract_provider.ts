import { MASSIVE_API_KEY } from "@/config/env.js";
import {
  MASSIVE_CONTRACTS_URL,
  MAX_PAGES_PER_TICKER,
  MAX_UNIQUE_CONTRACTS,
} from "@/utils/consts.js";
import type { ActiveContract } from "@/types/contract.types.js";
import { isOutrightTickerForRoot } from "@/utils/contracts_calendar.js";
import { appendFileSync, existsSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  captureExceptionWithContext,
  captureMessageWithContext,
} from "@/utils/sentry.js";
import { telemetry } from "@/utils/telemetry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const INVALID_TICKERS_FILE = join(__dirname, "invalid_tickers.txt");

const CACHE_TTL_MS = 15 * 60 * 1000;
const CONTRACT_PAGE_SIZE = 5000;

interface CachedContracts {
  fetchedAt: number;
  contracts: ActiveContract[];
}

export class ContractProvider {
  private apiKey: string;
  private cache = new Map<string, CachedContracts>();

  constructor(apiKey: string = MASSIVE_API_KEY) {
    this.apiKey = apiKey;
  }

  /**
   * Log an invalid ticker to invalid_tickers.txt
   */
  private logInvalidTicker(root: string): void {
    const timestamp = new Date().toISOString();
    const entry = `${timestamp} - ${root}\n`;

    try {
      if (!existsSync(INVALID_TICKERS_FILE)) {
        writeFileSync(
          INVALID_TICKERS_FILE,
          "# Invalid Tickers Log\n# Tickers that returned empty JSON from Massive API\n\n"
        );
      }
      appendFileSync(INVALID_TICKERS_FILE, entry);
      console.log(`[ContractProvider] Logged invalid ticker: ${root}`);
    } catch (error) {
      console.error(`[ContractProvider] Failed to log invalid ticker ${root}:`, error);
    }
  }

  /**
   * Fetch all active contracts for a given root symbol (product code).
   * @param root The product code (e.g. "ES")
   * @returns List of contract tickers (e.g. ["ESZ5", "ESH6"]) sorted by expiration.
   */
  async fetchActiveContractsDetailed(root: string): Promise<ActiveContract[]> {
    const cached = this.cache.get(root);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.contracts;
    }

    const contractsMap = new Map<string, ActiveContract>();
    let nextUrl:
      | string
      | null = `${MASSIVE_CONTRACTS_URL}?product_code=${root}&active=true&limit=${CONTRACT_PAGE_SIZE}&apiKey=${this.apiKey}`;
    let pageCount = 0;
    const now = new Date();

    try {
      while (nextUrl && pageCount < MAX_PAGES_PER_TICKER) {
        if (contractsMap.size >= MAX_UNIQUE_CONTRACTS) {
          console.log(
            `[ContractProvider] Reached max contracts (${MAX_UNIQUE_CONTRACTS}) for ${root}`
          );
          break;
        }

        pageCount++;
        const response = await fetch(nextUrl, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          console.error(
            `[ContractProvider] Failed to fetch contracts for ${root}: ${response.status}`
          );
          telemetry.metric({
            name: "swordfish.provider_contract_fetch.run",
            type: "counter",
            value: 1,
            tags: {
              provider: "massive",
              root,
              status: "failed",
              http_status: response.status,
            },
          });
          captureMessageWithContext("Provider contract fetch failed", {
            level: "warning",
            tags: {
              provider: "massive",
              root,
              status: "failed",
              http_status: response.status,
            },
            extra: {
              pageCount,
              maxPages: MAX_PAGES_PER_TICKER,
            },
          });
          break;
        }

        const data: any = await response.json();
        const results = Array.isArray(data) ? data : data.results || [];

        // Empty results on first page = invalid ticker
        if (pageCount === 1 && results.length === 0) {
          console.log(`[ContractProvider] Empty response for ${root} - invalid ticker`);
          telemetry.metric({
            name: "swordfish.provider_contract_fetch.run",
            type: "counter",
            value: 1,
            tags: {
              provider: "massive",
              root,
              status: "empty",
            },
          });
          this.logInvalidTicker(root);
          break;
        }

        for (const item of results) {
          if (item.active === false) continue;

          const ticker =
            typeof item.ticker === "string" ? item.ticker.trim() : "";
          if (!ticker || !isOutrightTickerForRoot(root, ticker)) {
            continue;
          }

          const type =
            typeof item.type === "string" ? item.type.trim().toLowerCase() : "";
          if (type && type !== "single") {
            continue;
          }

          const lastTradeDateValue =
            typeof item.last_trade_date === "string" &&
            item.last_trade_date.length > 0
              ? item.last_trade_date
              : typeof item.settlement_date === "string" &&
                  item.settlement_date.length > 0
                ? item.settlement_date
                : null;

          if (!lastTradeDateValue) {
            continue;
          }

          const lastTradeDate = new Date(lastTradeDateValue);
          if (isNaN(lastTradeDate.getTime()) || lastTradeDate < now) {
            continue;
          }

          if (!contractsMap.has(ticker)) {
            contractsMap.set(ticker, {
              ticker,
              productCode: item.product_code || root,
              lastTradeDate: lastTradeDateValue,
              active: item.active !== false,
            });

            if (contractsMap.size >= MAX_UNIQUE_CONTRACTS) break;
          }
        }

        nextUrl = data.next_url;
      }

      if (pageCount >= MAX_PAGES_PER_TICKER && nextUrl) {
        console.log(`[ContractProvider] Reached max pages (${MAX_PAGES_PER_TICKER}) for ${root}`);
      }
    } catch (error) {
      console.error(`[ContractProvider] Error fetching contracts for ${root}:`, error);
      telemetry.metric({
        name: "swordfish.provider_contract_fetch.run",
        type: "counter",
        value: 1,
        tags: {
          provider: "massive",
          root,
          status: "failed",
        },
      });
      captureExceptionWithContext(error, {
        tags: {
          provider: "massive",
          root,
          status: "failed",
        },
        extra: {
          pageCount,
          maxPages: MAX_PAGES_PER_TICKER,
        },
      });
      throw error;
    }

    // Sort by expiration date
    const contracts = Array.from(contractsMap.values());
    contracts.sort((a, b) => {
      return new Date(a.lastTradeDate).getTime() - new Date(b.lastTradeDate).getTime();
    });

    this.cache.set(root, {
      fetchedAt: Date.now(),
      contracts,
    });
    telemetry.metric({
      name: "swordfish.provider_contract_fetch.run",
      type: "counter",
      value: 1,
      tags: {
        provider: "massive",
        root,
        status: contracts.length > 0 ? "success" : "empty",
      },
    });
    telemetry.metric({
      name: "swordfish.provider_contract_fetch.contracts",
      type: "gauge",
      value: contracts.length,
      tags: {
        provider: "massive",
        root,
      },
    });

    return contracts;
  }

  async fetchActiveContracts(root: string): Promise<string[]> {
    const contracts = await this.fetchActiveContractsDetailed(root);
    return contracts.map((contract) => contract.ticker);
  }
}

export const contractProvider = new ContractProvider();
