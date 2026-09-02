/**
 * waveb-nav-api.test.ts — Wave B tasks 4-5: exact NAV math (integer-safe
 * fixed point), drift, performance windows, quote leg math with mocked
 * Jupiter fetch, the unsigned fee-crank builder (never signs), and the
 * DB-backed API routes with a fake PgLike. No RPC, no real Postgres.
 */
import { describe, it, expect } from "vitest";
import http from "http";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

import {
  NAV_SCALE,
  InMemoryCache,
  NavEngine,
  computeDriftExact,
  computeNav,
  computeNavExact,
  computePerformanceFromBaselines,
  computeSharePriceExact,
  decimalToFixedUnits,
  divFixed,
  fixedUnitsToDecimalString,
  mulFixed,
  pctReturnExact,
} from "../src/workers/navEngine";
import {
  BASKET_PROGRAM_ID,
  FeeCrank,
  estimateManagementFeeShares,
  type BuiltFeeTx,
} from "../src/workers/feeCrank";
import {
  MINT_ACCOUNTS_NOTE,
  ZAP_WARNING,
  handleZapIn,
  handleZapOut,
  redeemEntitlements,
  splitByWeightsRaw,
  usdcToRaw,
} from "../src/api/quotes";
import {
  API_VERSION,
  basketDetail,
  basketHoldings,
  basketPerformance,
  createHandler,
  healthReport,
  listBaskets,
  listWhitelist,
  navHistory,
} from "../src/api/server";
import type { PgLike } from "../src/db/client";

// --- fakes -------------------------------------------------------------------

type SqlRoute = { match: string | RegExp; rows: unknown[]; rowCount?: number };

/** PgLike test double that routes canned rows by SQL fragment. */
function fakeDb(routes: SqlRoute[] = []) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  return {
    calls,
    query: async (sql: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> => {
      calls.push({ sql, values });
      for (const r of routes) {
        if (typeof r.match === "string" ? sql.includes(r.match) : r.match.test(sql)) {
          return { rows: r.rows.map((x) => ({ ...x })), rowCount: r.rowCount ?? r.rows.length };
        }
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PgLike & { calls: Array<{ sql: string; values?: unknown[] }> };
}

function jupiterQuoteLeg(outAmount: string) {
  return {
    inAmount: "0",
    outAmount,
    priceImpactPct: "0.01",
    slippageBps: 50,
    routePlan: [{ swapInfo: { label: "Orca" } }, { swapInfo: { label: "Phoenix" } }],
  };
}

/** Mock fetch that answers every Jupiter quote URL with a canned leg. */
function mockJupiterFetch(outAmounts: string[], fail = false) {
  const urls: string[] = [];
  return {
    urls,
    fetchImpl: (async (url: string | URL | Request): Promise<Response> => {
      urls.push(String(url));
      if (fail) throw new Error("connection refused");
      const i = Math.min(urls.length - 1, outAmounts.length - 1);
      return new Response(JSON.stringify(jupiterQuoteLeg(outAmounts[i])), { status: 200 });
    }) as typeof fetch,
  };
}

const BASKET = new PublicKey(Buffer.alloc(32, 1)).toBase58();
const MINT_A = new PublicKey(Buffer.alloc(32, 2)).toBase58();
const MINT_B = new PublicKey(Buffer.alloc(32, 3)).toBase58();
const MINT_C = new PublicKey(Buffer.alloc(32, 4)).toBase58();
const SHARE_MINT = new PublicKey(Buffer.alloc(32, 9)).toBase58();
const CREATOR = new PublicKey(Buffer.alloc(32, 10)).toBase58();
const TREASURY = new PublicKey(Buffer.alloc(32, 11)).toBase58();
const KEEPER = new PublicKey(Buffer.alloc(32, 12)).toBase58();
const NOW = new Date("2026-09-01T12:00:00Z");
/** A syntactically valid (32-byte) blockhash stand-in for serialization tests. */
const FAKE_BLOCKHASH = new PublicKey(Buffer.alloc(32, 7));

const BASKET_ROW = {
  pubkey: BASKET,
  share_mint: SHARE_MINT,
  constituents: [MINT_A, MINT_B, MINT_C],
  weights_bps: [5000, 3000, 2000],
  exit_fee_bps: 50,
};

// ============================================================================
// 1. NAV math — integer-safe fixed point
// ============================================================================

describe("navEngine — exact fixed-point math", () => {
  it("computeNavExact reproduces the §5 example (500/300/200 @ 250/100/180 = 191k)", () => {
    expect(computeNavExact(["500", "300", "200"], [250, 100, 180])).toBe("191000");
  });

  it("computeNavExact stays exact where f64 drifts (0.29 × 100)", () => {
    expect(computeNav([0.29], [100])).toBeCloseTo(28.999999999999996, 12); // Number drift
    expect(computeNavExact(["0.29"], [100])).toBe("29"); // exact fixed point
  });

  it("computeNavExact preserves u64-scale holdings beyond Number.MAX_SAFE_INTEGER", () => {
    const huge = "9007199254740993"; // 2^53 + 1 — NOT representable as f64
    expect(computeNavExact([huge], [1])).toBe("9007199254740993");
    // f64 already lost the +1 at parse time (2^53+1 rounds down to 2^53):
    expect(String(Number(huge))).toBe("9007199254740992");
    expect(String(computeNav([Number(huge)], [1]))).toBe("9007199254740992");
  });

  it("computeNavExact multiplies huge scaled amounts × fractional prices without drift", () => {
    // 2^53+1 units × 1.5 = 13510798882111489.5 — exact in BigInt fixed point.
    expect(computeNavExact(["9007199254740993"], [1.5])).toBe("13510798882111489.5");
  });

  it("missing / null / non-finite prices contribute 0 (provenance records it)", () => {
    expect(computeNavExact(["100", "100"], [10, null])).toBe("1000");
    expect(computeNavExact(["100", "100"], [10, undefined])).toBe("1000");
    expect(computeNavExact(["100", "100"], [10, Number.NaN])).toBe("1000");
  });

  it("decimalToFixedUnits handles exponent notation and half-up rounding", () => {
    expect(decimalToFixedUnits("1.5e-7", 12)).toBe(150000n);
    expect(decimalToFixedUnits("1e21", 12)).toBe(10n ** 33n);
    expect(decimalToFixedUnits("1.0000000000005", 12)).toBe(1000000000001n); // half-up at 12 digits
    expect(decimalToFixedUnits("-2.5", 0)).toBe(-3n); // sign-preserving half-up
    expect(() => decimalToFixedUnits("abc", 12)).toThrow();
  });

  it("mulFixed / divFixed round half-up and format back losslessly", () => {
    expect(mulFixed(25n, 25n, 1)).toBe(63n); // 6.25 → 6.3 (half-up at scale 1)
    // 0.5 × 3 = 1.5 at NAV_SCALE, operands and result all scale-12 units
    expect(mulFixed(500000000000n, 3000000000000n, NAV_SCALE)).toBe(1500000000000n);
    expect(divFixed(1n, 3n, 12)).toBe(333333333333n);
    expect(divFixed(2n, 3n, 12)).toBe(666666666667n); // 0.666… rounds up
    expect(() => divFixed(10n, 0n, 12)).toThrow(/division by zero/);
    expect(fixedUnitsToDecimalString(-1500500n, 6)).toBe("-1.5005");
    expect(fixedUnitsToDecimalString(0n, 12)).toBe("0");
  });

  it("computeSharePriceExact matches the §8 example and the schema's nav/supply basis", () => {
    expect(computeSharePriceExact("191000", "10")).toBe("19100");
    // supply in raw base units (1M genesis = 1.0 human share @ 6 decimals):
    expect(computeSharePriceExact("1000", "1000000")).toBe("0.001");
    expect(computeSharePriceExact("1000", "0")).toBe("0");
  });

  it("computeDriftExact matches AGENTS §17: actual = scaled/Σscaled × 10000, drift = actual − target", () => {
    expect(computeDriftExact(["500", "300", "200"], [5000, 3000, 2000]).driftBps).toEqual([0, 0, 0]);
    expect(computeDriftExact(["600", "300", "100"], [5000, 3000, 2000]).driftBps).toEqual([1000, 0, -1000]);
    const empty = computeDriftExact(["0", "0"], [5000, 5000]);
    expect(empty.driftBps).toEqual([0, 0]);
    expect(empty.actualWeightsBps).toEqual([0, 0]);
  });

  it("computeDriftExact stays deterministic on u64-scale holdings", () => {
    const u = "12345678901234567890";
    const drift = computeDriftExact([u, u], [4000, 6000]);
    expect(drift.actualWeightsBps).toEqual([5000, 5000]);
    expect(drift.driftBps).toEqual([1000, -1000]);
  });

  it("pctReturnExact returns exact pct, null for zero/missing baselines", () => {
    expect(pctReturnExact("110", "100")).toBe("10");
    expect(pctReturnExact("105", "100")).toBe("5");
    expect(pctReturnExact("97.5", "100")).toBe("-2.5");
    expect(pctReturnExact("110", "0")).toBeNull();
  });

  it("computePerformanceFromBaselines builds 24h/7d/30d/inception windows with explicit nulls", () => {
    const perf = computePerformanceFromBaselines({ nav: "120", ts: "2026-09-01T12:00:00Z" }, [
      { window: "24h", nav: "100", ts: "2026-08-31T12:00:00Z" },
      { window: "7d", nav: "80", ts: "2026-08-25T12:00:00Z" },
      { window: "30d", nav: null, ts: null },
      { window: "inception", nav: "60", ts: "2026-01-01T00:00:00Z" },
    ]);
    expect(perf.windows["24h"]?.pct).toBe("20");
    expect(perf.windows["7d"]?.pct).toBe("50");
    expect(perf.windows["30d"]?.pct).toBeNull(); // insufficient data — explicit, not fabricated
    expect(perf.windows["inception"]?.pct).toBe("100");
  });
});

// ============================================================================
// 2. NAV engine worker — snapshots, cache, matview, degradation
// ============================================================================

describe("NavEngine worker", () => {
  function happyDb() {
    return fakeDb([
      { match: "FROM baskets ORDER", rows: [{ pubkey: BASKET, share_mint: "ShareMint11111111111111111111111111111111111", constituents: [MINT_A, MINT_B], weights_bps: [6000, 4000] }] },
      { match: "FROM vault_holdings WHERE basket", rows: [{ mint: MINT_A, scaled_amount: "500" }, { mint: MINT_B, scaled_amount: "300" }] },
      { match: "INSERT INTO nav_snapshots", rows: [], rowCount: 1 },
      { match: "REFRESH MATERIALIZED VIEW", rows: [], rowCount: 1 },
    ]);
  }

  const quotes = {
    [MINT_A]: { mint: MINT_A, price: 250, source: "jupiter" as const, asOf: NOW.toISOString() },
    [MINT_B]: { mint: MINT_B, price: 100, source: "jupiter" as const, asOf: NOW.toISOString() },
  };

  it("degrades honestly without DB: reason 'no-db', nothing persisted", async () => {
    const engine = new NavEngine({ db: null });
    const summary = await engine.runOnce();
    expect(summary.reason).toBe("no-db");
    expect(summary.snapshotsPersisted).toBe(0);
  });

  it("persists nav_snapshots with exact NAV + supply string + price provenance, caches nav:{basket}", async () => {
    const db = happyDb();
    const cache = new InMemoryCache();
    const engine = new NavEngine({
      db,
      cache,
      fetchQuotes: async () => quotes,
      fetchSupply: async () => ({ supply: "1000000", source: "rpc" }),
      now: () => NOW,
    });
    const summary = await engine.runOnce();

    expect(summary.basketsConsidered).toBe(1);
    expect(summary.snapshotsPersisted).toBe(1);
    expect(summary.rankingsRefreshed).toBe(true); // first pass refreshes the matview

    const insert = db.calls.find((c) => c.sql.includes("INSERT INTO nav_snapshots"));
    expect(insert).toBeDefined();
    // NAV = 500×250 + 300×100 = 155000; supply 1M raw; share_price = 0.155
    expect(insert!.values![0]).toBe(BASKET);
    expect(insert!.values![2]).toBe("155000");
    expect(insert!.values![3]).toBe("1000000"); // u64 supply bound as decimal string
    expect(insert!.values![4]).toBe("0.155");
    const priceSource = JSON.parse(insert!.values![5] as string) as Record<string, { source: string }>;
    expect(priceSource[MINT_A].source).toBe("jupiter");

    const cached = JSON.parse((await cache.get(`nav:${BASKET}`)) ?? "{}") as { nav: string; source: string; supply: string };
    expect(cached.nav).toBe("155000");
    expect(cached.supply).toBe("1000000");
    expect(cached.source).toBe("onchain-indexed");
  });

  it("refreshes basket_rankings only on its ~5m cadence, not every pass", async () => {
    let tick = 0;
    const now = () => new Date(NOW.getTime() + tick++ * 1000);
    const db = happyDb();
    const engine = new NavEngine({
      db,
      fetchQuotes: async () => quotes,
      fetchSupply: async () => ({ supply: "1000000", source: "rpc" }),
      now,
      rankingsRefreshMs: 300_000,
    });
    await engine.runOnce();
    await engine.runOnce(); // 1s later — inside the cadence
    let refreshes = db.calls.filter((c) => c.sql.includes("REFRESH MATERIALIZED VIEW")).length;
    expect(refreshes).toBe(1);
    tick = 400; // jump past 5m
    await engine.runOnce();
    refreshes = db.calls.filter((c) => c.sql.includes("REFRESH MATERIALIZED VIEW")).length;
    expect(refreshes).toBe(2);
  });

  it("skips persistence when no price is available — never a fabricated NAV=0 snapshot", async () => {
    const db = happyDb();
    const engine = new NavEngine({ db, fetchQuotes: async () => ({}), fetchSupply: async () => ({ supply: "1", source: "rpc" }) });
    const summary = await engine.runOnce();
    expect(summary.computations[0]?.skipReason).toBe("no-prices");
    expect(summary.snapshotsPersisted).toBe(0);
  });

  it("labels absent per-mint prices source 'missing' so a partial NAV is self-describing", async () => {
    const db = happyDb();
    const engine = new NavEngine({
      db,
      fetchQuotes: async () => ({ [MINT_A]: quotes[MINT_A] }),
      fetchSupply: async () => ({ supply: "1000000", source: "rpc" }),
    });
    const summary = await engine.runOnce();
    expect(summary.snapshotsPersisted).toBe(1);
    const insert = db.calls.find((c) => c.sql.includes("INSERT INTO nav_snapshots"));
    const priceSource = JSON.parse(insert!.values![5] as string) as Record<string, { source: string; price: number }>;
    expect(priceSource[MINT_A].source).toBe("jupiter");
    expect(priceSource[MINT_B].source).toBe("missing");
    expect(insert!.values![2]).toBe("125000"); // only the priced leg counts
  });

  it("skips baskets without indexed holdings", async () => {
    const db = fakeDb([
      { match: "FROM baskets ORDER", rows: [{ pubkey: BASKET, share_mint: "S", constituents: [MINT_A], weights_bps: [10000] }] },
      { match: "FROM vault_holdings WHERE basket", rows: [] },
    ]);
    const engine = new NavEngine({ db, fetchQuotes: async () => quotes });
    const summary = await engine.runOnce();
    expect(summary.computations[0]?.skipReason).toBe("no-holdings");
    expect(summary.snapshotsPersisted).toBe(0);
  });
});

// ============================================================================
// 3. Quote leg math + Jupiter quote endpoints (mocked fetch)
// ============================================================================

describe("quotes — integer-safe leg math", () => {
  it("splitByWeightsRaw splits by target weights and the last leg absorbs the remainder", () => {
    expect(splitByWeightsRaw(100_000_000n, [5000, 3000, 2000])).toEqual([50_000_000n, 30_000_000n, 20_000_000n]);
    expect(splitByWeightsRaw(10n, [3333, 3333, 3334])).toEqual([3n, 3n, 4n]); // sums to 10
    expect(splitByWeightsRaw(1n, [5000, 5000])).toEqual([0n, 1n]); // dust to last leg
  });

  it("redeemEntitlements reproduces the §5 floor example (550M vault, 1M shares, exit 50bps → 54,725,000)", () => {
    const r = redeemEntitlements([550_000_000n], 10_000_000n, 1_000_000n, 50);
    expect(r.exitFeeShares).toBe(5000n);
    expect(r.burnShares).toBe(995_000n);
    expect(r.outs).toEqual([54_725_000n]);
  });

  it("redeventitlements stays exact beyond 2^53 (BigInt floor)", () => {
    const max = 9_223_372_036_854_775_807n; // i64 ceiling
    const r = redeemEntitlements([max, max - 1n], max, 1n, 0);
    expect(r.outs).toEqual([1n, 0n]); // floor(9223372036854775806/9223372036854775807) = 0
  });

  it("usdcToRaw parses human USDC amounts to 6-decimal raw units without f64 drift", () => {
    expect(usdcToRaw("100")).toBe(100_000_000n);
    expect(usdcToRaw("100.5")).toBe(100_500_000n);
    expect(usdcToRaw(0.1)).toBe(100_000n);
    expect(usdcToRaw("1.000001")).toBe(1_000_001n);
    expect(() => usdcToRaw("0")).toThrow();
    expect(() => usdcToRaw("-5")).toThrow();
    expect(() => usdcToRaw("0.0000001")).toThrow(); // floors to 0 raw
  });
});

describe("quotes — POST /quotes/zap-in (mocked Jupiter)", () => {
  function dbForZapIn() {
    return fakeDb([
      { match: "FROM baskets WHERE pubkey", rows: [BASKET_ROW] },
      { match: "FROM nav_snapshots WHERE basket", rows: [{ nav: "1000000.000000000000", supply: "1000000000" }] },
    ]);
  }

  it("returns 3 weight-sized USDC legs with provenance, warning and mintAccountsNote", async () => {
    const jup = mockJupiterFetch(["49000000", "29400000", "19500000"]);
    const out = await handleZapIn({ db: dbForZapIn(), fetchImpl: jup.fetchImpl, now: () => NOW }, {
      basket: BASKET,
      amountUSDC: 100,
      slippageBps: 50,
    });
    expect(out.status).toBe(200);
    const payload = out.payload as Record<string, unknown>;
    expect(payload.side).toBe("zap-in");
    const legs = payload.legs as Array<{ inputMint: string; outputMint: string; inAmount: string; allocationBps: number; expectedOutAmount: string; routeLabels: string[] }>;
    expect(legs.map((l) => l.inAmount)).toEqual(["50000000", "30000000", "20000000"]);
    expect(legs.map((l) => l.outputMint)).toEqual([MINT_A, MINT_B, MINT_C]);
    expect(legs[0].inputMint).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC
    expect(legs[0].expectedOutAmount).toBe("49000000");
    expect(legs[0].routeLabels).toEqual(["Orca", "Phoenix"]);
    expect(payload.provenance).toEqual({ source: "jupiter-quote", asOf: NOW.toISOString(), slippageBps: 50 });
    expect(payload.warning).toBe(ZAP_WARNING);
    expect(payload.mintAccountsNote).toBe(MINT_ACCOUNTS_NOTE);
    expect(MINT_ACCOUNTS_NOTE).toContain("WhitelistedMint");
    expect(MINT_ACCOUNTS_NOTE).toContain("3n");
    // every leg hit the Jupiter Quote API with the right params
    expect(jup.urls.length).toBe(3);
    expect(jup.urls[0]).toContain("quote-api.jup.ag/v6/quote");
    expect(jup.urls[0]).toContain(`outputMint=${MINT_A}`);
    expect(jup.urls[0]).toContain("amount=50000000");
    expect(jup.urls[0]).toContain("slippageBps=50");
    // expectedShares estimate (raw base units): 100e6 raw × 1e9 supply / 1e6 NAV = 1e11
    expect(payload.expectedShares).toBe("100000000000");
  });

  it("caches the quote for 30s (spec §7 quote:zap-in:{basket}:{amount}) and marks cached hits", async () => {
    const jup = mockJupiterFetch(["1", "1", "1"]);
    const cache = new InMemoryCache();
    const ctx = { db: dbForZapIn(), cache, fetchImpl: jup.fetchImpl, now: () => NOW };
    await handleZapIn(ctx, { basket: BASKET, amountUSDC: "100", slippageBps: 50 });
    expect(jup.urls.length).toBe(3);
    const second = await handleZapIn(ctx, { basket: BASKET, amountUSDC: "100", slippageBps: 50 });
    expect(jup.urls.length).toBe(3); // no new fetches
    const payload = second.payload as { provenance: { cached?: boolean } };
    expect(payload.provenance.cached).toBe(true);
  });

  it("any Jupiter leg failure ⇒ 503 QUOTE_UNAVAILABLE — never a partial or fabricated quote", async () => {
    const jup = mockJupiterFetch(["1", "1", "1"], true);
    const out = await handleZapIn({ db: dbForZapIn(), fetchImpl: jup.fetchImpl }, { basket: BASKET, amountUSDC: 100 });
    expect(out.status).toBe(503);
    const payload = out.payload as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("QUOTE_UNAVAILABLE");
    expect(payload.error.message).toContain("connection refused");
  });

  it("validates input: unknown basket 404 NOT_INDEXED, bad amount/slippage 400, no DB 503", async () => {
    const missingDb = fakeDb([{ match: "FROM baskets WHERE pubkey", rows: [] }]);
    expect((await handleZapIn({ db: missingDb }, { basket: BASKET, amountUSDC: 10 })).status).toBe(404);
    expect((await handleZapIn({ db: fakeDb() }, { basket: BASKET, amountUSDC: 0 }).then((o) => o.status))).toBe(400);
    expect((await handleZapIn({ db: fakeDb() }, { basket: BASKET, amountUSDC: 10, slippageBps: 20000 })).status).toBe(400);
    expect((await handleZapIn({ db: null }, { basket: BASKET, amountUSDC: 10 })).status).toBe(503);
    expect((await handleZapIn({ db: fakeDb() }, {})).status).toBe(400);
  });
});

describe("quotes — POST /quotes/zap-out (mocked Jupiter)", () => {
  function dbForZapOut() {
    return fakeDb([
      { match: "FROM baskets WHERE pubkey", rows: [BASKET_ROW] },
      { match: "FROM nav_snapshots WHERE basket", rows: [{ nav: "1000000", supply: "10000000" }] },
      { match: "FROM vault_holdings", rows: [
        { mint: MINT_A, raw_amount: "550000000" },
        { mint: MINT_B, raw_amount: "300000000" },
        { mint: MINT_C, raw_amount: "200000000" },
      ] },
    ]);
  }

  it("returns pro-rata entitlement legs (§5 numbers) plus the redeem breakdown", async () => {
    const jup = mockJupiterFetch(["54000000", "29200000", "19500000"]);
    const out = await handleZapOut({ db: dbForZapOut(), fetchImpl: jup.fetchImpl, now: () => NOW }, {
      basket: BASKET,
      shares: "1000000",
      slippageBps: 50,
    });
    expect(out.status).toBe(200);
    const payload = out.payload as Record<string, unknown>;
    expect(payload.side).toBe("zap-out");
    const redeem = payload.redeem as { shares: string; exitFeeShares: string; burnShares: string; outs: string[] };
    expect(redeem.exitFeeShares).toBe("5000"); // floor(1M × 50 / 10000)
    expect(redeem.burnShares).toBe("995000");
    expect(redeem.outs).toEqual(["54725000", "29850000", "19900000"]);
    const legs = payload.legs as Array<{ inputMint: string; outputMint: string; inAmount: string }>;
    expect(legs.map((l) => l.inAmount)).toEqual(["54725000", "29850000", "19900000"]);
    expect(legs[0].inputMint).toBe(MINT_A);
    expect(legs[0].outputMint).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(payload.provenance).toMatchObject({ source: "jupiter-quote", slippageBps: 50 });
    expect(payload.warning).toBe(ZAP_WARNING);
  });

  it("rejects shares exceeding indexed supply with INSUFFICIENT_BALANCE and missing holdings with NOT_INDEXED", async () => {
    const tooMany = await handleZapOut({ db: dbForZapOut() }, { basket: BASKET, shares: "20000000" });
    expect(tooMany.status).toBe(400);
    expect((tooMany.payload as { error: { code: string } }).error.code).toBe("INSUFFICIENT_BALANCE");

    const partialDb = fakeDb([
      { match: "FROM baskets WHERE pubkey", rows: [BASKET_ROW] },
      { match: "FROM nav_snapshots WHERE basket", rows: [{ nav: "1", supply: "10000000" }] },
      { match: "FROM vault_holdings", rows: [{ mint: MINT_A, raw_amount: "100" }] },
    ]);
    const missing = await handleZapOut({ db: partialDb }, { basket: BASKET, shares: "1" });
    expect(missing.status).toBe(404);
    expect((missing.payload as { error: { code: string } }).error.code).toBe("NOT_INDEXED");
  });

  it("no supply snapshot ⇒ NOT_INDEXED; bad shares ⇒ 400", async () => {
    const noSupply = fakeDb([
      { match: "FROM baskets WHERE pubkey", rows: [BASKET_ROW] },
      { match: "FROM nav_snapshots WHERE basket", rows: [] },
    ]);
    expect((await handleZapOut({ db: noSupply }, { basket: BASKET, shares: "1" })).status).toBe(404);
    expect((await handleZapOut({ db: dbForZapOut() }, { basket: BASKET, shares: "-3" })).status).toBe(400);
    expect((await handleZapOut({ db: dbForZapOut() }, { basket: BASKET })).status).toBe(400);
  });
});

// ============================================================================
// 4. Fee crank — builds UNSIGNED transactions, never signs
// ============================================================================

describe("feeCrank — hourly accrue_management_fee builder", () => {
  const ELIGIBLE_ROW = {
    pubkey: BASKET,
    share_mint: SHARE_MINT,
    creator: CREATOR,
    treasury: TREASURY,
    management_fee_bps: 200,
    elapsed_sec: 3600,
    supply: "10000000000",
  };

  it("buildFeeTx returns an unsigned versioned tx + 11-account descriptor (AccrueFee layout)", async () => {
    const crank = new FeeCrank({
      db: fakeDb(),
      rpc: { getLatestBlockhash: async () => ({ blockhash: FAKE_BLOCKHASH.toBase58(), lastValidBlockHeight: 123 }) },
      keeperPubkey: KEEPER,
    });
    const built: BuiltFeeTx = await crank.buildFeeTx(ELIGIBLE_ROW);

    expect(built.transactionBase64).not.toBeNull();
    expect(built.signatures).toBe(0);
    expect(built.blockhash).toBe(FAKE_BLOCKHASH.toBase58());

    // decode: the reserved signer slot is all-zero — NO signature was applied;
    // the backend never signs (AGENTS §2 #5).
    const vtx = VersionedTransaction.deserialize(Buffer.from(built.transactionBase64!, "base64"));
    expect(vtx.signatures.length).toBe(1); // feePayer slot reserved by the wire format
    expect(vtx.signatures[0].every((b) => b === 0)).toBe(true); // zeroed = unsigned
    expect(vtx.message.compiledInstructions.length).toBe(1);
    // 11 ix accounts + the basket program id itself
    expect(vtx.message.staticAccountKeys.length).toBe(12);
    const keySet = new Set(vtx.message.staticAccountKeys.map((k) => k.toBase58()));
    expect(keySet.has(BASKET)).toBe(true);
    expect(keySet.has(SHARE_MINT)).toBe(true);
    expect(keySet.has(KEEPER)).toBe(true); // payer/feePayer
    expect(keySet.has(
      PublicKey.findProgramAddressSync([Buffer.from("basket"), new PublicKey(BASKET).toBuffer()], new PublicKey(BASKET_PROGRAM_ID))[0].toBase58(),
    )).toBe(true); // vault_authority PDA
    expect(keySet.has(TOKEN_2022_PROGRAM_ID.toBase58())).toBe(true); // token program
    expect(keySet.has(BASKET_PROGRAM_ID)).toBe(true);
    // descriptor carries the full named AccrueFee layout in program order
    expect(built.instructions[0].name).toBe("accrue_management_fee");
    expect(built.instructions[0].accounts.map((a) => a.name)).toEqual([
      "basket", "share_mint", "payer", "vault_authority", "creator", "creator_share_ata",
      "treasury", "treasury_share_ata", "token_program", "associated_token_program", "system_program",
    ]);
    expect(built.instructions[0].accounts[2]).toMatchObject({ name: "payer", signer: true, writable: true });
    expect(built.instructions[0].accounts[3]).toMatchObject({ name: "vault_authority", signer: false, writable: false });
    expect(built.note).toContain("never");
    // fee estimate: 1e10 × 200 × 3600 / (1e4 × 31536000) = 22831
    expect(built.estimatedFeeShares).toBe("22831");
  });

  it("without RPC the crank still returns instruction descriptors but transactionBase64 is null", async () => {
    const crank = new FeeCrank({ db: fakeDb() });
    const built = await crank.buildFeeTx(ELIGIBLE_ROW);
    expect(built.transactionBase64).toBeNull();
    expect(built.blockhash).toBeNull();
    expect(built.instructions[0].accounts.length).toBe(11);
  });

  it("runOnce builds txs for every eligible basket and logs that the keeper must sign", async () => {
    const logs: string[] = [];
    const db = fakeDb([{ match: "make_interval", rows: [ELIGIBLE_ROW, { ...ELIGIBLE_ROW, pubkey: new PublicKey(Buffer.alloc(32, 21)).toBase58() }] }]);
    const crank = new FeeCrank({ db, rpc: { getLatestBlockhash: async () => ({ blockhash: FAKE_BLOCKHASH.toBase58(), lastValidBlockHeight: 1 }) }, log: (m) => logs.push(m) });
    const run = await crank.runOnce();
    expect(run.eligible).toBe(2);
    expect(run.built.length).toBe(2);
    expect(run.failed.length).toBe(0);
    expect(logs.join("\n")).toContain("BUILT unsigned");
    expect(logs.join("\n")).toContain("backend never signs");
  });

  it("degrades to reason 'no-db' without Postgres and never throws", async () => {
    const run = await new FeeCrank({ db: null }).runOnce();
    expect(run.reason).toBe("no-db");
    expect(run.built.length).toBe(0);
  });

  it("estimateManagementFeeShares matches spec §6 (10M supply, 200bps, 30d → 16438)", () => {
    expect(estimateManagementFeeShares("10000000", 200, 30 * 24 * 3600)).toBe("16438");
    expect(estimateManagementFeeShares("0", 200, 30 * 24 * 3600)).toBe("0");
  });

  it("start/stop run on an hourly cadence and are idempotent", () => {
    const crank = new FeeCrank({ db: null });
    crank.start();
    expect(crank.isRunning).toBe(true);
    crank.start(); // idempotent
    expect(crank.isRunning).toBe(true);
    crank.stop();
    expect(crank.isRunning).toBe(false);
  });
});

// ============================================================================
// 5. API server — DB-backed routes with explicit source/asOf markers
// ============================================================================

describe("server — GET routes (fake PgLike)", () => {
  it("GET /baskets reads basket_rankings with source:'onchain-indexed' + asOf per row", async () => {
    const db = fakeDb([{
      match: "FROM basket_rankings",
      rows: [{
        pubkey: BASKET, creator: "Creator1111111111111111111111111111111111111", share_mint: "S",
        nav: "155000", supply: "1000000", share_price: "0.155", return_30d: "0.10",
        mint_count: 4, refreshed_at: "2026-09-01T10:00:00Z", nav_as_of: "2026-09-01T11:59:00Z",
        return_24h: "0.02", holders: 3,
      }],
    }]);
    const out = await listBaskets(db, { sort: "aum" });
    expect(out.status).toBe(200);
    const payload = out.payload as { data: Array<Record<string, unknown>>; count: number; source: string };
    expect(payload.source).toBe("onchain-indexed");
    expect(payload.data[0].source).toBe("onchain-indexed");
    expect(payload.data[0].asOf).toBe("2026-09-01T11:59:00Z");
    expect(payload.data[0].nav).toBe("155000"); // decimal string — integer-safe
    expect(payload.data[0].holders).toBe(3);
    const call = db.calls[0];
    expect(call.sql).toContain("FROM basket_rankings");
    expect(call.sql).toContain("ORDER BY r.nav DESC");
  });

  it("GET /baskets?sort=return_24h orders by the 24h window; unknown sort ⇒ 400 INVALID_SORT", async () => {
    const db = fakeDb();
    await listBaskets(db, { sort: "return_24h" });
    expect(db.calls[0].sql).toContain("h24.nav");

    const bad = await listBaskets(fakeDb(), { sort: "nonsense" });
    expect(bad.status).toBe(400);
    expect((bad.payload as { error: { code: string; supported: string[] } }).error.code).toBe("INVALID_SORT");
  });

  it("GET /baskets/:pubkey unknown ⇒ 404 NOT_INDEXED; known ⇒ detail + NAV + drift", async () => {
    const missing = await basketDetail(fakeDb(), BASKET);
    expect(missing.status).toBe(404);
    expect((missing.payload as { error: { code: string } }).error.code).toBe("NOT_INDEXED");

    const db = fakeDb([
      { match: "FROM baskets WHERE pubkey", rows: [{ ...BASKET_ROW, nonce: "0", created_at: "2026-08-01T00:00:00Z", metadata_hash: "0x00", metadata_json: null, num_constituents: 3, entry_fee_bps: 100, exit_fee_bps: 50, management_fee_bps: 200, last_fee_accrual_ts: "2026-08-01T00:00:00Z", factory: "F", creator: "C", treasury: "T" }] },
      { match: "FROM nav_snapshots WHERE basket", rows: [{ nav: "155000", supply: "1000000", share_price: "0.155", price_source: {}, ts: "2026-09-01T11:59:00Z" }] },
      { match: "FROM vault_holdings WHERE basket", rows: [
        { mint: MINT_A, raw_amount: "500", multiplier: "1", scaled_amount: "500", decimals: 6, updated_at: "2026-09-01T11:59:00Z" },
        { mint: MINT_B, raw_amount: "300", multiplier: "1", scaled_amount: "300", decimals: 6, updated_at: "2026-09-01T11:59:00Z" },
      ] },
    ]);
    const out = await basketDetail(db, BASKET);
    expect(out.status).toBe(200);
    const data = (out.payload as { data: Record<string, unknown> }).data;
    expect(data.source).toBe("onchain-indexed");
    const drift = data.drift as { actualWeightsBps: number[]; driftBps: number[] };
    expect(drift.actualWeightsBps).toEqual([6250, 3750, 0]); // 500/800, 300/800, 3rd holding not indexed yet
    expect(drift.driftBps).toEqual([1250, 750, -2000]); // vs the 3-item 5000/3000/2000 target
    expect((data.nav as Record<string, unknown>).value).toBe("155000");
  });

  it("GET /baskets/:pubkey/holdings returns raw+scaled strings and numeric multiplier; 404 when not indexed", async () => {
    const missing = await basketHoldings(fakeDb(), BASKET);
    expect(missing.status).toBe(404);
    expect((missing.payload as { error: { code: string } }).error.code).toBe("NOT_INDEXED");

    const db = fakeDb([
      { match: "FROM baskets WHERE pubkey", rows: [{ 1: 1 }] },
      { match: "FROM vault_holdings WHERE basket", rows: [{ mint: MINT_A, raw_amount: "550000000", multiplier: "1000000", scaled_amount: "550000000000000", decimals: 6, updated_at: "2026-09-01T11:59:00Z" }] },
    ]);
    const out = await basketHoldings(db, BASKET);
    const payload = out.payload as { data: Array<Record<string, unknown>> };
    expect(payload.data[0].raw_amount).toBe("550000000");
    expect(payload.data[0].scaled_amount).toBe("550000000000000");
    expect(payload.data[0].multiplier).toBe(1000000); // f64 display factor — the one Number
    expect(payload.data[0].source).toBe("onchain-indexed");
  });

  it("GET /baskets/:pubkey/nav/history validates interval and returns rows", async () => {
    const missing = await navHistory(fakeDb(), BASKET, {});
    expect(missing.status).toBe(404);
    expect((missing.payload as { error: { code: string } }).error.code).toBe("NOT_INDEXED");

    const db = fakeDb([
      { match: "FROM baskets WHERE pubkey", rows: [{ 1: 1 }] },
      { match: "FROM nav_snapshots", rows: [{ ts: "2026-09-01T11:00:00Z", nav: "150000", supply: "1000000", share_price: "0.15", price_source: {} }] },
    ]);
    const raw = await navHistory(db, BASKET, { from: "2026-09-01T00:00:00Z" });
    expect(raw.status).toBe(200);
    expect((raw.payload as { interval: string }).interval).toBe("raw");

    const bad = await navHistory(db, BASKET, { interval: "2h" });
    expect(bad.status).toBe(400);
    expect((bad.payload as { error: { code: string } }).error.code).toBe("INVALID_INTERVAL");

    const badFrom = await navHistory(db, BASKET, { from: "not-a-date" });
    expect(badFrom.status).toBe(400);
    expect((badFrom.payload as { error: { code: string } }).error.code).toBe("INVALID_TIME_RANGE");

    const binned = await navHistory(db, BASKET, { interval: "1h" });
    expect(binned.status).toBe(200);
    expect(db.calls.at(-1)!.sql).toContain("date_bin");
  });

  it("GET /baskets/:pubkey/performance computes windows from snapshot baselines; 404 without snapshots", async () => {
    const missing = await basketPerformance(fakeDb(), BASKET);
    expect(missing.status).toBe(404);
    expect((missing.payload as { error: { code: string } }).error.code).toBe("NOT_INDEXED");

    const db = fakeDb([
      { match: "FROM baskets WHERE pubkey", rows: [{ 1: 1 }] },
      { match: "SELECT", rows: [{
        latest_nav: "120", latest_ts: "2026-09-01T12:00:00Z",
        b24: "100", b24_ts: "2026-08-31T12:00:00Z",
        b7d: "80", b7d_ts: "2026-08-25T12:00:00Z",
        b30d: null, b30d_ts: null, b90d: null, b90d_ts: null,
        b_inception: "60", b_inception_ts: "2026-01-01T00:00:00Z",
      }] },
    ]);
    const out = await basketPerformance(db, BASKET);
    expect(out.status).toBe(200);
    const data = (out.payload as { data: { windows: Record<string, { pct: string | null }> } }).data;
    expect(data.windows["24h"]?.pct).toBe("20");
    expect(data.windows["7d"]?.pct).toBe("50");
    expect(data.windows["30d"]?.pct).toBeNull();
    expect(data.windows["inception"]?.pct).toBe("100");
  });

  it("GET /whitelist returns mints with numeric multiplier; /health reports indexer lag + holdings staleness", async () => {
    const wl = await listWhitelist(fakeDb([{ match: "FROM whitelisted_mints", rows: [{ mint: MINT_A, decimals: 6, status: "Active", price_source: "jupiter:TSLAx", multiplier: "1000000", updated_at: "2026-09-01T11:00:00Z" }] }]));
    const wlPayload = wl.payload as { data: Array<Record<string, unknown>>; source: string };
    expect(wlPayload.source).toBe("onchain-indexed");
    expect(wlPayload.data[0].multiplier).toBe(1000000);

    const db = fakeDb([{
      match: "FROM baskets)",
      rows: [{ basket_count: "2", last_slot: "1234", last_event_ts: new Date(NOW.getTime() - 30_000), holdings_rows: "6", holdings_updated_at: new Date(NOW.getTime() - 45_000) }],
    }]);
    const health = await healthReport(db, () => ({
      db: { connected: true, schemaApplied: true },
      indexer: { enabled: true, running: true },
      navEngine: { enabled: true, running: true },
      feeCrank: { enabled: true, running: false },
    }), () => NOW);
    const payload = health.payload as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.version).toBe(API_VERSION);
    const dbh = payload.db as { basketCount: number; lastSlot: string | null; indexerLagSeconds: number; holdings: { staleSeconds: number } };
    expect(dbh.basketCount).toBe(2);
    expect(dbh.lastSlot).toBe("1234"); // BIGINT stays a decimal string (integer-safe)
    expect(dbh.indexerLagSeconds).toBe(30);
    expect(dbh.holdings.staleSeconds).toBe(45);
  });

  it("DB-less mode: DB routes answer 503 DB_UNAVAILABLE, /health stays ok with subsystems off", async () => {
    const handler = createHandler({ db: null });

    const { res, state } = makeRes();
    await handler(makeReq("GET", "/api/v1/baskets"), res);
    expect(state.statusCode).toBe(503);
    expect(JSON.parse(state.body).error.code).toBe("DB_UNAVAILABLE");

    const { res: res2, state: state2 } = makeRes();
    await handler(makeReq("GET", "/api/v1/health"), res2);
    expect(state2.statusCode).toBe(200);
    const health = JSON.parse(state2.body);
    expect(health.ok).toBe(true);
    expect(health.db.connected).toBe(false);
    expect(health.subsystems.indexer.enabled).toBe(false);

    const { res: res3, state: state3 } = makeRes();
    await handler(makeReq("GET", "/api/v1/nope"), res3);
    expect(state3.statusCode).toBe(404);
    expect(JSON.parse(state3.body).error.code).toBe("NOT_FOUND");

    const { res: res4, state: state4 } = makeRes();
    await handler(makeReq("POST", "/api/v1/quotes/zap-in", { basket: BASKET, amountUSDC: 1 }), res4);
    expect(state4.statusCode).toBe(503);
    expect(JSON.parse(state4.body).error.code).toBe("DB_UNAVAILABLE");
  });

  it("CORS headers are present on every response and the V0.1 provider routes still work", async () => {
    const handler = createHandler({ db: null });
    const { res, state } = makeRes();
    await handler(makeReq("GET", "/api/v1/providers"), res);
    expect(state.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(JSON.parse(state.body).data.length).toBeGreaterThan(0);
  });

  it("POST /quotes/zap-in end-to-end through the handler with a fake DB + mocked Jupiter", async () => {
    const jup = mockJupiterFetch(["1000000"]);
    const handler = createHandler({
      db: fakeDb([
        { match: "FROM baskets WHERE pubkey", rows: [BASKET_ROW] },
        { match: "FROM nav_snapshots WHERE basket", rows: [{ nav: "1000000", supply: "1000000000" }] },
      ]),
      fetchImpl: jup.fetchImpl,
      now: () => NOW,
    });
    const { res, state } = makeRes();
    await handler(makeReq("POST", "/api/v1/quotes/zap-in", { basket: BASKET, amountUSDC: 2, slippageBps: 50 }), res);
    expect(state.statusCode).toBe(200);
    const payload = JSON.parse(state.body) as { legs: unknown[]; provenance: { source: string }; warning: string };
    expect(payload.legs.length).toBe(3);
    expect(payload.provenance.source).toBe("jupiter-quote");
    expect(payload.warning).toContain("sequential");

    // malformed JSON body ⇒ 400 INVALID_JSON
    const bad = makeReq("POST", "/api/v1/quotes/zap-in");
    (bad as unknown as { on: (event: string, cb: (chunk?: Buffer) => void) => void }).on = (event, cb) => {
      if (event === "data") cb(Buffer.from("{not json"));
      if (event === "end") cb();
    };
    const { res: res2, state: state2 } = makeRes();
    await handler(bad, res2);
    expect(state2.statusCode).toBe(400);
    expect(JSON.parse(state2.body).error.code).toBe("INVALID_JSON");
  });
});

// --- http mocks for handler-level tests --------------------------------------

function makeReq(method: string, url: string, body?: unknown): http.IncomingMessage {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const req = {
    method,
    url,
    headers: { host: "localhost:3001" },
    on: (event: string, cb: (chunk?: Buffer) => void) => {
      if (event === "data" && payload) cb(Buffer.from(payload));
      if (event === "end") cb();
    },
  };
  return req as unknown as http.IncomingMessage;
}

interface ResState {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

function makeRes(): { res: http.ServerResponse; state: ResState } {
  const state: ResState = { statusCode: 200, body: "", headers: {} };
  const res = {
    setHeader: (k: string, v: string) => { state.headers[k] = v; },
    get statusCode() { return state.statusCode; },
    set statusCode(v: number) { state.statusCode = v; },
    end: (payload?: string | Buffer) => { state.body = payload ? payload.toString() : ""; },
  };
  return { res: res as unknown as http.ServerResponse, state };
}
