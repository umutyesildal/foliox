/**
 * catalog/mockStocks.ts — the Basalt mock xStock universe (devnet demo).
 *
 * Single source of truth for the 12 mock xStocks the backend knows about.
 * Each entry carries:
 *   * `symbol`      — display ticker ("TSLAx")
 *   * `priceSource` — the exact string written on-chain by the deploy scripts
 *                     (scripts/createWhitelist.ts add_mint price_source),
 *                     format "mock:<symbol-lowercase>"
 *   * `priceUsd`    — a DETERMINISTIC dev-catalog USD price. Stable, realistic,
 *                     and never treated as live market data: quotes resolved
 *                     from this catalog are always labeled source "mock"
 *                     (see workers/mockPriceFill.ts and nav_snapshots
 *                     price_source provenance).
 *
 * Honesty rules (AGENTS.md): these are dev/demo prices for mock Token-2022
 * mints. Mainnet whitelisted mints carry "jupiter:<TICKER>" price sources,
 * which this catalog explicitly does NOT resolve — the mock path is reachable
 * only for mints the deployer labeled "mock:*" in the whitelist.
 *
 * The mint ADDRESSES are intentionally not listed here: devnet mock mints are
 * fresh Token-2022 keypairs generated per deploy (scripts/createWhitelist.ts)
 * and are discovered by the backend through the indexed `whitelisted_mints`
 * table (GET /api/v1/whitelist), never hard-coded.
 */

import type { PricePoint } from "../workers/priceFetch.js";

export interface MockXStock {
  /** Display ticker, e.g. "TSLAx". */
  readonly symbol: string;
  /** On-chain whitelist price_source string, e.g. "mock:tsla". */
  readonly priceSource: string;
  /** Deterministic dev-catalog USD price (stable, NOT live market data). */
  readonly priceUsd: number;
}

/**
 * The mock xStock universe — EXACTLY 12 stocks.
 *
 * Prices: the original 4 (TSLAx/AAPLx/NVDAx/SPYx) keep the values the backend
 * has been demonstrating with (TSLA 250 / NVDA 180 per the spec §5 NAV example
 * in workers/navEngine.ts; AAPL 230; SPY 560). The 8 additions use stable
 * round values (MSFT 420, AMZN 185, GOOGL 165, META 510, AMD 140, COIN 210,
 * MSTR 130, HOOD 38).
 */
export const MOCK_XSTOCKS: readonly MockXStock[] = [
  { symbol: "TSLAx",  priceSource: "mock:tsla",  priceUsd: 250 },
  { symbol: "NVDAx",  priceSource: "mock:nvda",  priceUsd: 180 },
  { symbol: "AAPLx",  priceSource: "mock:aapl",  priceUsd: 230 },
  { symbol: "MSFTx",  priceSource: "mock:msft",  priceUsd: 420 },
  { symbol: "AMZNx",  priceSource: "mock:amzn",  priceUsd: 185 },
  { symbol: "GOOGLx", priceSource: "mock:googl", priceUsd: 165 },
  { symbol: "METAx",  priceSource: "mock:meta",  priceUsd: 510 },
  { symbol: "AMDx",   priceSource: "mock:amd",   priceUsd: 140 },
  { symbol: "COINx",  priceSource: "mock:coin",  priceUsd: 210 },
  { symbol: "MSTRx",  priceSource: "mock:mstr",  priceUsd: 130 },
  { symbol: "HOODx",  priceSource: "mock:hood",  priceUsd: 38 },
  { symbol: "SPYx",   priceSource: "mock:spy",   priceUsd: 560 },
] as const;

/** Catalog size guard: the devnet demo universe is exactly 12 stocks. */
export const MOCK_STOCK_COUNT = MOCK_XSTOCKS.length; // === 12

/** Whitelist price_source format for mocks: "mock:" + lowercase slug. */
export const MOCK_PRICE_SOURCE_RE = /^mock:[a-z0-9_-]+$/;

/** True when `priceSource` has the mock shape ("mock:<slug>"). */
export function isMockPriceSource(priceSource: string): boolean {
  return MOCK_PRICE_SOURCE_RE.test(priceSource);
}

/** Catalog entry by display symbol, e.g. "NVDAx". */
export function mockStockBySymbol(symbol: string): MockXStock | null {
  const found = MOCK_XSTOCKS.find((s) => s.symbol === symbol);
  return found ?? null;
}

/** Catalog entry by whitelist price_source, e.g. "mock:nvda". */
export function mockStockByPriceSource(priceSource: string): MockXStock | null {
  const found = MOCK_XSTOCKS.find((s) => s.priceSource === priceSource);
  return found ?? null;
}

/** Deterministic USD price for a symbol ("NVDAx"), or null when unknown. */
export function mockPriceForSymbol(symbol: string): number | null {
  const stock = mockStockBySymbol(symbol);
  return stock ? stock.priceUsd : null;
}

/**
 * Deterministic USD price for a whitelist price_source ("mock:nvda"),
 * or null when the source is not a known mock (mainnet "jupiter:*" sources
 * never resolve here).
 */
export function mockPriceForPriceSource(priceSource: string): number | null {
  const stock = mockStockByPriceSource(priceSource);
  return stock ? stock.priceUsd : null;
}

/** All display symbols, catalog order. */
export function mockSymbols(): string[] {
  return MOCK_XSTOCKS.map((s) => s.symbol);
}

/** All whitelist price_source strings, catalog order. */
export function mockPriceSources(): string[] {
  return MOCK_XSTOCKS.map((s) => s.priceSource);
}

// ---------------------------------------------------------------------------
// Real-equity ticker mapping (REALISTIC_MOCK_PRICES)
// ---------------------------------------------------------------------------

/**
 * Explicit slug → real US-equity ticker table for the realistic price path
 * (workers/realisticMockPrices.ts). When REALISTIC_MOCK_PRICES is on, a
 * whitelist row "mock:<slug>" is quoted from the real market via this table
 * BEFORE the deterministic catalog price is used; on any fetch failure the
 * catalog value below remains the fallback (source "mock" vs "yahoo").
 *
 * The table is keyed by the exact slug from `priceSource` — every catalog
 * entry above must have exactly one row here (pinned by tests), and slugs
 * outside the catalog never resolve.
 */
export const MOCK_SLUG_TO_TICKER: Readonly<Record<string, string>> = {
  tsla: "TSLA",
  nvda: "NVDA",
  aapl: "AAPL",
  msft: "MSFT",
  amzn: "AMZN",
  googl: "GOOGL",
  meta: "META",
  amd: "AMD",
  coin: "COIN",
  mstr: "MSTR",
  hood: "HOOD",
  spy: "SPY",
} as const;

/** Real equity ticker for a mock slug ("nvda" → "NVDA"), or null when unknown. */
export function tickerForSlug(slug: string): string | null {
  const ticker = MOCK_SLUG_TO_TICKER[slug];
  return typeof ticker === "string" ? ticker : null;
}

/** All slug → ticker pairs, catalog order of MOCK_XSTOCKS. */
export function mockSlugTickerPairs(): Array<[string, string]> {
  return MOCK_XSTOCKS.map((s) => [
    s.priceSource.slice("mock:".length),
    MOCK_SLUG_TO_TICKER[s.priceSource.slice("mock:".length)],
  ]);
}

/**
 * Build a source-marked PricePoint ("mock") for a mint whose whitelist row
 * carries `priceSource`. Returns null when the price source is not a known
 * mock — callers must never fabricate a price for a non-mock mint.
 */
export function mockQuoteForPriceSource(
  mint: string,
  priceSource: string,
  asOf: string,
): PricePoint | null {
  const price = mockPriceForPriceSource(priceSource);
  if (price === null) return null;
  return { mint, price, source: "mock", asOf };
}

// ---------------------------------------------------------------------------
// Devnet flagship basket (created on-chain by the deploy scripts, not here)
// ---------------------------------------------------------------------------

/**
 * "MAG SIX" — the devnet flagship basket composition (weights in bps,
 * sum = 10_000). The backend does not create baskets; this constant exists so
 * tests (and dashboards) can verify NAV/drift math against the exact
 * composition the deployer creates on devnet.
 */
export const DEVNET_FLAGSHIP_BASKET = {
  name: "MAG SIX",
  weightsBps: [
    { symbol: "NVDAx", weightBps: 2500 },
    { symbol: "AAPLx", weightBps: 2000 },
    { symbol: "MSFTx", weightBps: 1500 },
    { symbol: "METAx", weightBps: 1500 },
    { symbol: "AMZNx", weightBps: 1250 },
    { symbol: "GOOGLx", weightBps: 1250 },
  ],
} as const;

/** Weight bps for a MAG SIX symbol, or null when not a constituent. */
export function flagshipWeightFor(symbol: string): number | null {
  const found = DEVNET_FLAGSHIP_BASKET.weightsBps.find((w) => w.symbol === symbol);
  return found ? found.weightBps : null;
}
