import currencies from "../../tickers/currencies.json";
import grains from "../../tickers/grains.json";
import metals from "../../tickers/metals.json";
import softs from "../../tickers/softs.json";
import us_indices from "../../tickers/us_indices.json";
import volatiles from "../../tickers/volatiles.json";

export type AssetClassId = "currencies" | "grains" | "metals" | "softs" | "indices" | "volatiles";

export interface TickerConfig {
  asset_class?: string;
  asset_sub_class?: string;
  name: string;
  product_code: string;
  [key: string]: unknown;
}

const ALL_TICKERS: Record<AssetClassId, TickerConfig[]> = {
  currencies: currencies as TickerConfig[],
  grains: grains as TickerConfig[],
  metals: metals as TickerConfig[],
  softs: softs as TickerConfig[],
  indices: us_indices as TickerConfig[],
  volatiles: volatiles as TickerConfig[],
};

// Map product_code to AssetClassId
const PRODUCT_CODE_MAP: Record<string, AssetClassId> = {};
const PRODUCT_DETAILS_MAP: Record<string, TickerConfig> = {};

// Initialize maps
Object.entries(ALL_TICKERS).forEach(([assetClassId, tickers]) => {
  tickers.forEach((ticker) => {
    PRODUCT_CODE_MAP[ticker.product_code] = assetClassId as AssetClassId;
    PRODUCT_DETAILS_MAP[ticker.product_code] = ticker;
  });
});

export function getAssetClassForTicker(ticker: string): AssetClassId | undefined {
  // Simple prefix matching.
  // We iterate through product codes and see if the ticker starts with it.
  // We sort product codes by length descending to match longest prefix first (e.g. if we had "A" and "AB")
  // But for now, let's just loop.

  // Optimization: Extract the prefix. Most tickers are 1-3 chars + MonthCode + Year.
  // But some might be longer.
  // Let's try to find a matching product code.

  for (const code of Object.keys(PRODUCT_CODE_MAP)) {
    if (ticker.startsWith(code)) {
      // Verify that the next character is a number or a known month code?
      // Actually, for futures, it's usually CODE + Month + Year.
      // e.g. GCZ5. GC is the code.
      // However, some codes might be substrings of others? Unlikely for this set.
      return PRODUCT_CODE_MAP[code];
    }
  }
  return undefined;
}

export function getTickerDetails(ticker: string): TickerConfig | undefined {
  for (const code of Object.keys(PRODUCT_DETAILS_MAP)) {
    if (ticker.startsWith(code)) {
      return PRODUCT_DETAILS_MAP[code];
    }
  }
  return undefined;
}

export function getAllProductCodes(): string[] {
  return Object.keys(PRODUCT_CODE_MAP);
}

export const ASSET_CLASSES: { id: AssetClassId; title: string }[] = [
  { id: "indices", title: "US Indices" },
  { id: "metals", title: "Metals" },
  { id: "grains", title: "Grains" },
  { id: "currencies", title: "Currencies" },
  { id: "volatiles", title: "Volatiles" },
  { id: "softs", title: "Softs" },
];
