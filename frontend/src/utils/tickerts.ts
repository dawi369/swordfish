// Purpose: Dynamically load and access tickers by asset class, with one-liner access by product_code/ticker, e.g. tickers.grains.ZC or tickers.all.ES

interface TickerEntry {
  [key: string]: unknown;
  asset_class: string;
  asset_sub_class: string;
  date: string;
  trading_venue: string;
  last_updated: string;
  name: string;
  clearing_channel: string;
  price_quotation: string;
  product_code: string;
  sector: string;
  settlement_currency_code: string;
  settlement_method: string;
  settlement_type: string;
  sub_sector: string;
  trade_currency_code: string;
  type: string;
  unit_of_measure: string;
  unit_of_measure_quantity: number;
}

type TickerGroup = { [key: string]: TickerEntry };

type AssetClass = "grains" | "volatiles" | "us_indices" | "softs" | "metals" | "currencies";

const FRONTEND_ROOT = `${import.meta.dir}/../..`;

const TICKER_FILES: { [key in AssetClass]: string } = {
  grains: `${FRONTEND_ROOT}/tickers/grains.json`,
  volatiles: `${FRONTEND_ROOT}/tickers/volatiles.json`,
  us_indices: `${FRONTEND_ROOT}/tickers/us_indices.json`,
  softs: `${FRONTEND_ROOT}/tickers/softs.json`,
  metals: `${FRONTEND_ROOT}/tickers/metals.json`,
  currencies: `${FRONTEND_ROOT}/tickers/currencies.json`,
};

async function loadJson(filepath: string): Promise<TickerEntry[]> {
  try {
    const file = Bun.file(filepath);
    const exists = await file.exists();
    if (!exists) return [];
    return await file.json();
  } catch (err) {
    throw new Error(`Failed to load tickers from ${filepath}: ${err}`);
  }
}

function groupBy(arr: TickerEntry[], codeFields: string[]): TickerGroup {
  const map: TickerGroup = {};
  for (const entry of arr) {
    for (const key of codeFields) {
      if (entry[key]) {
        map[entry[key]] = entry;
        break;
      }
    }
  }
  return map;
}

export class Tickers {
  grains: TickerGroup = {};
  volatiles: TickerGroup = {};
  us_indices: TickerGroup = {};
  softs: TickerGroup = {};
  metals: TickerGroup = {};
  currencies: TickerGroup = {};
  all: TickerGroup = {};

  private constructor() {}

  // Async factory - the Bun-native way to create Tickers
  static async create(): Promise<Tickers> {
    const tickers = new Tickers();

    const [grains, volatiles, us_indices, softs, metals, currencies] = await Promise.all([
      loadJson(TICKER_FILES.grains),
      loadJson(TICKER_FILES.volatiles),
      loadJson(TICKER_FILES.us_indices),
      loadJson(TICKER_FILES.softs),
      loadJson(TICKER_FILES.metals),
      loadJson(TICKER_FILES.currencies),
    ]);

    tickers.grains = groupBy(grains, ["product_code"]);
    tickers.volatiles = groupBy(volatiles, ["product_code"]);
    tickers.us_indices = groupBy(us_indices, ["product_code"]);
    tickers.softs = groupBy(softs, ["product_code"]);
    tickers.metals = groupBy(metals, ["product_code"]);
    tickers.currencies = groupBy(currencies, ["product_code"]);

    tickers.all = {
      ...tickers.grains,
      ...tickers.volatiles,
      ...tickers.us_indices,
      ...tickers.softs,
      ...tickers.metals,
      ...tickers.currencies,
    };

    return tickers;
  }

  // Reload all tickers (useful for hot-reload scenarios)
  async reload(): Promise<void> {
    const [grains, volatiles, us_indices, softs, metals, currencies] = await Promise.all([
      loadJson(TICKER_FILES.grains),
      loadJson(TICKER_FILES.volatiles),
      loadJson(TICKER_FILES.us_indices),
      loadJson(TICKER_FILES.softs),
      loadJson(TICKER_FILES.metals),
      loadJson(TICKER_FILES.currencies),
    ]);

    this.grains = groupBy(grains, ["product_code"]);
    this.volatiles = groupBy(volatiles, ["product_code"]);
    this.us_indices = groupBy(us_indices, ["product_code"]);
    this.softs = groupBy(softs, ["product_code"]);
    this.metals = groupBy(metals, ["product_code"]);
    this.currencies = groupBy(currencies, ["product_code"]);

    this.all = {
      ...this.grains,
      ...this.volatiles,
      ...this.us_indices,
      ...this.softs,
      ...this.metals,
      ...this.currencies,
    };
  }

  // List all product codes for a specific asset class
  listCodes(assetClass: AssetClass): string[] {
    return Object.keys(this[assetClass]);
  }

  // Check if a product code exists in a specific asset class
  hasCode(assetClass: AssetClass, code: string): boolean {
    return code in this[assetClass];
  }

  // Get a ticker entry from a specific asset class
  getCode(assetClass: AssetClass, code: string): TickerEntry | undefined {
    return this[assetClass][code];
  }

  // Get all tickers for a specific sector (e.g., "crude_oil", "precious", "livestock")
  getBySector(sector: string): TickerEntry[] {
    const result: TickerEntry[] = [];
    for (const ticker of Object.values(this.all)) {
      if (ticker.sector === sector) {
        result.push(ticker);
      }
    }
    return result;
  }

  // Get all tickers for a specific trading venue (e.g., "XCME", "XNYM")
  getByVenue(venue: string): TickerEntry[] {
    const result: TickerEntry[] = [];
    for (const ticker of Object.values(this.all)) {
      if (ticker.trading_venue === venue) {
        result.push(ticker);
      }
    }
    return result;
  }
}
