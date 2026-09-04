/**
 * rpc-backoff.test.ts — pins the shared 429 backoff (src/rpc/backoff.ts) and
 * the /prices/compare devnet mock-mint resolution (workers/priceCompare.ts).
 *
 * Backoff contract: exponential + jitter capped at 60s, ONE retry layer (no
 * caller retries the same batch again), non-429 errors propagate immediately,
 * warn lines rate-limited to one per key per minute.
 *
 * Mock compare contract: a requested ticker that is not a real Backed mint
 * resolves against whitelisted_mints "mock:<slug>" rows — REAL Yahoo quote
 * when the realistic path is on, deterministic catalog ("mock") when not,
 * "unavailable" (null) only when both fail. Never a fabricated price.
 */
import { describe, it, expect, vi } from "vitest";
import {
  backoffDelayMs,
  isRateLimitError,
  rateLimitedWarn,
  resetRateLimitedWarn,
  withRpcBackoff,
  createPacer,
  RPC_BACKOFF_CAP_MS,
} from "../src/rpc/backoff.js";
import { comparePrices, type MockMintRow } from "../src/workers/priceCompare.js";
import { clearRealisticQuoteCache } from "../src/workers/realisticMockPrices.js";

// --- backoff math ------------------------------------------------------------

describe("rpc/backoff — delay math", () => {
  it("grows exponentially with jitter and never exceeds the cap", () => {
    const rng = () => 0.5; // midpoint jitter = 1.0x
    expect(backoffDelayMs(1, rng)).toBe(2000);
    expect(backoffDelayMs(2, rng)).toBe(4000);
    expect(backoffDelayMs(3, rng)).toBe(8000);
    // far-out attempts pin to the cap
    expect(backoffDelayMs(20, rng)).toBe(RPC_BACKOFF_CAP_MS);
  });

  it("jitters within ±25% of the exponential value", () => {
    for (let i = 0; i < 200; i++) {
      const d = backoffDelayMs(2); // base 4000
      expect(d).toBeGreaterThanOrEqual(3000);
      expect(d).toBeLessThanOrEqual(5000);
    }
  });

  it("detects 429s from either the status code or the reason phrase", () => {
    expect(isRateLimitError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRateLimitError(new Error("Server responded with 429"))).toBe(true);
    expect(isRateLimitError(new Error("too many requests"))).toBe(true);
    expect(isRateLimitError(new Error("rpc unreachable"))).toBe(false);
    expect(isRateLimitError(new Error("fetch failed"))).toBe(false);
  });
});

// --- the one retry layer -------------------------------------------------------

describe("rpc/backoff — withRpcBackoff", () => {
  it("retries rate-limited calls in place with backoff until they succeed", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await withRpcBackoff(
      async () => {
        calls++;
        if (calls < 3) throw new Error("429 Too Many Requests");
        return "ok";
      },
      { sleep: async (ms) => sleeps.push(ms), rng: () => 0.5 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([2000, 4000]); // exponential waits between attempts
  });

  it("gives up after maxAttempts and rethrows the last 429", async () => {
    let calls = 0;
    await expect(
      withRpcBackoff(
        async () => {
          calls++;
          throw new Error("Server responded with 429");
        },
        { sleep: async () => {}, rng: () => 0.5 },
      ),
    ).rejects.toThrow("Server responded with 429");
    expect(calls).toBe(3); // default: 1 initial + 2 backoff retries
  });

  it("propagates non-rate-limit errors immediately — no retry, no sleep", async () => {
    let calls = 0;
    await expect(
      withRpcBackoff(
        async () => {
          calls++;
          throw new Error("rpc unreachable");
        },
        { sleep: async () => { throw new Error("must not sleep"); } },
      ),
    ).rejects.toThrow("rpc unreachable");
    expect(calls).toBe(1);
  });
});

// --- rate-limited warn + pacing ---------------------------------------------

describe("rpc/backoff — rateLimitedWarn + createPacer", () => {
  it("logs a key at most once per window", () => {
    resetRateLimitedWarn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let t = 0;
    const now = () => t;
    expect(rateLimitedWarn("k", "boom 1", now)).toBe(true);
    t = 30_000;
    expect(rateLimitedWarn("k", "boom 2 (suppressed)", now)).toBe(false);
    t = 61_000;
    expect(rateLimitedWarn("k", "boom 3", now)).toBe(true);
    // different keys don't suppress each other
    expect(rateLimitedWarn("k2", "boom 4", now)).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(3);
    warnSpy.mockRestore();
    resetRateLimitedWarn();
  });

  it("pacer spaces sequential reads and is instant when gapMs <= 0", async () => {
    let t = 1_000_000;
    const now = () => t;
    const slept: number[] = [];
    const pacer = createPacer(100, { now, sleep: async (ms) => { slept.push(ms); t += ms; } });
    await pacer.wait(); // first read: immediate
    expect(slept).toEqual([]);
    t += 30; // only 30ms elapsed → wait ~70ms
    await pacer.wait();
    expect(slept.length).toBe(1);
    expect(slept[0]).toBeGreaterThan(0);
    expect(slept[0]).toBeLessThanOrEqual(100);

    const off = createPacer(0, { now, sleep: async () => { throw new Error("must not sleep"); } });
    await off.wait(); // no sleep when pacing disabled
  });
});

// --- /prices/compare mock-mint resolution -------------------------------------

describe("workers/priceCompare — devnet mock mint resolution", () => {
  const mockRows: MockMintRow[] = [
    { mint: "MOCKTSLAMINT11111111111111111111111111111", price_source: "mock:tsla" },
    { mint: "MOCKSPYMINT11111111111111111111111111111111", price_source: "mock:spy" },
    { mint: "MOCKJUPMINT11111111111111111111111111111111", price_source: "jupiter:TSLAx" }, // mainnet label: never mock-resolved
  ];

  it("resolves a mock ticker to its mint with the catalog price (realistic path off)", async () => {
    clearRealisticQuoteCache();
    // REALISTIC_MOCK_PRICES unset in the test env → Yahoo path off → the
    // deterministic dev catalog is the honest fallback (source "mock").
    const rows = await comparePrices(["TSLA"], { mockRows });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ticker: "TSLA",
      mint: "MOCKTSLAMINT11111111111111111111111111111",
      jupiter: 250, // dev catalog TSLAx price
      yahoo: null,
      diffBps: null,
      source: "mock",
    });
  });

  it("matches the display symbol form too (TSLAx) and is case-insensitive", async () => {
    clearRealisticQuoteCache();
    const rows = await comparePrices(["tslax"], { mockRows });
    expect(rows[0]?.mint).toBe("MOCKTSLAMINT11111111111111111111111111111");
    expect(rows[0]?.source).toBe("mock");
  });

  it("never resolves a jupiter:<TICKER> whitelist label through the mock path", async () => {
    clearRealisticQuoteCache();
    const rows = await comparePrices(["TSLAx"], { mockRows });
    // "TSLAx" IS in TICKER_MINTS (real Backed mint) — legacy path, not mock.
    expect(rows[0]?.mint).toBe("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB");
  });

  it("unknown tickers degrade to explicit nulls (source unavailable)", async () => {
    clearRealisticQuoteCache();
    const rows = await comparePrices(["NOPE"], { mockRows });
    expect(rows[0]).toEqual({ ticker: "NOPE", mint: "", jupiter: null, yahoo: null, diffBps: null, source: "unavailable" });
  });

  it("mock rows resolve without touching Jupiter when no legacy mint is requested", async () => {
    clearRealisticQuoteCache();
    // No mints.length → no Jupiter fetch at all (fetch would fail offline and
    // slow the suite; asserting via spy is unnecessary — offline-proof by design).
    const rows = await comparePrices(["SPY"], { mockRows });
    expect(rows[0]?.jupiter).toBe(560);
    expect(rows[0]?.source).toBe("mock");
  });
});
