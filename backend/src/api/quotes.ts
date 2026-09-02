/**
 * api/quotes.ts — Jupiter zap quote endpoints (spec §8 zap-in / zap-out).
 *
 * V0 zap contract (spec §3.3 zap_router note + AGENTS.md §2 #8):
 *   * Zap is periphery only: the backend returns Jupiter Swap-API QUOTE legs;
 *     the CLIENT executes the swaps sequentially and then calls
 *     `mint_in_kind` / `redeem_in_kind`. V0 zap is sequential and NON-atomic —
 *     a partial swap failure leaves the user holding intermediate tokens
 *     (nothing is lost, but extra txs are needed). Every response carries that
 *     warning verbatim.
 *   * `mintAccountsNote` states the programs/basket client contract: after the
 *     3n token triplet remaining-accounts, mint_in_kind requires appending the
 *     n WhitelistedMint PDAs.
 *   * The backend NEVER builds, signs or submits the swap transactions
 *     (AGENTS.md §2 #5) — quotes are data only.
 *
 * Honesty rules: the quote source is always labeled (`provenance.source =
 * "jupiter-quote"`); a Jupiter outage degrades to 503 QUOTE_UNAVAILABLE —
 * a quote is NEVER fabricated or mocked. Amount math is integer-safe: all raw
 * token amounts are decimal strings, allocations are BigInt splits.
 */
import { isPgLike, type PgLike } from "../db/client.js";
import type { KeyValueCache } from "../workers/navEngine.js";

export const USDC_MINT_DEFAULT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const JUPITER_QUOTE_URL = "https://quote-api.jup.ag/v6/quote";
export const QUOTE_TIMEOUT_MS = 10_000;
export const QUOTE_CACHE_TTL_SECONDS = 30; // spec §7: quote:zap-in:{basket}:{amount} TTL 30s
export const DEFAULT_SLIPPAGE_BPS = 50;

export const ZAP_WARNING =
  "V0 zap is sequential and non-atomic: execute the swap legs one by one, then " +
  "call mint_in_kind (or redeem_in_kind for zap-out). If a leg fails you may be " +
  "left holding intermediate tokens — no funds are lost, but you will need " +
  "extra transactions. Slippage is not guaranteed.";

export const MINT_ACCOUNTS_NOTE =
  "mint_in_kind requires appending the n WhitelistedMint PDAs " +
  '(whitelist program, seeds ["mint", mint_pubkey]) AFTER the 3n token triplet ' +
  "remaining-accounts [mint_i, user_ata_i, vault_ata_i] — 4n accounts total; " +
  "see programs/basket mint_in_kind remaining-accounts contract.";

export class QuoteUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteUnavailableError";
  }
}

// --- Jupiter v6 quote wire types --------------------------------------------

export interface JupiterQuote {
  inAmount?: string;
  outAmount?: string;
  priceImpactPct?: string;
  slippageBps?: number;
  routePlan?: Array<{ swapInfo?: { label?: string | null } }>;
}

function isJupiterQuote(value: unknown): value is JupiterQuote {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { outAmount?: unknown }).outAmount === "string" &&
    typeof (value as { inAmount?: unknown }).inAmount === "string"
  );
}

function routeLabels(q: JupiterQuote): string[] {
  const labels: string[] = [];
  for (const step of q.routePlan ?? []) {
    const label = step.swapInfo?.label;
    if (label) labels.push(label);
  }
  return labels;
}

/**
 * One Jupiter Swap API v6 quote. Plain fetch — no extra deps. Throws
 * QuoteUnavailableError on any failure (never fabricates).
 */
export async function fetchJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: number,
  fetchImpl: typeof fetch = fetch,
): Promise<JupiterQuote> {
  const url =
    `${JUPITER_QUOTE_URL}?inputMint=${encodeURIComponent(inputMint)}` +
    `&outputMint=${encodeURIComponent(outputMint)}&amount=${encodeURIComponent(amount)}` +
    `&slippageBps=${slippageBps}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS) });
  } catch (err) {
    throw new QuoteUnavailableError(`jupiter quote unreachable: ${err instanceof Error ? err.message : err}`);
  }
  if (!res.ok) throw new QuoteUnavailableError(`jupiter quote ${res.status}`);
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new QuoteUnavailableError(`jupiter quote bad json: ${err instanceof Error ? err.message : err}`);
  }
  if (!isJupiterQuote(json)) throw new QuoteUnavailableError("jupiter quote: unexpected response shape");
  return json;
}

// --- integer-safe split / entitlement math ----------------------------------

/**
 * Split `totalRaw` across legs by target weights (bps). Integer-safe: every
 * leg is floor(total × w/10000) and the LAST leg absorbs the remainder so the
 * legs always sum exactly to total, even for weights that do not sum to 10000.
 */
export function splitByWeightsRaw(totalRaw: bigint, weightsBps: number[]): bigint[] {
  const out: bigint[] = [];
  let acc = 0n;
  for (let i = 0; i < weightsBps.length; i++) {
    if (i === weightsBps.length - 1) {
      out.push(totalRaw - acc);
    } else {
      const amt = (totalRaw * BigInt(weightsBps[i])) / 10_000n;
      acc += amt;
      out.push(amt);
    }
  }
  return out;
}

export interface RedeemEntitlements {
  exitFeeShares: bigint; // floor(shares × bps / 10000)
  burnShares: bigint; // shares − exitFeeShares
  outs: bigint[]; // floor(vaultRaw_i × burn / supply) per constituent (raw base units)
}

/**
 * Pro-rata redeem entitlements, oracle-free, exactly mirroring
 * programs/basket math::redeem_amounts (u64 floor division) but in BigInt so
 * u64-scale supplies never round wrong.
 */
export function redeemEntitlements(
  vaultRaw: bigint[],
  supplyRaw: bigint,
  sharesRaw: bigint,
  exitFeeBps: number,
): RedeemEntitlements {
  const exitFeeShares = (sharesRaw * BigInt(exitFeeBps)) / 10_000n;
  const burnShares = sharesRaw - exitFeeShares;
  const outs = vaultRaw.map((v) => (supplyRaw > 0n ? (v * burnShares) / supplyRaw : 0n));
  return { exitFeeShares, burnShares, outs };
}

/** Parse a human USDC amount (number | numeric string) into raw base units (6 decimals). */
export function usdcToRaw(amountUSDC: number | string): bigint {
  const n = typeof amountUSDC === "number" ? amountUSDC : Number(amountUSDC);
  if (!Number.isFinite(n) || n <= 0) throw new Error("amountUSDC must be a positive number");
  // Fixed-point parse at 6 decimals (half-up) — avoids f64 drift like 0.1+0.2.
  const s = typeof amountUSDC === "number" ? String(amountUSDC) : amountUSDC.trim();
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || s === "" || Number.isNaN(n)) throw new Error("amountUSDC must be a positive number");
  const negative = m[1] === "-";
  const digits = BigInt(((m[2] || "0") + (m[3] || "")) || "0");
  const fracLen = (m[3] || "").length;
  let raw = fracLen <= 6 ? digits * 10n ** BigInt(6 - fracLen) : digits / 10n ** BigInt(fracLen - 6);
  if (negative) raw = -raw;
  if (raw <= 0n) throw new Error("amountUSDC must be a positive number");
  return raw;
}

// --- shared request plumbing --------------------------------------------------

export interface QuoteContext {
  db: PgLike | null;
  cache?: KeyValueCache | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface QuoteLeg {
  index: number;
  inputMint: string;
  outputMint: string;
  /** Target-weight allocation (zap-in) or pro-rata entitlement (zap-out), raw base units. */
  inAmount: string;
  allocationBps: number | null;
  /** Jupiter-expected output, raw base units (decimal string) — null when the leg was skipped (zero amount). */
  expectedOutAmount: string | null;
  priceImpactPct: string | null;
  routeLabels: string[];
  /** Raw Jupiter quote passthrough for the leg (null when the leg was skipped). */
  jupiterQuote: JupiterQuote | null;
  note?: string;
}

export interface QuoteResponse {
  side: "zap-in" | "zap-out";
  basket: string;
  slippageBps: number;
  legs: QuoteLeg[];
  /** Estimated shares minted (zap-in) — informational only, floor(amountUSDC × supply / NAV). */
  expectedShares?: string | null;
  /** Redeem breakdown (zap-out), all raw base units as decimal strings. */
  redeem?: { shares: string; exitFeeShares: string; burnShares: string; outs: string[] };
  provenance: {
    source: "jupiter-quote";
    asOf: string;
    slippageBps: number;
    cached?: boolean;
  };
  warning: string;
  mintAccountsNote: string;
  source: "jupiter-quote";
}

export type QuoteOutcome = { status: number; payload: unknown };

interface BasketRowLite {
  pubkey: string;
  share_mint: string;
  constituents: string[];
  weights_bps: number[];
  exit_fee_bps: number;
}

interface NavLite {
  nav: string;
  supply: string;
}

async function loadBasket(db: PgLike, basket: string): Promise<BasketRowLite | null> {
  const res = await db.query(
    `SELECT pubkey, share_mint, constituents, weights_bps, exit_fee_bps
     FROM baskets WHERE pubkey = $1`,
    [basket],
  );
  return (res.rows[0] as BasketRowLite | undefined) ?? null;
}

async function loadLatestNav(db: PgLike, basket: string): Promise<NavLite | null> {
  const res = await db.query(
    `SELECT nav::text AS nav, supply::text AS supply
     FROM nav_snapshots WHERE basket = $1 ORDER BY ts DESC LIMIT 1`,
    [basket],
  );
  return (res.rows[0] as NavLite | undefined) ?? null;
}

function parseSlippage(body: { slippageBps?: unknown }): number | null {
  const raw = body.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 10_000) return null;
  return n;
}

// --- zap-in -------------------------------------------------------------------

/**
 * POST /quotes/zap-in {basket, amountUSDC, slippageBps}
 * Legs: USDC → each constituent, sized by TARGET weights (baskets.weights_bps).
 * Jupiter must price every leg or the whole quote fails with 503
 * QUOTE_UNAVAILABLE — no partial/fabricated quotes.
 */
export async function handleZapIn(ctx: QuoteContext, body: Record<string, unknown>): Promise<QuoteOutcome> {
  const basket = typeof body.basket === "string" ? body.basket : "";
  if (!basket) return { status: 400, payload: { error: { code: "INVALID_BASKET", message: "basket pubkey required" } } };

  let amountRaw: bigint;
  try {
    amountRaw = usdcToRaw(body.amountUSDC as number | string);
  } catch (err) {
    return { status: 400, payload: { error: { code: "INVALID_AMOUNT", message: err instanceof Error ? err.message : "invalid amountUSDC" } } };
  }
  const slippageBps = parseSlippage(body);
  if (slippageBps === null) {
    return { status: 400, payload: { error: { code: "INVALID_SLIPPAGE", message: "slippageBps must be an integer in [0, 10000]" } } };
  }
  if (!isPgLike(ctx.db)) {
    return { status: 503, payload: { error: { code: "DB_UNAVAILABLE", message: "quotes need the indexed baskets table (no Postgres)" } } };
  }

  const db = ctx.db;
  let row: BasketRowLite | null;
  try {
    row = await loadBasket(db, basket);
  } catch (err) {
    return { status: 503, payload: { error: { code: "DB_UNAVAILABLE", message: err instanceof Error ? err.message : "db error" } } };
  }
  if (!row) return { status: 404, payload: { error: { code: "NOT_INDEXED", message: `basket ${basket} is not indexed` } } };

  const usdcMint = process.env.USDC_MINT || USDC_MINT_DEFAULT;
  const asOf = (ctx.now ?? (() => new Date()))().toISOString();

  // Quote cache: quote:zap-in:{basket}:{amount}:{slippage} TTL 30s (spec §7).
  const cacheKey = `quote:zap-in:${basket}:${amountRaw}:${slippageBps}`;
  if (ctx.cache) {
    try {
      const hit = await ctx.cache.get(cacheKey);
      if (hit) {
        const cached = JSON.parse(hit) as QuoteResponse;
        cached.provenance.cached = true;
        return { status: 200, payload: cached };
      }
    } catch {
      // cache miss/failure → proceed with a live quote
    }
  }

  const weights = row.weights_bps ?? [];
  const splits = splitByWeightsRaw(amountRaw, weights);

  // Every leg must price — Jupiter is fetched for all legs, any failure fails
  // the whole quote (all-or-nothing; never a partial fabricated quote).
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const settled = await Promise.allSettled(
    splits.map((amount, i) =>
      amount > 0n
        ? fetchJupiterQuote(usdcMint, row!.constituents[i], amount.toString(), slippageBps, fetchImpl)
        : Promise.resolve(null),
    ),
  );
  const legs: QuoteLeg[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (splits[i] === 0n) {
      legs.push({
        index: i,
        inputMint: usdcMint,
        outputMint: row.constituents[i],
        inAmount: "0",
        allocationBps: weights[i] ?? null,
        expectedOutAmount: null,
        priceImpactPct: null,
        routeLabels: [],
        jupiterQuote: null,
        note: "zero-amount leg skipped (dust weight split)",
      });
      continue;
    }
    if (s.status === "rejected") {
      const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
      return {
        status: 503,
        payload: {
          error: {
            code: "QUOTE_UNAVAILABLE",
            message: `Jupiter quote unavailable for leg ${i} (${row.constituents[i]}): ${reason}`,
          },
        },
      };
    }
    const q = s.value;
    if (!q) {
      legs.push({
        index: i,
        inputMint: usdcMint,
        outputMint: row.constituents[i],
        inAmount: splits[i].toString(),
        allocationBps: weights[i] ?? null,
        expectedOutAmount: null,
        priceImpactPct: null,
        routeLabels: [],
        jupiterQuote: null,
        note: "zero-amount leg skipped (dust weight split)",
      });
      continue;
    }
    legs.push({
      index: i,
      inputMint: usdcMint,
      outputMint: row.constituents[i],
      inAmount: splits[i].toString(),
      allocationBps: weights[i] ?? null,
      expectedOutAmount: q.outAmount ?? null,
      priceImpactPct: q.priceImpactPct ?? null,
      routeLabels: routeLabels(q),
      jupiterQuote: q,
    });
  }

  // Expected shares estimate: floor(amountUSDC_raw × supplyRaw / nav) — needs
  // a NAV snapshot; absent NAV ⇒ null (honest) rather than a made-up number.
  let expectedShares: string | null = null;
  let nav: NavLite | null = null;
  try {
    nav = await loadLatestNav(db, basket);
  } catch {
    nav = null;
  }
  if (nav && nav.supply !== "0" && /^[0-9]+$/.test(nav.supply)) {
    const navUnits = BigInt(nav.nav.split(".")[0] || "0");
    if (navUnits > 0n) {
      expectedShares = ((amountRaw * BigInt(nav.supply)) / navUnits).toString();
    }
  }

  const payload: QuoteResponse = {
    side: "zap-in",
    basket,
    slippageBps,
    legs,
    expectedShares,
    provenance: { source: "jupiter-quote", asOf, slippageBps },
    warning: ZAP_WARNING,
    mintAccountsNote: MINT_ACCOUNTS_NOTE,
    source: "jupiter-quote",
  };
  if (ctx.cache) {
    try {
      await ctx.cache.set(cacheKey, JSON.stringify(payload), QUOTE_CACHE_TTL_SECONDS);
    } catch {
      // non-fatal
    }
  }
  return { status: 200, payload };
}

// --- zap-out -------------------------------------------------------------------

/**
 * POST /quotes/zap-out {basket, shares, targetMint?, slippageBps?}
 * Symmetric: pro-rata entitlement per constituent (oracle-free, from indexed
 * vault holdings — the same floor math as redeem_in_kind), then a Jupiter leg
 * per constituent into the target mint (USDC by default).
 */
export async function handleZapOut(ctx: QuoteContext, body: Record<string, unknown>): Promise<QuoteOutcome> {
  const basket = typeof body.basket === "string" ? body.basket : "";
  if (!basket) return { status: 400, payload: { error: { code: "INVALID_BASKET", message: "basket pubkey required" } } };

  // shares: raw u64 base units — decimal string (or safe integer number).
  let sharesRaw: bigint;
  const sharesInput = body.shares;
  if (typeof sharesInput === "string" && /^[0-9]+$/.test(sharesInput.trim())) {
    sharesRaw = BigInt(sharesInput.trim());
  } else if (typeof sharesInput === "number" && Number.isInteger(sharesInput) && sharesInput > 0) {
    sharesRaw = BigInt(sharesInput);
  } else {
    return { status: 400, payload: { error: { code: "INVALID_SHARES", message: "shares must be a raw amount (u64 decimal string)" } } };
  }
  const slippageBps = parseSlippage(body);
  if (slippageBps === null) {
    return { status: 400, payload: { error: { code: "INVALID_SLIPPAGE", message: "slippageBps must be an integer in [0, 10000]" } } };
  }
  const targetMint = typeof body.targetMint === "string" && body.targetMint ? body.targetMint : (process.env.USDC_MINT || USDC_MINT_DEFAULT);
  if (!isPgLike(ctx.db)) {
    return { status: 503, payload: { error: { code: "DB_UNAVAILABLE", message: "quotes need the indexed baskets table (no Postgres)" } } };
  }

  const db = ctx.db;
  let row: BasketRowLite | null;
  let nav: NavLite | null;
  try {
    row = await loadBasket(db, basket);
    nav = await loadLatestNav(db, basket);
  } catch (err) {
    return { status: 503, payload: { error: { code: "DB_UNAVAILABLE", message: err instanceof Error ? err.message : "db error" } } };
  }
  if (!row) return { status: 404, payload: { error: { code: "NOT_INDEXED", message: `basket ${basket} is not indexed` } } };

  const asOf = (ctx.now ?? (() => new Date()))().toISOString();
  const cacheKey = `quote:zap-out:${basket}:${sharesRaw}:${targetMint}:${slippageBps}`;
  if (ctx.cache) {
    try {
      const hit = await ctx.cache.get(cacheKey);
      if (hit) {
        const cached = JSON.parse(hit) as QuoteResponse;
        cached.provenance.cached = true;
        return { status: 200, payload: cached };
      }
    } catch {
      // cache miss/failure → proceed with a live quote
    }
  }

  // Pro-rata entitlement from the indexed vault holdings (raw amounts).
  let holdings: Array<{ mint: string; raw_amount: string }>;
  try {
    const res = await db.query(
      `SELECT mint, raw_amount::text AS raw_amount FROM vault_holdings
       WHERE basket = $1 AND mint = ANY($2::text[])`,
      [basket, row.constituents],
    );
    holdings = res.rows as Array<{ mint: string; raw_amount: string }>;
  } catch (err) {
    return { status: 503, payload: { error: { code: "DB_UNAVAILABLE", message: err instanceof Error ? err.message : "db error" } } };
  }
  const rawByMint = new Map(holdings.map((h) => [h.mint, h.raw_amount]));
  const missingHoldings = row.constituents.filter((m) => !rawByMint.has(m));
  if (missingHoldings.length > 0) {
    return {
      status: 404,
      payload: {
        error: {
          code: "NOT_INDEXED",
          message: `vault holdings not indexed for ${basket}: ${missingHoldings.join(",")}`,
        },
      },
    };
  }
  const vaultRaw = row.constituents.map((m) => BigInt(rawByMint.get(m)!));
  const supplyRaw = nav && /^[0-9]+$/.test(nav.supply) ? BigInt(nav.supply) : 0n;
  if (supplyRaw === 0n) {
    return {
      status: 404,
      payload: { error: { code: "NOT_INDEXED", message: `no NAV snapshot / supply indexed for ${basket}` } },
    };
  }
  if (sharesRaw > supplyRaw) {
    return {
      status: 400,
      payload: { error: { code: "INSUFFICIENT_BALANCE", message: "shares exceed the indexed share supply" } },
    };
  }

  const { exitFeeShares, burnShares, outs } = redeemEntitlements(vaultRaw, supplyRaw, sharesRaw, row.exit_fee_bps);

  // Jupiter leg per constituent with a non-zero entitlement; a zero-out leg
  // (dust pro-rata) is skipped rather than sent to Jupiter.
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const settled = await Promise.allSettled(
    outs.map((out, i) =>
      out > 0n
        ? fetchJupiterQuote(row!.constituents[i], targetMint, out.toString(), slippageBps, fetchImpl)
        : Promise.resolve(null),
    ),
  );
  const legs: QuoteLeg[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (outs[i] === 0n) {
      legs.push({
        index: i,
        inputMint: row.constituents[i],
        outputMint: targetMint,
        inAmount: "0",
        allocationBps: null,
        expectedOutAmount: null,
        priceImpactPct: null,
        routeLabels: [],
        jupiterQuote: null,
        note: "zero pro-rata entitlement — leg skipped",
      });
      continue;
    }
    if (s.status === "rejected") {
      const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
      return {
        status: 503,
        payload: {
          error: {
            code: "QUOTE_UNAVAILABLE",
            message: `Jupiter quote unavailable for leg ${i} (${row.constituents[i]}): ${reason}`,
          },
        },
      };
    }
    const q = s.value;
    if (!q) {
      legs.push({
        index: i,
        inputMint: row.constituents[i],
        outputMint: targetMint,
        inAmount: outs[i].toString(),
        allocationBps: null,
        expectedOutAmount: null,
        priceImpactPct: null,
        routeLabels: [],
        jupiterQuote: null,
        note: "zero pro-rata entitlement — leg skipped",
      });
      continue;
    }
    legs.push({
      index: i,
      inputMint: row.constituents[i],
      outputMint: targetMint,
      inAmount: outs[i].toString(),
      allocationBps: null,
      expectedOutAmount: q.outAmount ?? null,
      priceImpactPct: q.priceImpactPct ?? null,
      routeLabels: routeLabels(q),
      jupiterQuote: q,
    });
  }

  const payload: QuoteResponse = {
    side: "zap-out",
    basket,
    slippageBps,
    legs,
    redeem: {
      shares: sharesRaw.toString(),
      exitFeeShares: exitFeeShares.toString(),
      burnShares: burnShares.toString(),
      outs: outs.map((o) => o.toString()),
    },
    provenance: { source: "jupiter-quote", asOf, slippageBps },
    warning: ZAP_WARNING,
    mintAccountsNote: MINT_ACCOUNTS_NOTE,
    source: "jupiter-quote",
  };
  if (ctx.cache) {
    try {
      await ctx.cache.set(cacheKey, JSON.stringify(payload), QUOTE_CACHE_TTL_SECONDS);
    } catch {
      // non-fatal
    }
  }
  return { status: 200, payload };
}
