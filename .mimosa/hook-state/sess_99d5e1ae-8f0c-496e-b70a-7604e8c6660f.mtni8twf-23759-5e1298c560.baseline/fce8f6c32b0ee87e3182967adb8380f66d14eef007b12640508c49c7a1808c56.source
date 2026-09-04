/**
 * workers/mockPriceFill.ts — mock-catalog price fill for the NAV engine.
 *
 * On devnet the xStock universe is 12 mock Token-2022 mints whose whitelist
 * rows carry price_source "mock:<slug>" (catalog/mockStocks.ts). Jupiter has
 * no prices for devnet mints, so without this fill the NAV engine would
 * honestly degrade to "no-prices" forever and the demo would never produce a
 * NAV snapshot.
 *
 * Behavior (honesty contract, AGENTS.md §2):
 *   1. Prices are fetched from the real provider first (Jupiter v6 via
 *      workers/priceFetch.ts, honoring PRICE_FALLBACK). A positive Jupiter
 *      price is NEVER overwritten.
 *   2. Only mints that came back missing or at price 0 are candidates. When
 *      REALISTIC_MOCK_PRICES is on, a candidate labeled "mock:<slug>" is
 *      quoted from the REAL equity market first (workers/
 *      realisticMockPrices.ts — guarded Yahoo chart API, slug→ticker via
 *      MOCK_SLUG_TO_TICKER, 60s TTL cache, per-symbol try/catch); those
 *      quotes are labeled source "yahoo".
 *   3. Everything else (env off, Yahoo failure, unknown slug) is filled from
 *      the deterministic dev catalog — ONLY when the indexed `whitelisted_mints`
 *      row for that mint has a price_source the mock catalog recognizes.
 *      Catalog quotes stay labeled source "mock" so the two paths are always
 *      distinguishable in nav_snapshots.price_source provenance. Mainnet
 *      "jupiter:<TICKER>" sources never resolve either way.
 *   4. Every failure (no DB, query error, unknown source) is fail-open with no
 *      fill — the wrapper can only add Yahoo-backed "yahoo"-labeled or
 *      catalog-backed "mock"-labeled prices, never fabricate anything beyond
 *      them. One bad symbol never breaks a NAV run.
 */

import type { PgLike } from "../db/client.js";
import { fetchPriceQuotes, type PricePoint, type PriceQuoteMap } from "./priceFetch.js";
import { mockQuoteForPriceSource, isMockPriceSource } from "../catalog/mockStocks.js";
import {
  realisticMockPricesEnabled,
  realisticMockQuote,
  type RealisticQuote,
} from "./realisticMockPrices.js";

export interface WhitelistPriceSourceRow {
  mint: string;
  price_source: string;
}

/** Read the whitelist price_source labels for a set of mints (read-only). */
export type WhitelistReader = (
  mints: string[],
) => Promise<WhitelistPriceSourceRow[]>;

/** Injectable realistic-quote fetcher (tests). Defaults to realisticMockQuote. */
export type RealisticQuoteFetcher = (slug: string) => Promise<RealisticQuote | null>;

export interface MockPriceFillOptions {
  /** Base price provider. Defaults to fetchPriceQuotes (Jupiter v6). */
  fetchQuotes?: (mints: string[]) => Promise<PriceQuoteMap>;
  /** Injectable clock for `asOf` stamps. Defaults to `new Date()`. */
  now?: () => Date;
  /** Injectable whitelist reader (tests). Defaults to a whitelisted_mints query. */
  readWhitelist?: WhitelistReader;
  /** Env used for the REALISTIC_MOCK_PRICES gate. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Injectable realistic fetcher (tests). Defaults to realisticMockQuote. */
  fetchRealistic?: RealisticQuoteFetcher;
}

/** Default reader: indexed whitelist labels (fails open to [] on any error). */
function whitelistReaderFromDb(db: PgLike): WhitelistReader {
  return async (mints) => {
    try {
      const res = await db.query(
        "SELECT mint, price_source FROM whitelisted_mints WHERE mint = ANY($1::text[])",
        [mints],
      );
      const rows: WhitelistPriceSourceRow[] = [];
      for (const row of res.rows) {
        const mint = (row as { mint?: unknown }).mint;
        const priceSource = (row as { price_source?: unknown }).price_source;
        if (typeof mint === "string" && typeof priceSource === "string") {
          rows.push({ mint, price_source: priceSource });
        }
      }
      return rows;
    } catch {
      // No whitelist table / query failed — no fill (fail-open).
      return [];
    }
  };
}

function isPositivePrice(quote: PriceQuoteMap[string] | undefined): boolean {
  return quote !== undefined && Number.isFinite(quote.price) && quote.price > 0;
}

/** "mock:<slug>" → slug, or null for non-mock sources. */
function slugOf(priceSource: string): string | null {
  if (!isMockPriceSource(priceSource)) return null;
  return priceSource.slice("mock:".length);
}

/**
 * Wrap a base price provider so that missing/zero prices for mints whose
 * whitelist row is labeled "mock:<slug>" are filled — with REALISTIC_MOCK_
 * PRICES on — from the real equity market first (source "yahoo"), falling
 * back per-symbol to the deterministic dev catalog (source "mock"). See the
 * module doc for the full contract.
 */
export function createMockAwareQuoteFetcher(
  db: PgLike,
  opts: MockPriceFillOptions = {},
): (mints: string[]) => Promise<PriceQuoteMap> {
  const base = opts.fetchQuotes ?? ((mints: string[]) => fetchPriceQuotes(mints));
  const readWhitelist = opts.readWhitelist ?? whitelistReaderFromDb(db);
  const now = opts.now ?? (() => new Date());
  const useRealistic = realisticMockPricesEnabled(opts.env ?? process.env);
  const fetchRealistic = opts.fetchRealistic ?? realisticMockQuote;

  return async (mints: string[]) => {
    const quotes = await base(mints);
    const missing = mints.filter((m) => !isPositivePrice(quotes[m]));
    if (missing.length === 0) return quotes;

    const asOf = now().toISOString();
    const rows = await readWhitelist(missing);
    for (const row of rows) {
      // Never overwrite a real provider price, and only fill labeled mocks.
      if (isPositivePrice(quotes[row.mint])) continue;
      // Realistic path first: REAL equity spot quote (source "yahoo"),
      // per-symbol try/catch inside — a bad symbol degrades, never throws.
      const slug = slugOf(row.price_source);
      if (useRealistic && slug) {
        try {
          const real = await fetchRealistic(slug);
          if (real && Number.isFinite(real.price) && real.price > 0) {
            const point: PricePoint = {
              mint: row.mint,
              price: real.price,
              source: "yahoo",
              asOf: real.asOf || asOf,
            };
            quotes[row.mint] = point;
            continue;
          }
        } catch {
          // fall through to the catalog (one bad symbol never breaks a run)
        }
      }
      const quote = mockQuoteForPriceSource(row.mint, row.price_source, asOf);
      if (quote) quotes[row.mint] = quote;
    }
    return quotes;
  };
}
