"use client";

/**
 * Typed client fetchers for the basket API (backend/src/api/server.ts —
 * NEXT_PUBLIC_API, `/api/v1` base). All Postgres numerics arrive as text
 * strings; helpers here convert honestly (null when absent/NaN — never 0).
 * Every payload carries `source`/`asOf` provenance markers which pass through
 * to FreshnessBadge.
 */

import { prettyTicker } from "@/lib/format";
import { API_BASE, apiFetch } from "@/lib/api-client";

export { API_BASE };

/** Postgres numeric serialized as text by the indexer. */
export type Numeric = string | number | null | undefined;

export function numericToNumber(v: Numeric): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface VaultHoldingRow {
  mint: string;
  raw_amount: string;
  multiplier: string | number;
  scaled_amount: string;
  decimals: number;
  updated_at?: string | null;
  source?: string | null;
}

export interface BasketDetail {
  pubkey: string;
  factory: string;
  creator: string;
  treasury: string;
  share_mint: string;
  nonce: Numeric;
  created_at: string;
  metadata_hash?: string | null;
  metadata_json?: unknown;
  num_constituents: number;
  constituents: string[];
  weights_bps: number[];
  entry_fee_bps: number;
  exit_fee_bps: number;
  management_fee_bps: number;
  last_fee_accrual_ts: Numeric;
  nav: {
    value: string;
    supply: string;
    sharePrice: string;
    priceSource?: unknown;
    asOf: string;
    source: string;
  } | null;
  drift: {
    actualWeightsBps: number[];
    driftBps: number[];
    basis: string;
  } | null;
  holdings: VaultHoldingRow[];
  source: string;
  asOf: string | null;
}

export interface NavHistoryRow {
  ts: string;
  nav: string;
  supply?: string;
  share_price?: string | null;
  /** Bucketed rows only — first share_price in the bucket (close is `share_price`). */
  share_price_open?: string | null;
  price_source?: unknown;
  source?: string | null;
}

/** Bucketed /nav/history intervals the backend aggregates via date_bin. */
export const NAV_INTERVALS = ["1m", "5m", "15m", "1h", "1d"] as const;
export type NavInterval = (typeof NAV_INTERVALS)[number];

export class ApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(path, {
      signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Could not reach the basket API.", 0);
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  const errObj = (payload as { error?: { code?: string; message?: string } } | null)?.error;
  if (!res.ok) {
    throw new ApiError(
      errObj?.message ?? `API responded with HTTP ${res.status}`,
      res.status,
      errObj?.code,
    );
  }
  return payload as T;
}

/** GET /baskets/:pubkey — basket row + latest NAV + drift + embedded holdings. */
export async function fetchBasketDetail(
  pubkey: string,
  signal: AbortSignal,
): Promise<BasketDetail> {
  const payload = await getJson<{ data: BasketDetail }>(
    `/api/v1/baskets/${encodeURIComponent(pubkey)}`,
    signal,
  );
  return payload.data;
}

/** GET /baskets/:pubkey/holdings — raw + multiplier + scaled + decimals. */
export async function fetchBasketHoldings(
  pubkey: string,
  signal: AbortSignal,
): Promise<VaultHoldingRow[]> {
  const payload = await getJson<{ data: VaultHoldingRow[] }>(
    `/api/v1/baskets/${encodeURIComponent(pubkey)}/holdings`,
    signal,
  );
  return payload.data ?? [];
}

/**
 * GET /baskets/:pubkey/nav/history — snapshot series (ts ASC, capped 5000).
 * Optional `from` window and/or `interval` bucketing; bucketed rows
 * (bucket/open/close/…) are normalized to {ts, nav: close} so callers see one
 * shape. No interpolation — points are exactly what the indexer stored.
 */
export async function fetchNavHistory(
  pubkey: string,
  signal: AbortSignal,
  opts?: { from?: Date; interval?: NavInterval },
): Promise<{ rows: NavHistoryRow[]; source: string | null }> {
  const params = new URLSearchParams();
  if (opts?.from) params.set("from", opts.from.toISOString());
  if (opts?.interval) params.set("interval", opts.interval);
  const qs = params.toString();
  const payload = await getJson<{
    data?: Array<{
      ts?: string;
      nav?: string;
      bucket?: string;
      close?: string;
      supply?: string;
      share_price?: string | null;
      share_price_open?: string | null;
      source?: string | null;
    }>;
    source?: string | null;
  }>(
    `/api/v1/baskets/${encodeURIComponent(pubkey)}/nav/history${qs ? `?${qs}` : ""}`,
    signal,
  );
  const rows = (payload.data ?? []).map((row) => ({
    ts: row.ts ?? row.bucket ?? "",
    nav: row.nav ?? row.close ?? "",
    supply: row.supply,
    share_price: row.share_price ?? null,
    share_price_open: row.share_price_open ?? null,
    source: row.source ?? null,
  }));
  return { rows, source: payload.source ?? null };
}

/**
 * GET /baskets/:pubkey/performance — windowed NAV returns. Only the 24h pct
 * is consumed here (metric strip); null when the indexer has no baseline.
 */
export async function fetchBasketPerformance(
  pubkey: string,
  signal: AbortSignal,
): Promise<{ change24hPct: number | null }> {
  const payload = await getJson<{
    data?: { windows?: Record<string, { pct?: number | null }> } | null;
  }>(`/api/v1/baskets/${encodeURIComponent(pubkey)}/performance`, signal);
  const pct = payload.data?.windows?.["24h"]?.pct;
  return { change24hPct: typeof pct === "number" && Number.isFinite(pct) ? pct : null };
}

/** GET /whitelist — mint → ticker map for holdings/composition labels. */
export async function fetchMintTickers(
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const payload = await getJson<{
    data?: { mint?: string; ticker?: string; price_source?: string }[];
  }>("/api/v1/whitelist", signal);
  const map = new Map<string, string>();
  for (const row of payload.data ?? []) {
    if (typeof row.mint !== "string" || !row.mint) continue;
    const fromField = typeof row.ticker === "string" ? row.ticker.trim() : "";
    const fromSource =
      typeof row.price_source === "string" ? row.price_source.split(":").pop() ?? "" : "";
    const ticker = prettyTicker(fromField || fromSource);
    if (ticker) map.set(row.mint, ticker);
  }
  return map;
}

/**
 * GET /whitelist — mint → raw price_source map ("mock:tsla", "jupiter:TSLAx",
 * …). This is the honest signal for Jupiter-path availability: `mock:*` mints
 * are repo-issued devnet tokens that Jupiter can NEVER quote, so the Zap USDC
 * tab is disabled instead of letting every leg fail.
 */
export async function fetchMintPriceSources(
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const payload = await getJson<{
    data?: { mint?: string; price_source?: string | null }[];
  }>("/api/v1/whitelist", signal);
  const map = new Map<string, string>();
  for (const row of payload.data ?? []) {
    if (typeof row.mint === "string" && typeof row.price_source === "string") {
      map.set(row.mint, row.price_source);
    }
  }
  return map;
}

/**
 * GET /market/overview?range=1mo — SPY 24h benchmark return from the last two
 * daily closes (same approach as /explore). Null when unavailable; callers
 * hide the vs-SPY metric rather than fabricate a comparison.
 */
export async function fetchSpy24h(signal: AbortSignal): Promise<number | null> {
  const payload = await getJson<{
    data?: { symbol?: string; candles?: { close?: number }[] }[];
  }>("/api/v1/market/overview?range=1mo", signal);
  const spy = payload.data?.find((s) => s.symbol === "SPY");
  const closes = (spy?.candles ?? []).map((c) => c.close).filter((c): c is number => typeof c === "number");
  if (closes.length < 2) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  return prev ? ((last - prev) / prev) * 100 : null;
}

/**
 * POST /quotes/zap-in — Jupiter quote legs only; the backend never signs
 * (backend/src/api/quotes.ts). Returns the verbatim warning + provenance.
 */
export interface ZapLeg {
  index: number;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  allocationBps: number | null;
  expectedOutAmount: string | null;
  priceImpactPct: string | null;
  routeLabels: string[];
  jupiterQuote: unknown | null;
  note?: string;
}

export interface ZapInQuote {
  side: "zap-in";
  basket: string;
  slippageBps: number;
  legs: ZapLeg[];
  expectedShares: string | null;
  provenance: { source: string; asOf: string; slippageBps: number; cached?: boolean };
  warning: string;
  mintAccountsNote: string;
  source: string;
}

export async function fetchZapInQuote(
  body: { basket: string; amountUSDC: string; slippageBps: number },
  signal: AbortSignal,
): Promise<ZapInQuote> {
  let res: Response;
  try {
    res = await apiFetch("/api/v1/quotes/zap-in", {
      method: "POST",
      signal,
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Could not reach the quote API.", 0);
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  const errObj = (payload as { error?: { code?: string; message?: string } } | null)?.error;
  if (!res.ok) {
    throw new ApiError(
      errObj?.message ?? `Quote API responded with HTTP ${res.status}`,
      res.status,
      errObj?.code,
    );
  }
  return payload as ZapInQuote;
}
