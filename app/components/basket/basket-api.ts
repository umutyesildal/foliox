"use client";

/**
 * Typed client fetchers for the basket API (backend/src/api/server.ts —
 * NEXT_PUBLIC_API, `/api/v1` base). All Postgres numerics arrive as text
 * strings; helpers here convert honestly (null when absent/NaN — never 0).
 * Every payload carries `source`/`asOf` provenance markers which pass through
 * to FreshnessBadge.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API || "http://localhost:3001";

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
  share_price?: string;
  price_source?: unknown;
  source?: string | null;
}

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
    res = await fetch(`${API_BASE}${path}`, {
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

/** GET /baskets/:pubkey/nav/history — raw snapshot series (ts ASC, capped 5000). */
export async function fetchNavHistory(
  pubkey: string,
  signal: AbortSignal,
): Promise<{ rows: NavHistoryRow[]; source: string | null }> {
  const payload = await getJson<{
    data: NavHistoryRow[];
    source?: string | null;
  }>(`/api/v1/baskets/${encodeURIComponent(pubkey)}/nav/history`, signal);
  return { rows: payload.data ?? [], source: payload.source ?? null };
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
    res = await fetch(`${API_BASE}/api/v1/quotes/zap-in`, {
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
