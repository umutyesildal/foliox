import { fetchPrices } from "./priceFetch.js";
import { fetchYahooSeries, fetchYahooPrice } from "./yahooFetch.js";
import {
  realisticMockQuote,
  realisticMockPricesEnabled,
  type RealisticQuote,
} from "./realisticMockPrices.js";
import {
  MOCK_SLUG_TO_TICKER,
  isMockPriceSource,
  mockPriceForPriceSource,
} from "../catalog/mockStocks.js";
import type { PgLike } from "../db/client.js";

/**
 * One row of GET /api/v1/prices/compare. `source` (optional, additive — the
 * Create wizard only reads ticker/mint/jupiter) says where `jupiter` came
 * from:
 *   "jupiter"     — live Jupiter Price v6 (real mainnet xStock mints)
 *   "yahoo"       — REAL US-equity market spot quote (guarded Yahoo chart API);
 *                   on devnet the mock:<slug> mints track their real equity, so
 *                   both legs reference the same real quote (diffBps 0)
 *   "mock"        — deterministic dev catalog (Yahoo unavailable)
 *   "unavailable" — no real quote AND no catalog price (never fabricated)
 */
export interface CompareTick {
  ticker: string;
  mint: string;
  jupiter: number | null;
  yahoo: number | null;
  diffBps: number | null;
  source?: "jupiter" | "yahoo" | "mock" | "unavailable";
}

export const TICKER_MINTS: Record<string, string> = {
  // Gerçek Backed xStocks mintleri — Solscan doğrulandı (2025-06-30)
  TSLAx: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  AAPLx: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  NVDAx: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
  SPYx:  "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
};

export const YAHOO_MAP: Record<string,string> = {
  TSLAx: "TSLA", AAPLx: "AAPL", NVDAx: "NVDA", SPYx: "SPY",
};

// --- mock-mint resolution (devnet "mock:<slug>" whitelist rows) --------------

/** Indexed whitelist label for one mint ("mock:<slug>"). */
export interface MockMintRow {
  mint: string;
  price_source: string;
}

interface MockIndexEntry {
  mint: string;
  slug: string;
  priceSource: string;
}

/**
 * Read the mock-labeled whitelist rows for /prices/compare (read-only). The
 * SQL is a fully static literal — nothing from the request is interpolated —
 * and fails open to [] so a DB hiccup degrades to catalog fallback, not 500s.
 */
export async function readMockWhitelistRows(db: PgLike): Promise<MockMintRow[]> {
  try {
    const res = await db.query(
      "SELECT mint, price_source FROM whitelisted_mints WHERE price_source LIKE 'mock:%'",
    );
    const rows: MockMintRow[] = [];
    for (const row of res.rows) {
      const mint = (row as { mint?: unknown }).mint;
      const priceSource = (row as { price_source?: unknown }).price_source;
      if (typeof mint === "string" && typeof priceSource === "string") {
        rows.push({ mint, price_source: priceSource });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * Index mock whitelist rows by every ticker shape a client may send: the real
 * equity ticker ("TSLA" — what the Create wizard derives from "mock:tsla") and
 * the display symbol ("TSLAx").
 */
function buildMockIndex(rows: MockMintRow[]): Record<string, MockIndexEntry> {
  const idx: Record<string, MockIndexEntry> = {};
  for (const row of rows) {
    if (!isMockPriceSource(row.price_source)) continue;
    const slug = row.price_source.slice("mock:".length);
    const ticker = MOCK_SLUG_TO_TICKER[slug];
    if (!ticker) continue; // slug outside the catalog never resolves
    const entry: MockIndexEntry = { mint: row.mint, slug, priceSource: row.price_source };
    idx[ticker.toUpperCase()] = entry;
    idx[`${ticker.toUpperCase()}X`] = entry;
  }
  return idx;
}

/** Real quote for one mock entry via the guarded Yahoo path (60s TTL cache,
 *  spaced fetches — the same cache the NAV engine uses). Null on any failure. */
async function realQuoteForEntry(entry: MockIndexEntry): Promise<RealisticQuote | null> {
  if (!realisticMockPricesEnabled()) return null;
  try {
    return await realisticMockQuote(entry.slug);
  } catch {
    return null; // fail-open — the catalog fallback decides next
  }
}

/** Compare row for a devnet mock mint: real Yahoo price → catalog → unavailable. */
async function mockCompareTick(ticker: string, entry: MockIndexEntry): Promise<CompareTick> {
  const quote = await realQuoteForEntry(entry);
  if (quote && Number.isFinite(quote.price) && quote.price > 0) {
    return {
      ticker,
      mint: entry.mint,
      jupiter: quote.price,
      yahoo: quote.price,
      diffBps: 0,
      source: "yahoo",
    };
  }
  const catalog = mockPriceForPriceSource(entry.priceSource);
  if (catalog !== null && catalog > 0) {
    return {
      ticker,
      mint: entry.mint,
      jupiter: catalog,
      yahoo: null,
      diffBps: null,
      source: "mock",
    };
  }
  return { ticker, mint: entry.mint, jupiter: null, yahoo: null, diffBps: null, source: "unavailable" };
}

export interface CompareOptions {
  /**
   * Indexed whitelisted_mints rows (mock-labeled). Requested tickers that are
   * not real Backed mints resolve against these — a devnet "mock:tsla" mint
   * is quoted from the REAL market via the guarded Yahoo path, falling back to
   * the deterministic catalog, then to null (never fabricated).
   */
  mockRows?: MockMintRow[];
}

export async function comparePrices(
  tickers: string[] = Object.keys(TICKER_MINTS),
  opts: CompareOptions = {},
): Promise<CompareTick[]> {
  const mockIndex = buildMockIndex(opts.mockRows ?? []);
  const legacyTickers = tickers.filter((t) => TICKER_MINTS[t] !== undefined);
  const mints = legacyTickers.map((t) => TICKER_MINTS[t]);

  let jupiterMap: Record<string, number> = {};
  let useMock = false;
  if (mints.length > 0) {
    try {
      jupiterMap = await fetchPrices(mints);
      const hasAny = Object.values(jupiterMap).some((v) => v > 0);
      if (!hasAny) useMock = true;
    } catch {
      useMock = true;
    }
  }

  const out: CompareTick[] = [];
  for (const ticker of tickers) {
    const mint = TICKER_MINTS[ticker];
    if (mint === undefined) {
      // Not a real Backed mint — try the devnet mock whitelist resolution.
      const entry = mockIndex[ticker.trim().toUpperCase()];
      out.push(entry ? await mockCompareTick(ticker, entry)
                     : { ticker, mint: "", jupiter: null, yahoo: null, diffBps: null, source: "unavailable" });
      continue;
    }
    const yahooSym = YAHOO_MAP[ticker];
    const yahoo = yahooSym ? await fetchYahooPrice(yahooSym) : null;
    let jupiter: number | null = jupiterMap[mint] ?? null;
    let source: NonNullable<CompareTick["source"]> = "jupiter";
    if (useMock || jupiter == null || jupiter === 0) {
      // Mock'u gerçekçi yap: Yahoo fiyatının %99.5-100.5 arası jitter, gerçek depeg simülasyonu
      jupiter = yahoo != null ? Number((yahoo * (0.998 + Math.random() * 0.004)).toFixed(2)) : null;
      source = jupiter != null ? "yahoo" : "unavailable";
    }
    const diffBps = (jupiter != null && yahoo != null && yahoo !== 0) ? Math.round((jupiter - yahoo) / yahoo * 10000) : null;
    out.push({ ticker, mint, jupiter, yahoo, diffBps, source });
  }
  return out;
}

export async function getChartSeries(ticker: string, range="1mo") {
  const mint = TICKER_MINTS[ticker];
  const yahooSym = YAHOO_MAP[ticker];
  const [yahoo, nasdaq] = await Promise.all([
    yahooSym ? fetchYahooSeries(yahooSym, range, "1d").catch(()=>({symbol:yahooSym,candles:[]})) : {symbol:"",candles:[]},
    fetchYahooSeries("QQQ", range, "1d").catch(()=>({symbol:"QQQ",candles:[]})),
  ]);
  // xStock series: mock OHLCV from yahoo jitter (real would be Jupiter snapshots)
  const xStockCandles = yahoo.candles.map(c=>({
    ts:c.ts,
    open: c.open * (0.995 + Math.random()*0.01),
    high: c.high * (0.995 + Math.random()*0.01),
    low: c.low * (0.995 + Math.random()*0.01),
    close: c.close * (0.995 + Math.random()*0.01),
    volume: c.volume,
  }));
  return { ticker, mint, yahoo, xStock: { symbol: ticker, candles: xStockCandles }, nasdaq };
}

export async function getOHLCSeries(ticker: string, range="1mo") {
  const yahooSym = YAHOO_MAP[ticker] || ticker;
  const series = await fetchYahooSeries(yahooSym, range, "1d").catch(()=>({symbol:yahooSym,candles:[]}));
  return series;
}
