/**
 * priceFetch.ts — Jupiter Price API v6 fetcher (NAV only, never gates redeem).
 *
 * Wave B upgrades over the V0 stub:
 *   * Fully typed Jupiter v6 response (no `any`) with defensive narrowing.
 *   * 30-second response cache keyed by the requested mint set.
 *   * Every price is a `PricePoint` carrying an explicit `source` marker
 *     ("jupiter" | "mock") and an `asOf` ISO timestamp.
 *   * Mock fallback exists ONLY behind the explicit env PRICE_FALLBACK=mock
 *     (or an opts override); without it a Jupiter outage degrades to an
 *     empty result (price 0 via the legacy `fetchPrices` wrapper), never to
 *     fabricated prices.
 *
 * Back-compat: `fetchPrices` still returns the legacy `Record<string, number>`
 * map consumed by workers/priceCompare.ts, and `mockPrices` keeps its exact
 * signature for existing tests.
 */

/**
 * Quote provenance labels:
 *   "jupiter" — live Jupiter Price API v6 (mainnet mints)
 *   "mock"    — deterministic dev catalog (workers/mockPriceFill.ts fallback)
 *   "yahoo"   — real equity market spot quote via the guarded Yahoo chart API
 *               (workers/realisticMockPrices.ts, REALISTIC_MOCK_PRICES)
 */
export type PriceSource = "jupiter" | "mock" | "yahoo";

export interface PricePoint {
  mint: string;
  price: number;
  source: PriceSource;
  /** ISO 8601 timestamp of when the price was obtained. */
  asOf: string;
}

export type PriceQuoteMap = Record<string, PricePoint>;

/** Legacy numeric map (USD) — kept for existing callers. */
export interface PriceMap { [mint: string]: number }

export const PRICE_CACHE_TTL_MS = 30_000;
const JUPITER_PRICE_URL = "https://price.jup.ag/v6/price";
const JUPITER_TIMEOUT_MS = 10_000;

// --- Jupiter v6 wire types (typed, no `any`) --------------------------------

interface JupiterPriceV6Entry {
  id: string;
  type?: string;
  /** v6 returns the price as a decimal STRING to avoid float truncation. */
  price: string | number;
  extraInfo?: Record<string, unknown>;
}

interface JupiterPriceV6Response {
  data?: Record<string, JupiterPriceV6Entry | undefined>;
  timeTaken?: number;
}

function isJupiterResponse(value: unknown): value is JupiterPriceV6Response {
  if (typeof value !== "object" || value === null) return false;
  const data = (value as { data?: unknown }).data;
  return data === undefined || (typeof data === "object" && data !== null);
}

function parsePriceValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseJupiterEntry(mint: string, entry: unknown, asOf: string): PricePoint | null {
  if (typeof entry !== "object" || entry === null) return null;
  const price = parsePriceValue((entry as { price?: unknown }).price);
  if (price === null) return null;
  const id = (entry as { id?: unknown }).id;
  return {
    mint: typeof id === "string" && id.length > 0 ? id : mint,
    price,
    source: "jupiter",
    asOf,
  };
}

// --- 30s cache ---------------------------------------------------------------

interface CacheEntry {
  points: PriceQuoteMap;
  fetchedAt: number;
}

const priceCache = new Map<string, CacheEntry>();

/** Test/maintenance hook: drop all cached price responses. */
export function clearPriceCache(): void {
  priceCache.clear();
}

function cacheKey(mints: string[]): string {
  return [...mints].sort().join(",");
}

// --- public API --------------------------------------------------------------

export interface FetchPricesOptions {
  /** Injectable clock (ISO timestamps + TTL math). Defaults to `new Date()`. */
  now?: () => Date;
  /** Injectable fetch (tests / offline runs). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override env PRICE_FALLBACK: "mock" enables mock fallback, "none" disables. */
  fallback?: "mock" | "none";
  /** Skip the cache read (still refreshes it). */
  forceRefresh?: boolean;
}

function fallbackMode(opts: FetchPricesOptions): "mock" | "none" {
  if (opts.fallback) return opts.fallback;
  return process.env.PRICE_FALLBACK === "mock" ? "mock" : "none";
}

function mockPoint(mint: string, price: number, asOf: string): PricePoint {
  return { mint, price, source: "mock", asOf };
}

/**
 * Prices for a set of mints as typed PricePoints.
 * Cache: identical mint sets within PRICE_CACHE_TTL_MS (30s) are served from
 * the in-memory cache without hitting Jupiter.
 */
export async function fetchPriceQuotes(
  mints: string[],
  opts: FetchPricesOptions = {},
): Promise<PriceQuoteMap> {
  const unique = [...new Set(mints)].filter((m) => typeof m === "string" && m.length > 0);
  if (unique.length === 0) return {};

  const now = opts.now ?? (() => new Date());
  const nowMs = now().getTime();
  const key = cacheKey(unique);
  if (!opts.forceRefresh) {
    const hit = priceCache.get(key);
    if (hit && nowMs - hit.fetchedAt < PRICE_CACHE_TTL_MS) return { ...hit.points };
  }

  const asOf = now().toISOString();
  let points: PriceQuoteMap = {};
  try {
    const doFetch = opts.fetchImpl ?? fetch;
    const res = await doFetch(`${JUPITER_PRICE_URL}?ids=${encodeURIComponent(unique.join(","))}`, {
      signal: AbortSignal.timeout(JUPITER_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`price fetch ${res.status}`);
    const json: unknown = await res.json();
    if (!isJupiterResponse(json)) throw new Error("price fetch: unexpected response shape");
    for (const mint of unique) {
      const entry = json.data?.[mint];
      const point = entry ? parseJupiterEntry(mint, entry, asOf) : null;
      if (point) points[point.mint] = point;
    }
  } catch (err) {
    console.warn("[priceFetch] Jupiter fetch failed:", err instanceof Error ? err.message : err);
    points = {};
  }

  const mode = fallbackMode(opts);
  if (mode === "mock") {
    // Explicit opt-in (PRICE_FALLBACK=mock): label every fabricated price as
    // source "mock". Price 0 signals "no real price available" downstream.
    for (const mint of unique) {
      if (!points[mint]) points[mint] = mockPoint(mint, 0, asOf);
    }
  }

  priceCache.set(key, { points: { ...points }, fetchedAt: nowMs });
  return points;
}

/**
 * Legacy numeric API: USD price per mint, 0 when absent.
 * (workers/priceCompare.ts depends on this shape.)
 */
export async function fetchPrices(mints: string[], opts: FetchPricesOptions = {}): Promise<PriceMap> {
  const quotes = await fetchPriceQuotes(mints, opts);
  const out: PriceMap = {};
  for (const mint of mints) out[mint] = quotes[mint]?.price ?? 0;
  return out;
}

// --- mocks -------------------------------------------------------------------

/** Legacy mock (existing tests/priceCompare): numeric map. */
export function mockPrices(mints: string[], price = 100): PriceMap {
  const out: PriceMap = {};
  for (const m of mints) out[m] = price;
  return out;
}

/** Typed mock PricePoints (source "mock" + asOf) for tests and dev harnesses. */
export function mockPriceQuotes(mints: string[], price = 0, now: () => Date = () => new Date()): PriceQuoteMap {
  const asOf = now().toISOString();
  const out: PriceQuoteMap = {};
  for (const mint of mints) out[mint] = mockPoint(mint, price, asOf);
  return out;
}
