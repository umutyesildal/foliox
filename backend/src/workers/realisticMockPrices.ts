/**
 * workers/realisticMockPrices.ts — REAL equity spot quotes for mock xStocks.
 *
 * When REALISTIC_MOCK_PRICES is truthy, mock xStocks whose whitelisted_mints
 * row is labeled "mock:<slug>" are priced from the real US-equity market via
 * the guarded Yahoo chart API (workers/yahooFetch.ts — symbol allowlist,
 * range/interval enums, host + pathname containment, 8s timeout). The slug →
 * ticker mapping is the explicit catalog table
 * catalog/mockStocks.ts MOCK_SLUG_TO_TICKER.
 *
 * Honesty contract (AGENTS.md §2):
 *   * Success ⇒ PricePoint source "yahoo" (flows into nav_snapshots
 *     price_source JSONB — every snapshot says where each leg came from).
 *   * ANY failure (429, timeout, unknown ticker, bad payload) ⇒ null and the
 *     caller falls back to the deterministic dev catalog (source "mock").
 *     Nothing here ever fabricates a price.
 *   * Unset env ⇒ disabled: local dev keeps deterministic catalog prices.
 *
 * Politeness: quotes are cached in-memory for REALISTIC_QUOTE_TTL_MS (60s) so
 * the 60s NAV loop cannot hammer Yahoo, real network fetches are spaced at
 * least REALISTIC_FETCH_GAP_MS apart (12 symbols max per pass), and failures
 * are NOT cached (a transient outage recovers on the next NAV pass).
 */

import { fetchYahooQuote, type YahooQuote } from "./yahooFetch.js";
import { tickerForSlug } from "../catalog/mockStocks.js";

export const REALISTIC_MOCK_PRICES_ENV = "REALISTIC_MOCK_PRICES";

/** Env gate: unset / empty / "0" / "false" ⇒ OFF (deterministic catalog). */
export function realisticMockPricesEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[REALISTIC_MOCK_PRICES_ENV];
  if (raw === undefined) return false;
  const t = raw.trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes" || t === "on";
}

/** In-memory TTL for Yahoo quotes — the NAV loop runs every 60s. */
export const REALISTIC_QUOTE_TTL_MS = 60_000;
/** Minimum spacing between REAL network fetches (sequential, ≤12 symbols). */
export const REALISTIC_FETCH_GAP_MS = 150;

/** A successfully-obtained real quote (never fabricated, always provenanced). */
export interface RealisticQuote {
  slug: string;
  ticker: string;
  price: number;
  marketState: string | null;
  /** ISO 8601 timestamp of when the quote was obtained. */
  asOf: string;
}

export interface RealisticQuoteOptions {
  /** Injectable clock (TTL math + asOf). Defaults to `new Date()`. */
  now?: () => Date;
  /** Injectable Yahoo quote fetch (tests / offline). Defaults to fetchYahooQuote. */
  fetchQuote?: (ticker: string) => Promise<YahooQuote>;
  /** Cache TTL ms (tests: inject 0 to disable caching). Default 60_000. */
  ttlMs?: number;
  /** Min spacing between real fetches ms (tests: 0). Default 150. */
  spacingMs?: number;
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
}

interface CacheEntry {
  quote: RealisticQuote;
  fetchedAtMs: number;
}

const quoteCache = new Map<string, CacheEntry>();

/** Test/maintenance hook: drop all cached realistic quotes. */
export function clearRealisticQuoteCache(): void {
  quoteCache.clear();
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Module-level last REAL network fetch (politeness across NAV passes). */
let lastNetworkFetchMs = 0;

/**
 * Real equity quote for one mock slug, or null on ANY failure (fail-open).
 * Never throws — one bad symbol must never break a NAV run.
 */
export async function realisticMockQuote(
  slug: string,
  opts: RealisticQuoteOptions = {},
): Promise<RealisticQuote | null> {
  try {
    const now = opts.now ?? (() => new Date());
    const nowMs = now().getTime();

    const cached = quoteCache.get(slug);
    const ttlMs = opts.ttlMs ?? REALISTIC_QUOTE_TTL_MS;
    if (cached && nowMs - cached.fetchedAtMs < ttlMs) return cached.quote;

    const ticker = tickerForSlug(slug);
    if (!ticker) return null; // unknown slug — catalog fallback handles it

    const doFetch = opts.fetchQuote ?? fetchYahooQuote;
    const spacingMs = opts.spacingMs ?? REALISTIC_FETCH_GAP_MS;
    if (spacingMs > 0) {
      const waitMs = spacingMs - (nowMs - lastNetworkFetchMs);
      if (waitMs > 0) await (opts.sleep ?? defaultSleep)(Math.min(waitMs, spacingMs));
    }
    lastNetworkFetchMs = now().getTime();

    const yq = await doFetch(ticker);
    if (typeof yq?.price !== "number" || !Number.isFinite(yq.price) || yq.price <= 0) {
      return null;
    }
    const quote: RealisticQuote = {
      slug,
      ticker,
      price: yq.price,
      marketState: yq.marketState ?? null,
      asOf: now().toISOString(),
    };
    quoteCache.set(slug, { quote, fetchedAtMs: nowMs });
    return quote;
  } catch {
    // 429 / timeout / bad symbol / network down — fail-open to the caller's
    // catalog fallback. Failures are deliberately NOT cached.
    return null;
  }
}
