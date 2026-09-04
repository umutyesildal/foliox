/**
 * devnet-catalog.test.ts — devnet readiness for the 12-stock mock xStock
 * universe. Pure / offline only (NO listening, NO RPC, NO real Postgres):
 *   1. catalog/mockStocks.ts — exactly 12 stocks, exact symbol → price_source
 *      mapping, deterministic prices, lookup helpers.
 *   2. MAG SIX flagship composition — NAV / drift / share-price math on the
 *      catalog prices (workers/navEngine.ts exact fixed point).
 *   3. workers/mockPriceFill.ts — mock-aware quote fetcher: Jupiter first,
 *      catalog fill ONLY for whitelisted mints labeled "mock:<slug>",
 *      fail-open everywhere, provenance source "mock".
 *   4. .env.devnet profile — real env var names (from code), program IDs, and
 *      honest factory gating; asserts no key material exists in the profile.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { PublicKey } from "@solana/web3.js";

import {
  DEVNET_FLAGSHIP_BASKET,
  MOCK_PRICE_SOURCE_RE,
  MOCK_SLUG_TO_TICKER,
  MOCK_STOCK_COUNT,
  MOCK_XSTOCKS,
  flagshipWeightFor,
  isMockPriceSource,
  mockPriceForPriceSource,
  mockPriceForSymbol,
  mockPriceSources,
  mockQuoteForPriceSource,
  mockSlugTickerPairs,
  mockStockByPriceSource,
  mockStockBySymbol,
  mockSymbols,
  tickerForSlug,
} from "../src/catalog/mockStocks";
import { createMockAwareQuoteFetcher } from "../src/workers/mockPriceFill";
import {
  REALISTIC_FETCH_GAP_MS,
  REALISTIC_MOCK_PRICES_ENV,
  REALISTIC_QUOTE_TTL_MS,
  clearRealisticQuoteCache,
  realisticMockPricesEnabled,
  realisticMockQuote,
  type RealisticQuote,
} from "../src/workers/realisticMockPrices";
import type { YahooQuote } from "../src/workers/yahooFetch";
import {
  clearPriceCache,
  fetchPriceQuotes,
  type PriceQuoteMap,
} from "../src/workers/priceFetch";
import {
  NavEngine,
  computeDriftExact,
  computeNav,
  computeNavExact,
  computeSharePriceExact,
} from "../src/workers/navEngine";
import { indexerConfigFromEnv } from "../src/indexer/listener";
import type { PgLike } from "../src/db/client";

// --- fakes -------------------------------------------------------------------

const NOW = new Date("2026-09-04T12:00:00Z");
const now = () => NOW;

function mintPubkey(seed: number): string {
  return new PublicKey(Buffer.alloc(32, seed)).toBase58();
}

type SqlRoute = { match: string | RegExp; rows: unknown[] };

/** PgLike test double routing canned rows by SQL fragment (waveb pattern). */
function fakeDb(routes: SqlRoute[] = []) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  return {
    calls,
    query: async (sql: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> => {
      calls.push({ sql, values });
      for (const r of routes) {
        if (typeof r.match === "string" ? sql.includes(r.match) : r.match.test(sql)) {
          return { rows: r.rows.map((x) => ({ ...x })), rowCount: r.rows.length };
        }
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PgLike & { calls: Array<{ sql: string; values?: unknown[] }> };
}

/** Base fetcher simulating Jupiter: fails (devnet mints are unknown to it). */
function jupiterDown() {
  return async (_mints: string[]): Promise<PriceQuoteMap> =>
    fetchPriceQuotes([], { fetchImpl: (async () => {
      throw new Error("connection refused");
    }) as typeof fetch, fallback: "none", now });
}

function baseReturning(quotes: PriceQuoteMap) {
  return async (_mints: string[]): Promise<PriceQuoteMap> => ({ ...quotes });
}

// ============================================================================
// 1. Catalog — the 12-stock mock xStock universe
// ============================================================================

describe("catalog/mockStocks — the 12-stock mock universe", () => {
  const EXPECTED: Array<[string, string, number]> = [
    ["TSLAx", "mock:tsla", 250],
    ["NVDAx", "mock:nvda", 180],
    ["AAPLx", "mock:aapl", 230],
    ["MSFTx", "mock:msft", 420],
    ["AMZNx", "mock:amzn", 185],
    ["GOOGLx", "mock:googl", 165],
    ["METAx", "mock:meta", 510],
    ["AMDx", "mock:amd", 140],
    ["COINx", "mock:coin", 210],
    ["MSTRx", "mock:mstr", 130],
    ["HOODx", "mock:hood", 38],
    ["SPYx", "mock:spy", 560],
  ];

  it("has EXACTLY 12 stocks with the exact symbol → price_source mapping", () => {
    expect(MOCK_STOCK_COUNT).toBe(12);
    expect(MOCK_XSTOCKS.length).toBe(12);
    expect(MOCK_XSTOCKS.map((s) => [s.symbol, s.priceSource] as [string, string]))
      .toEqual(EXPECTED.map(([sym, ps]) => [sym, ps]));
  });

  it("keeps the original 4 (TSLAx/AAPLx/NVDAx/SPYx) and adds the 8 new ones", () => {
    const symbols = mockSymbols();
    for (const old of ["TSLAx", "AAPLx", "NVDAx", "SPYx"]) expect(symbols).toContain(old);
    for (const neu of ["MSFTx", "AMZNx", "GOOGLx", "METAx", "AMDx", "COINx", "MSTRx", "HOODx"]) {
      expect(symbols).toContain(neu);
    }
    expect(symbols.length).toBe(12);
  });

  it("carries deterministic positive USD prices (stable dev-catalog values)", () => {
    for (const [symbol, , price] of EXPECTED) {
      expect(mockPriceForSymbol(symbol)).toBe(price);
    }
    for (const s of MOCK_XSTOCKS) {
      expect(Number.isFinite(s.priceUsd)).toBe(true);
      expect(s.priceUsd).toBeGreaterThan(0);
    }
  });

  it("every price_source matches the on-chain mock:<slug> format and is unique", () => {
    const sources = mockPriceSources();
    expect(new Set(sources).size).toBe(12);
    expect(new Set(mockSymbols()).size).toBe(12);
    for (const ps of sources) expect(MOCK_PRICE_SOURCE_RE.test(ps)).toBe(true);
    expect(isMockPriceSource("mock:tsla")).toBe(true);
    // Mainnet-style sources never look like mocks.
    expect(isMockPriceSource("jupiter:TSLAx")).toBe(false);
    expect(isMockPriceSource("mock:")).toBe(false);
  });

  it("lookup helpers round-trip and return null for unknown inputs", () => {
    expect(mockStockBySymbol("NVDAx")?.priceSource).toBe("mock:nvda");
    expect(mockStockByPriceSource("mock:nvda")?.symbol).toBe("NVDAx");
    expect(mockPriceForPriceSource("mock:hood")).toBe(38);
    expect(mockPriceForSymbol("BRKx")).toBeNull();
    expect(mockPriceForPriceSource("jupiter:TSLAx")).toBeNull();
    expect(mockPriceForPriceSource("mock:zzz")).toBeNull();
    expect(mockStockBySymbol("tslax")).toBeNull(); // case-sensitive display tickers
  });

  it("mockQuoteForPriceSource builds a source-marked quote, null for non-mocks", () => {
    const q = mockQuoteForPriceSource(mintPubkey(1), "mock:aapl", NOW.toISOString());
    expect(q).toEqual({ mint: mintPubkey(1), price: 230, source: "mock", asOf: NOW.toISOString() });
    expect(mockQuoteForPriceSource(mintPubkey(2), "jupiter:TSLAx", NOW.toISOString())).toBeNull();
  });
});

// ============================================================================
// 2. MAG SIX — flagship devnet basket math on catalog prices
// ============================================================================

describe("catalog — MAG SIX flagship NAV math", () => {
  const MAG_SIX_SYMBOLS = DEVNET_FLAGSHIP_BASKET.weightsBps.map((w) => w.symbol);
  const MAG_SIX_WEIGHTS = DEVNET_FLAGSHIP_BASKET.weightsBps.map((w) => w.weightBps);

  it("weights sum to exactly 10_000 bps and every constituent is in the catalog", () => {
    expect(MAG_SIX_SYMBOLS).toEqual(["NVDAx", "AAPLx", "MSFTx", "METAx", "AMZNx", "GOOGLx"]);
    expect(MAG_SIX_WEIGHTS.reduce((a, b) => a + b, 0)).toBe(10_000);
    for (const sym of MAG_SIX_SYMBOLS) {
      expect(mockStockBySymbol(sym)).not.toBeNull();
      expect(flagshipWeightFor(sym)).toBeGreaterThan(0);
    }
    expect(flagshipWeightFor("TSLAx")).toBeNull(); // not a MAG SIX constituent
  });

  it("holdings scaled by weights/100 realize MAG SIX weights exactly: zero drift", () => {
    // scaled_i = weightBps_i / 100 → proportions match the targets exactly.
    const scaled = MAG_SIX_WEIGHTS.map((w) => (w / 100).toString()); // 25, 20, 15, 15, 12.5, 12.5
    const drift = computeDriftExact(scaled, MAG_SIX_WEIGHTS);
    expect(drift.actualWeightsBps).toEqual([2500, 2000, 1500, 1500, 1250, 1250]);
    expect(drift.driftBps).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("NAV via exact fixed point: Σ(scaled × catalog price) = 27425 USD", () => {
    const scaled = ["25", "20", "15", "15", "12.5", "12.5"];
    const prices = MAG_SIX_SYMBOLS.map((s) => mockPriceForSymbol(s) as number);
    // 25*180 + 20*230 + 15*420 + 15*510 + 12.5*185 + 12.5*165 = 27425
    expect(computeNavExact(scaled, prices)).toBe("27425");
    expect(computeNav(scaled.map(Number), prices)).toBe(27425);
  });

  it("share price over the 1M genesis supply: 27425 / 1_000_000 = 0.027425", () => {
    expect(computeSharePriceExact("27425", "1000000")).toBe("0.027425");
  });

  it("equal-share holdings produce honest (non-zero) drift vs MAG SIX targets", () => {
    const scaled = ["10", "10", "10", "10", "10", "10"];
    const drift = computeDriftExact(scaled, MAG_SIX_WEIGHTS);
    // actual = round(10/60 × 10_000) = 1667 for every leg.
    expect(drift.actualWeightsBps).toEqual([1667, 1667, 1667, 1667, 1667, 1667]);
    expect(drift.driftBps).toEqual([-833, -333, 167, 167, 417, 417]);
    const prices = MAG_SIX_SYMBOLS.map((s) => mockPriceForSymbol(s) as number);
    expect(computeNavExact(scaled, prices)).toBe("16900"); // 10 × (180+230+420+510+185+165)
  });
});

// ============================================================================
// 3. mock-aware quote fetcher (workers/mockPriceFill.ts)
// ============================================================================

describe("workers/mockPriceFill — catalog fill for mock-labeled whitelist mints", () => {
  it("fills Jupiter-missing mints from the catalog when the whitelist says mock:<slug>", async () => {
    clearPriceCache();
    const M_TSLA = mintPubkey(21);
    const M_NVDA = mintPubkey(22);
    const db = fakeDb([
      {
        match: "FROM whitelisted_mints",
        rows: [
          { mint: M_TSLA, price_source: "mock:tsla" },
          { mint: M_NVDA, price_source: "mock:nvda" },
        ],
      },
    ]);
    const fetchQuotes = createMockAwareQuoteFetcher(db, {
      fetchQuotes: jupiterDown(),
      now,
    });
    const quotes = await fetchQuotes([M_TSLA, M_NVDA]);
    expect(quotes[M_TSLA]).toEqual({ mint: M_TSLA, price: 250, source: "mock", asOf: NOW.toISOString() });
    expect(quotes[M_NVDA]).toEqual({ mint: M_NVDA, price: 180, source: "mock", asOf: NOW.toISOString() });
    expect(db.calls.length).toBe(1); // one whitelist lookup for the missing set
  });

  it("never fills a mint whose whitelist row is NOT a mock source (jupiter:*)", async () => {
    clearPriceCache();
    const M_MAIN = mintPubkey(23);
    const db = fakeDb([
      { match: "FROM whitelisted_mints", rows: [{ mint: M_MAIN, price_source: "jupiter:TSLAx" }] },
    ]);
    const fetchQuotes = createMockAwareQuoteFetcher(db, { fetchQuotes: jupiterDown(), now });
    const quotes = await fetchQuotes([M_MAIN]);
    expect(quotes[M_MAIN]).toBeUndefined(); // no fabricated price — honest absence
  });

  it("a positive provider price is never overwritten by the catalog", async () => {
    const M_MOCK = mintPubkey(24);
    const providerQuote: PriceQuoteMap = {
      [M_MOCK]: { mint: M_MOCK, price: 123.45, source: "jupiter", asOf: NOW.toISOString() },
    };
    const readWhitelist = async () => [{ mint: M_MOCK, price_source: "mock:tsla" }];
    const fetchQuotes = createMockAwareQuoteFetcher(fakeDb(), {
      fetchQuotes: baseReturning(providerQuote),
      now,
      readWhitelist,
    });
    const quotes = await fetchQuotes([M_MOCK]);
    expect(quotes[M_MOCK]).toEqual(providerQuote[M_MOCK]); // Jupiter wins
  });

  it("replaces price-0 'mock' placeholders (PRICE_FALLBACK=mock shape) with catalog prices", async () => {
    const M_HOOD = mintPubkey(25);
    const placeholder: PriceQuoteMap = {
      [M_HOOD]: { mint: M_HOOD, price: 0, source: "mock", asOf: NOW.toISOString() },
    };
    const readWhitelist = async () => [{ mint: M_HOOD, price_source: "mock:hood" }];
    const fetchQuotes = createMockAwareQuoteFetcher(fakeDb(), {
      fetchQuotes: baseReturning(placeholder),
      now,
      readWhitelist,
    });
    const quotes = await fetchQuotes([M_HOOD]);
    expect(quotes[M_HOOD]?.price).toBe(38);
    expect(quotes[M_HOOD]?.source).toBe("mock");
  });

  it("is fail-open: DB errors, unknown mock slugs, and empty whitelists fill nothing", async () => {
    clearPriceCache();
    const M_X = mintPubkey(26);
    const throwingDb = {
      query: async () => {
        throw new Error("relation does not exist");
      },
    } as unknown as PgLike;
    const fetchQuotes = createMockAwareQuoteFetcher(throwingDb, { fetchQuotes: jupiterDown(), now });
    const quotes = await fetchQuotes([M_X]);
    expect(quotes[M_X]).toBeUndefined();

    const unknownSlug = createMockAwareQuoteFetcher(fakeDb(), {
      fetchQuotes: jupiterDown(),
      now,
      readWhitelist: async () => [{ mint: M_X, price_source: "mock:zzz" }],
    });
    expect((await unknownSlug([M_X]))[M_X]).toBeUndefined();
  });
});

// ============================================================================
// 3b. MOCK_SLUG_TO_TICKER — slug → real equity ticker mapping
// ============================================================================

describe("catalog — MOCK_SLUG_TO_TICKER (realistic price path)", () => {
  const EXPECTED_TICKERS: Record<string, string> = {
    tsla: "TSLA", nvda: "NVDA", aapl: "AAPL", msft: "MSFT", amzn: "AMZN",
    googl: "GOOGL", meta: "META", amd: "AMD", coin: "COIN", mstr: "MSTR",
    hood: "HOOD", spy: "SPY",
  };

  it("maps exactly the 12 catalog slugs to the exact real tickers", () => {
    expect(Object.keys(MOCK_SLUG_TO_TICKER).length).toBe(12);
    expect({ ...MOCK_SLUG_TO_TICKER }).toEqual(EXPECTED_TICKERS);
  });

  it("every catalog price_source slug resolves to a ticker (one-to-one)", () => {
    for (const [slug, ticker] of mockSlugTickerPairs()) {
      expect(tickerForSlug(slug)).toBe(ticker);
      expect(EXPECTED_TICKERS[slug]).toBe(ticker);
    }
    expect(mockSlugTickerPairs().length).toBe(12);
  });

  it("unknown / malformed slugs never resolve (catalog fallback stays honest)", () => {
    expect(tickerForSlug("zzz")).toBeNull();
    expect(tickerForSlug("")).toBeNull();
    expect(tickerForSlug("NVDA")).toBeNull(); // tickers are values, not slugs
    expect(tickerForSlug("jupiter:TSLAx")).toBeNull();
  });
});

// ============================================================================
// 3c. workers/realisticMockPrices — env gate, TTL cache, fail-open fetch
// ============================================================================

describe("workers/realisticMockPrices — REALISTIC_MOCK_PRICES gate + Yahoo quote", () => {
  let clockMs: number;
  const now = () => new Date(clockMs);
  const sleeps: number[] = [];

  function yahooOk(price: number): (ticker: string) => Promise<YahooQuote> {
    return (ticker) => Promise.resolve({ symbol: ticker, price, currency: "USD", marketState: "REGULAR" });
  }

  beforeEach(() => {
    clockMs = NOW.getTime();
    sleeps.length = 0;
    clearRealisticQuoteCache();
  });

  describe("realisticMockPricesEnabled (default OFF when unset)", () => {
    it("is OFF when the env var is unset (deterministic local dev)", () => {
      expect(realisticMockPricesEnabled({} as NodeJS.ProcessEnv)).toBe(false);
      expect(realisticMockPricesEnabled({ OTHER: "1" } as NodeJS.ProcessEnv)).toBe(false);
    });

    it("is OFF for 0/empty/false/junk values", () => {
      for (const v of ["0", "", "false", "FALSE", "junk", "off ", " 2"]) {
        expect(realisticMockPricesEnabled({ REALISTIC_MOCK_PRICES: v } as NodeJS.ProcessEnv)).toBe(false);
      }
    });

    it("is ON for 1/true/yes/on (case-insensitive)", () => {
      for (const v of ["1", "true", "TRUE", "yes", "on", " 1 "]) {
        expect(realisticMockPricesEnabled({ REALISTIC_MOCK_PRICES: v } as NodeJS.ProcessEnv)).toBe(true);
      }
    });

    it("reads process.env by default (unset in the test shell ⇒ OFF)", () => {
      expect(REALISTIC_MOCK_PRICES_ENV).toBe("REALISTIC_MOCK_PRICES");
      if (process.env.REALISTIC_MOCK_PRICES === undefined) {
        expect(realisticMockPricesEnabled(process.env)).toBe(false);
      }
    });
  });

  describe("realisticMockQuote", () => {
    it("quotes the real ticker price with source-ready provenance fields", async () => {
      const q = await realisticMockQuote("nvda", {
        now, fetchQuote: yahooOk(181.25), spacingMs: 0,
      });
      expect(q).toEqual({
        slug: "nvda", ticker: "NVDA", price: 181.25, marketState: "REGULAR",
        asOf: NOW.toISOString(),
      });
    });

    it("caches for REALISTIC_QUOTE_TTL_MS and refetches after expiry", async () => {
      let calls = 0;
      const fetchQuote = (ticker: string): Promise<YahooQuote> => {
        calls++;
        return Promise.resolve({ symbol: ticker, price: 100 + calls, currency: "USD", marketState: "REGULAR" });
      };
      const first = await realisticMockQuote("aapl", { now, fetchQuote, spacingMs: 0, sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); } });
      const cached = await realisticMockQuote("aapl", { now, fetchQuote, spacingMs: 0 });
      expect(calls).toBe(1); // within TTL → served from cache, no second fetch
      expect(cached).toEqual(first);

      clockMs += REALISTIC_QUOTE_TTL_MS + 1;
      const refreshed = await realisticMockQuote("aapl", { now, fetchQuote, spacingMs: 0, sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); } });
      expect(calls).toBe(2);
      expect(refreshed?.price).toBe(102);
    });

    it("is fail-open: fetch throws, rejects, returns junk, or slug unknown ⇒ null", async () => {
      const boom = (): Promise<YahooQuote> => Promise.reject(new Error("yahoo NVDA 429"));
      expect(await realisticMockQuote("nvda", { now, fetchQuote: boom, spacingMs: 0 })).toBeNull();

      const throws = (): Promise<YahooQuote> => { throw new Error("sync boom"); };
      expect(await realisticMockQuote("nvda", { now, fetchQuote: throws, spacingMs: 0 })).toBeNull();

      const junk = (): Promise<YahooQuote> =>
        Promise.resolve({ symbol: "NVDA", price: Number.NaN, currency: null, marketState: null });
      expect(await realisticMockQuote("nvda", { now, fetchQuote: junk, spacingMs: 0 })).toBeNull();

      let calls = 0;
      const spy = (t: string): Promise<YahooQuote> => { calls++; return yahooOk(1)(t); };
      expect(await realisticMockQuote("zzz", { now, fetchQuote: spy, spacingMs: 0 })).toBeNull();
      expect(calls).toBe(0); // unknown slug never reaches Yahoo
    });

    it("does NOT cache failures — the next call retries the fetcher", async () => {
      let fail = true;
      const flaky = (ticker: string): Promise<YahooQuote> =>
        fail ? Promise.reject(new Error("yahoo 429")) : yahooOk(55)(ticker);
      expect(await realisticMockQuote("hood", { now, fetchQuote: flaky, spacingMs: 0 })).toBeNull();
      fail = false;
      const retry = await realisticMockQuote("hood", { now, fetchQuote: flaky, spacingMs: 0 });
      expect(retry?.price).toBe(55); // transient outage recovers on next pass
    });

    it("spaces real fetches by REALISTIC_FETCH_GAP_MS (politeness)", async () => {
      const mk = () => realisticMockQuote("tsla", {
        now, fetchQuote: yahooOk(250.5),
        spacingMs: REALISTIC_FETCH_GAP_MS,
        ttlMs: 0, // force a real fetch each call
        sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
      });
      await mk(); // first: no wait (module clock uninitialized vs fixed NOW)
      await mk(); // fixed NOW ⇒ full gap requested
      expect(sleeps.length).toBe(2);
      expect(sleeps[1]).toBeLessThanOrEqual(REALISTIC_FETCH_GAP_MS);
      expect(sleeps[1]).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// 3d. mockPriceFill × REALISTIC_MOCK_PRICES — yahoo first, catalog fallback
// ============================================================================

describe("workers/mockPriceFill — realistic gating (env on/off, per-symbol fallback)", () => {
  const REAL_ENV = { REALISTIC_MOCK_PRICES: "1" } as NodeJS.ProcessEnv;
  const OFF_ENV = {} as NodeJS.ProcessEnv;

  function yahooReal(price: number): (slug: string) => Promise<RealisticQuote | null> {
    return (slug) =>
      Promise.resolve({
        slug,
        ticker: slug.toUpperCase(),
        price,
        marketState: "REGULAR",
        asOf: NOW.toISOString(),
      });
  }

  it("env ON + Yahoo success ⇒ source 'yahoo' with the real price", async () => {
    const M_NVDA = mintPubkey(31);
    const db = fakeDb([
      { match: "FROM whitelisted_mints", rows: [{ mint: M_NVDA, price_source: "mock:nvda" }] },
    ]);
    let realisticCalls = 0;
    const fetchQuotes = createMockAwareQuoteFetcher(db, {
      fetchQuotes: jupiterDown(),
      now,
      env: REAL_ENV,
      fetchRealistic: (slug) => { realisticCalls++; return yahooReal(181.42)(slug); },
    });
    const quotes = await fetchQuotes([M_NVDA]);
    expect(realisticCalls).toBe(1);
    expect(quotes[M_NVDA]).toEqual({
      mint: M_NVDA, price: 181.42, source: "yahoo", asOf: NOW.toISOString(),
    });
  });

  it("env ON + Yahoo failure ⇒ per-symbol catalog fallback, source 'mock'", async () => {
    const M_AAPL = mintPubkey(32);
    const db = fakeDb([
      { match: "FROM whitelisted_mints", rows: [{ mint: M_AAPL, price_source: "mock:aapl" }] },
    ]);
    const fetchQuotes = createMockAwareQuoteFetcher(db, {
      fetchQuotes: jupiterDown(),
      now,
      env: REAL_ENV,
      fetchRealistic: () => Promise.resolve(null), // 429 / timeout / bad symbol
    });
    const quotes = await fetchQuotes([M_AAPL]);
    expect(quotes[M_AAPL]).toEqual({
      mint: M_AAPL, price: 230, source: "mock", asOf: NOW.toISOString(),
    });
  });

  it("mixed batch: each symbol degrades independently — one bad symbol never breaks the run", async () => {
    const M_NVDA = mintPubkey(33);
    const M_AAPL = mintPubkey(34);
    const M_TSLA = mintPubkey(35);
    const db = fakeDb([
      {
        match: "FROM whitelisted_mints",
        rows: [
          { mint: M_NVDA, price_source: "mock:nvda" },
          { mint: M_AAPL, price_source: "mock:aapl" },
          { mint: M_TSLA, price_source: "mock:tsla" },
        ],
      },
    ]);
    const fetchQuotes = createMockAwareQuoteFetcher(db, {
      fetchQuotes: jupiterDown(),
      now,
      env: REAL_ENV,
      fetchRealistic: (slug) => (slug === "aapl" ? Promise.resolve(null) : yahooReal(181.42)(slug)),
    });
    const quotes = await fetchQuotes([M_NVDA, M_AAPL, M_TSLA]);
    expect(quotes[M_NVDA]?.source).toBe("yahoo");
    expect(quotes[M_AAPL]?.source).toBe("mock"); // fell back
    expect(quotes[M_AAPL]?.price).toBe(230);
    expect(quotes[M_TSLA]?.source).toBe("yahoo");
    expect(quotes[M_TSLA]?.price).toBe(181.42);
  });

  it("env OFF (unset) ⇒ never calls Yahoo — deterministic catalog, source 'mock'", async () => {
    clearPriceCache();
    const M_MSFT = mintPubkey(36);
    const db = fakeDb([
      { match: "FROM whitelisted_mints", rows: [{ mint: M_MSFT, price_source: "mock:msft" }] },
    ]);
    let realisticCalls = 0;
    const fetchQuotes = createMockAwareQuoteFetcher(db, {
      fetchQuotes: jupiterDown(),
      now,
      env: OFF_ENV,
      fetchRealistic: (slug) => { realisticCalls++; return yahooReal(999)(slug); },
    });
    const quotes = await fetchQuotes([M_MSFT]);
    expect(realisticCalls).toBe(0);
    expect(quotes[M_MSFT]).toEqual({
      mint: M_MSFT, price: 420, source: "mock", asOf: NOW.toISOString(),
    });
  });

  it("env ON still never overwrites a positive provider (Jupiter) price", async () => {
    const M_MOCK = mintPubkey(37);
    const providerQuote: PriceQuoteMap = {
      [M_MOCK]: { mint: M_MOCK, price: 123.45, source: "jupiter", asOf: NOW.toISOString() },
    };
    const fetchQuotes = createMockAwareQuoteFetcher(fakeDb(), {
      fetchQuotes: baseReturning(providerQuote),
      now,
      env: REAL_ENV,
      fetchRealistic: yahooReal(181.42),
    });
    const quotes = await fetchQuotes([M_MOCK]);
    expect(quotes[M_MOCK]?.source).toBe("jupiter");
    expect(quotes[M_MOCK]?.price).toBe(123.45);
  });
});

// ============================================================================
// 3e. NAV math is unchanged when realistic prices are injected
// ============================================================================

describe("NAV math with injected realistic (yahoo) prices — same formulas, real inputs", () => {
  const M_NVDA = mintPubkey(41);
  const M_AAPL = mintPubkey(42);
  const M_MSFT = mintPubkey(43);
  // 40/32/28 units vs 4000/3200/2800 bps targets ⇒ exact zero drift.
  const BASKET = { pubkey: "BASKET_X", share_mint: "SHARE_X", constituents: [M_NVDA, M_AAPL, M_MSFT], weights_bps: [4000, 3200, 2800] };

  function holdingsDb() {
    return fakeDb([
      {
        match: "FROM vault_holdings",
        rows: [
          { mint: M_NVDA, scaled_amount: "40" },
          { mint: M_AAPL, scaled_amount: "32" },
          { mint: M_MSFT, scaled_amount: "28" },
        ],
      },
    ]);
  }

  const REAL_PRICES = { nvda: 181.42, aapl: 233.09, msft: 402.17 };

  function yahooQuoteMap(): PriceQuoteMap {
    return {
      [M_NVDA]: { mint: M_NVDA, price: REAL_PRICES.nvda, source: "yahoo", asOf: NOW.toISOString() },
      [M_AAPL]: { mint: M_AAPL, price: REAL_PRICES.aapl, source: "yahoo", asOf: NOW.toISOString() },
      [M_MSFT]: { mint: M_MSFT, price: REAL_PRICES.msft, source: "yahoo", asOf: NOW.toISOString() },
    };
  }

  it("computeForBasket: NAV/share-price/drift formulas unchanged under yahoo quotes", async () => {
    const engine = new NavEngine({
      db: holdingsDb(),
      fetchQuotes: async () => yahooQuoteMap(),
      fetchSupply: async () => ({ supply: "1000000", source: "rpc" }),
      now,
    });
    const c = await engine.computeForBasket(holdingsDb(), BASKET, NOW.toISOString());
    expect(c.skipReason).toBeUndefined();

    // NAV = Σ(scaled × real price) — the SAME exact fixed-point math, only the
    // inputs are real now. Expected computed both ways and cross-checked.
    const expectedNav = computeNavExact(
      ["40", "32", "28"],
      [REAL_PRICES.nvda, REAL_PRICES.aapl, REAL_PRICES.msft],
    );
    expect(c.nav).toBe(expectedNav);
    expect(Number(c.nav)).toBeCloseTo(
      40 * REAL_PRICES.nvda + 32 * REAL_PRICES.aapl + 28 * REAL_PRICES.msft,
      6,
    );
    expect(c.sharePrice).toBe(computeSharePriceExact(expectedNav, "1000000"));
    expect(c.driftBps).toEqual([0, 0, 0]); // weights math untouched by prices
  });

  it("price provenance carries the real source labels into the snapshot payload", async () => {
    const engine = new NavEngine({
      db: holdingsDb(),
      fetchQuotes: async () => yahooQuoteMap(),
      fetchSupply: async () => ({ supply: "1000000", source: "rpc" }),
      now,
    });
    const c = await engine.computeForBasket(holdingsDb(), BASKET, NOW.toISOString());
    for (const mint of [M_NVDA, M_AAPL, M_MSFT]) {
      expect(c.priceSource[mint].source).toBe("yahoo");
      expect(c.priceSource[mint].asOf).toBe(NOW.toISOString());
    }
  });

  it("mixed sources (yahoo / mock / missing) are labeled honestly; NAV sums only priced legs", async () => {
    const mixed: PriceQuoteMap = {
      [M_NVDA]: { mint: M_NVDA, price: REAL_PRICES.nvda, source: "yahoo", asOf: NOW.toISOString() },
      [M_AAPL]: { mint: M_AAPL, price: 230, source: "mock", asOf: NOW.toISOString() },
      // MSFT absent → labeled "missing", price null, NAV contribution 0.
    };
    const engine = new NavEngine({
      db: holdingsDb(),
      fetchQuotes: async () => mixed,
      fetchSupply: async () => ({ supply: "1000000", source: "rpc" }),
      now,
    });
    const c = await engine.computeForBasket(holdingsDb(), BASKET, NOW.toISOString());
    expect(c.priceSource[M_NVDA]).toMatchObject({ source: "yahoo", price: REAL_PRICES.nvda });
    expect(c.priceSource[M_AAPL]).toMatchObject({ source: "mock", price: 230 });
    expect(c.priceSource[M_MSFT]).toMatchObject({ source: "missing", price: 0 });
    expect(c.nav).toBe(computeNavExact(["40", "32", "28"], [REAL_PRICES.nvda, 230, null]));
    expect(Number(c.nav)).toBeCloseTo(40 * REAL_PRICES.nvda + 32 * 230, 6);
  });
});

// ============================================================================
// 4. .env.devnet profile — real env names, program IDs, honest gating
// ============================================================================

describe(".env.devnet — profile parses with the exact env names from code", () => {
  const envPath = new URL("../.env.devnet", import.meta.url);
  const raw = fs.readFileSync(envPath, "utf8");
  const parsed: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    parsed[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }

  it("sets every env var the backend reads (names verified against code)", () => {
    for (const key of [
      "DATABASE_URL", "RPC_URL",
      "PROGRAM_WHITELIST", "PROGRAM_FACTORY", "PROGRAM_BASKET",
      "PORT", "NAV_ENGINE", "FEE_CRANK", "INDEXER_POLL_MS", "INDEXER_POLL_LIMIT",
      "HOLDINGS_SYNC_INTERVAL_MS",
    ]) {
      expect(parsed[key], `missing ${key}`).toBeTruthy();
    }
  });

  it("turns REALISTIC_MOCK_PRICES on while keeping PRICE_FALLBACK semantics untouched", () => {
    expect(parsed.REALISTIC_MOCK_PRICES).toBe("1");
    // PRICE_FALLBACK stays unset — catalog fill goes through mockPriceFill,
    // never the price-0 placeholder path.
    expect(parsed.PRICE_FALLBACK).toBeUndefined();
  });

  it("points at devnet RPC, the final program IDs, and a separate foliox_devnet DB", () => {
    expect(parsed.RPC_URL).toBe("https://api.devnet.solana.com");
    expect(parsed.PROGRAM_WHITELIST).toBe("FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS");
    expect(parsed.PROGRAM_FACTORY).toBe("3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF");
    expect(parsed.PROGRAM_BASKET).toBe("6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k");
    expect(parsed.PORT).toBe("3001");
    expect(parsed.DATABASE_URL.endsWith(":5432/foliox_devnet")).toBe(true);
  });

  it("holds NO key material — no keypair/secret/private vars, no payer address in values", () => {
    const keys = Object.keys(parsed);
    for (const k of keys) expect(k).not.toMatch(/KEYPAIR|SECRET|PRIVATE|MNEMONIC|SEED/);
    const payer = "y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE";
    for (const [k, v] of Object.entries(parsed)) {
      expect(`${k}=${v}`).not.toContain(payer); // deploy wallet stays out of the backend
    }
  });

  it("indexerConfigFromEnv picks up all three devnet programs from the profile", () => {
    const cfg = indexerConfigFromEnv(parsed as NodeJS.ProcessEnv);
    expect(cfg).not.toBeNull();
    expect(cfg?.rpcUrl).toBe("https://api.devnet.solana.com");
    expect(cfg?.programIds).toEqual([
      "FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS",
      "3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF",
      "6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k",
    ]);
    // Devnet pacing (shared public RPC): 30s poll, 20 sigs, 60s holdings pass.
    expect(cfg?.pollIntervalMs).toBe(30000);
    expect(cfg?.signaturesPerPoll).toBe(20);
    expect(cfg?.holdingsSyncIntervalMs).toBe(60000);
  });

  it("factories gate honestly on the profile: no DB ⇒ no engines (never started here)", async () => {
    const { createNavEngineFromEnv } = await import("../src/workers/navEngine");
    const { createFeeCrankFromEnv } = await import("../src/workers/feeCrank");
    // DB-less smoke only — the live worker starts processes, not this suite.
    expect(createNavEngineFromEnv({ db: null, env: parsed as NodeJS.ProcessEnv })).toBeNull();
    expect(createFeeCrankFromEnv({ db: null, env: parsed as NodeJS.ProcessEnv })).toBeNull();
  });
});
