/**
 * Minimal API server — spec §8 + V0.1 price comparison. Wave B: every core
 * route reads the Postgres schema (db/client.ts connectFromEnv) instead of
 * in-memory arrays, carries explicit `source`/`asOf` markers, and degrades
 * honestly: empty DB ⇒ explicit empty list / 404 NOT_INDEXED; no DB ⇒ 503
 * DB_UNAVAILABLE. NO endpoint fabricates production-looking data.
 *
 * Run: npx tsx backend/src/index.ts  (PORT=3001)
 *
 * INTEGER-SAFETY CONVENTION: BIGINT/NUMERIC columns are returned as decimal
 * STRINGS in JSON (pg returns int8/numeric as strings) — never coerced into
 * JS numbers. `multiplier` (an f64 display factor) is the one numeric field.
 */
import http from "http";
import { comparePrices, getChartSeries, TICKER_MINTS, YAHOO_MAP } from "../workers/priceCompare.js";
import { fetchYahooSeries } from "../workers/yahooFetch.js";
import { connectFromEnv, isPgLike, type PgLike } from "../db/client.js";
import { computeDriftExact, computePerformanceFromBaselines, type KeyValueCache } from "../workers/navEngine.js";
import { handleZapIn, handleZapOut, type QuoteContext } from "./quotes.js";

export const API_VERSION = "0.1.0";

export interface SubsystemStatus {
  db: { connected: boolean; schemaApplied: boolean | null };
  indexer: { enabled: boolean; running: boolean };
  navEngine: { enabled: boolean; running: boolean };
  feeCrank: { enabled: boolean; running: boolean };
}

export interface ApiContext {
  /** Postgres client (null ⇒ DB-less mode: DB routes answer 503). */
  db: PgLike | null;
  /** Optional key/value cache shared with the NAV engine + quotes. */
  cache?: KeyValueCache | null;
  /** Injectable fetch for quote tests. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Subsystem enabled/running report for /health (wired by index.ts). */
  status?: () => SubsystemStatus;
}

// --- helpers -----------------------------------------------------------------

type Res = http.ServerResponse;

function sendJson(res: Res, status: number, payload: unknown): void {
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

function sendError(res: Res, status: number, code: string, message: string, extra?: Record<string, unknown>): void {
  sendJson(res, status, { error: { code, message, ...extra } });
}

const SUPPORTED_SORTS = ["aum", "return_24h", "return_7d", "return_30d", "holders", "mint_count"] as const;
type SortKey = (typeof SUPPORTED_SORTS)[number];

const NAV_INTERVALS: Record<string, string> = {
  "1m": "60 seconds",
  "5m": "300 seconds",
  "15m": "900 seconds",
  "1h": "3600 seconds",
  "1d": "86400 seconds",
};

function isValidPubkey(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

function sortExpression(sort: SortKey): string {
  switch (sort) {
    case "return_24h":
      return "(r.nav - h24.nav) / NULLIF(h24.nav, 0)";
    case "return_7d":
      return "(r.nav - h168.nav) / NULLIF(h168.nav, 0)";
    case "return_30d":
      return "r.return_30d";
    case "holders":
      return "holders";
    case "mint_count":
      return "r.mint_count";
    case "aum":
    default:
      return "r.nav";
  }
}

/**
 * Resolve the DB for a request: an explicit context client (wired at boot) or
 * a memoized connectFromEnv() client (null when DATABASE_URL is unset).
 */
async function resolveDb(ctx: ApiContext): Promise<PgLike | null> {
  if (ctx.db) return isPgLike(ctx.db) ? ctx.db : null;
  return await connectFromEnv();
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        resolve(typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

// --- route implementations (exported for tests) ------------------------------

const BASKETS_LIST_SQL = `
  SELECT r.pubkey, r.creator, r.share_mint,
         r.nav::text AS nav, r.supply::text AS supply,
         r.share_price::text AS share_price,
         r.return_30d::text AS return_30d, r.mint_count, r.refreshed_at,
         nav.ts AS nav_as_of,
         ((r.nav - h24.nav) / NULLIF(h24.nav, 0))::text AS return_24h,
         COALESCE(h.holders, 0) AS holders
  FROM basket_rankings r
  LEFT JOIN LATERAL (
    SELECT ts FROM nav_snapshots WHERE basket = r.pubkey ORDER BY ts DESC LIMIT 1
  ) nav ON true
  LEFT JOIN LATERAL (
    SELECT nav FROM nav_snapshots WHERE basket = r.pubkey
      AND ts <= NOW() - interval '24 hours' ORDER BY ts DESC LIMIT 1
  ) h24 ON true
  LEFT JOIN LATERAL (
    SELECT nav FROM nav_snapshots WHERE basket = r.pubkey
      AND ts <= NOW() - interval '7 days' ORDER BY ts DESC LIMIT 1
  ) h168 ON true
  LEFT JOIN (
    SELECT basket, COUNT(*)::int AS holders FROM user_positions GROUP BY basket
  ) h ON h.basket = r.pubkey
`;

/** GET /baskets — basket_rankings matview + filters (spec §8). */
export async function listBaskets(
  db: PgLike,
  params: { sort?: string | null; creator?: string | null; minAUM?: string | null; search?: string | null; limit?: number },
): Promise<{ status: number; payload: unknown }> {
  const sortKey = (params.sort || "aum") as SortKey;
  if (!(SUPPORTED_SORTS as readonly string[]).includes(sortKey)) {
    return {
      status: 400,
      payload: {
        error: {
          code: "INVALID_SORT",
          message: `sort must be one of ${SUPPORTED_SORTS.join("|")}`,
          supported: SUPPORTED_SORTS,
        },
      },
    };
  }
  const minAUM = params.minAUM ? Number(params.minAUM) : null;
  if (params.minAUM && (!Number.isFinite(minAUM) || (minAUM ?? 0) < 0)) {
    return { status: 400, payload: { error: { code: "INVALID_MIN_AUM", message: "minAUM must be a non-negative number" } } };
  }
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const sql = `${BASKETS_LIST_SQL}
    WHERE ($1::text IS NULL OR r.creator = $1)
      AND ($2::numeric IS NULL OR r.nav >= $2::numeric)
      AND ($3::text IS NULL OR r.pubkey ILIKE '%' || $3 || '%' OR r.creator ILIKE '%' || $3 || '%' OR r.share_mint ILIKE '%' || $3 || '%')
    ORDER BY ${sortExpression(sortKey)} DESC NULLS LAST
    LIMIT $4`;
  const res = await db.query(sql, [params.creator ?? null, minAUM === null ? null : String(minAUM), params.search ?? null, limit]);
  const rows = res.rows as Array<Record<string, unknown>>;
  const data = rows.map((row) => ({
    ...row,
    source: "onchain-indexed",
    asOf: row.nav_as_of ?? row.refreshed_at,
  }));
  return {
    status: 200,
    payload: {
      data,
      count: data.length,
      sort: sortKey,
      source: "onchain-indexed",
      note: "Empty list means nothing is indexed yet — never fabricated.",
    },
  };
}

/** GET /baskets/:pubkey — baskets row + latest NAV + holdings + drift. */
export async function basketDetail(db: PgLike, pubkey: string): Promise<{ status: number; payload: unknown }> {
  const bRes = await db.query(
    `SELECT pubkey, factory, creator, treasury, share_mint, nonce, created_at,
            metadata_hash, metadata_json, num_constituents, constituents,
            weights_bps, entry_fee_bps, exit_fee_bps, management_fee_bps,
            last_fee_accrual_ts
     FROM baskets WHERE pubkey = $1`,
    [pubkey],
  );
  const basket = bRes.rows[0] as Record<string, unknown> | undefined;
  if (!basket) {
    return { status: 404, payload: { error: { code: "NOT_INDEXED", message: `basket ${pubkey} is not indexed by this backend` } } };
  }
  const navRes = await db.query(
    `SELECT nav::text AS nav, supply::text AS supply, share_price::text AS share_price,
            price_source, ts FROM nav_snapshots WHERE basket = $1 ORDER BY ts DESC LIMIT 1`,
    [pubkey],
  );
  const hRes = await db.query(
    `SELECT mint, raw_amount::text AS raw_amount, multiplier::text AS multiplier,
            scaled_amount::text AS scaled_amount, decimals, updated_at
     FROM vault_holdings WHERE basket = $1`,
    [pubkey],
  );
  const holdings = hRes.rows as Array<{ mint: string; scaled_amount: string }>;
  const weights = (basket.weights_bps as number[]) ?? [];
  const drift = holdings.length > 0 ? computeDriftExact(holdings.map((h) => h.scaled_amount), weights) : null;
  const navRow = (navRes.rows[0] ?? null) as Record<string, unknown> | null;
  return {
    status: 200,
    payload: {
      data: {
        ...basket,
        nav: navRow
          ? {
              value: navRow.nav,
              supply: navRow.supply,
              sharePrice: navRow.share_price,
              priceSource: navRow.price_source,
              asOf: navRow.ts,
              source: "onchain-indexed",
            }
          : null,
        drift: drift ? { actualWeightsBps: drift.actualWeightsBps, driftBps: drift.driftBps, basis: "vault_holdings.scaled_amount vs baskets.weights_bps (AGENTS §17)" } : null,
        holdings: holdings.map((h) => ({ ...h, source: "onchain-indexed" })),
        source: "onchain-indexed",
        asOf: navRow?.ts ?? (basket.created_at as string),
      },
    },
  };
}

/** GET /baskets/:pubkey/holdings — raw + multiplier + scaled + decimals. */
export async function basketHoldings(db: PgLike, pubkey: string): Promise<{ status: number; payload: unknown }> {
  const exists = await db.query("SELECT 1 FROM baskets WHERE pubkey = $1", [pubkey]);
  if (exists.rows.length === 0) {
    return { status: 404, payload: { error: { code: "NOT_INDEXED", message: `basket ${pubkey} is not indexed by this backend` } } };
  }
  const res = await db.query(
    `SELECT mint, raw_amount::text AS raw_amount, multiplier::text AS multiplier,
            scaled_amount::text AS scaled_amount, decimals, updated_at
     FROM vault_holdings WHERE basket = $1 ORDER BY mint`,
    [pubkey],
  );
  const rows = res.rows as Array<Record<string, unknown>>;
  return {
    status: 200,
    payload: {
      data: rows.map((r) => ({ ...r, multiplier: Number(r.multiplier), source: "onchain-indexed", asOf: r.updated_at })),
      count: rows.length,
      note: "raw_amount/scaled_amount are decimal strings (integer-safe); scaled = raw × multiplier / 10^decimals",
    },
  };
}

/** GET /baskets/:pubkey/nav/history?interval=&from=&to= */
export async function navHistory(
  db: PgLike,
  pubkey: string,
  params: { interval?: string | null; from?: string | null; to?: string | null },
): Promise<{ status: number; payload: unknown }> {
  const exists = await db.query("SELECT 1 FROM baskets WHERE pubkey = $1", [pubkey]);
  if (exists.rows.length === 0) {
    return { status: 404, payload: { error: { code: "NOT_INDEXED", message: `basket ${pubkey} is not indexed by this backend` } } };
  }
  let fromDate: Date | null = null;
  let toDate: Date | null = null;
  if (params.from) {
    fromDate = new Date(params.from);
    if (Number.isNaN(fromDate.getTime())) {
      return { status: 400, payload: { error: { code: "INVALID_TIME_RANGE", message: `from is not a valid ISO date: ${params.from}` } } };
    }
  }
  if (params.to) {
    toDate = new Date(params.to);
    if (Number.isNaN(toDate.getTime())) {
      return { status: 400, payload: { error: { code: "INVALID_TIME_RANGE", message: `to is not a valid ISO date: ${params.to}` } } };
    }
  }
  const interval = params.interval || null;
  if (interval && !NAV_INTERVALS[interval]) {
    return { status: 400, payload: { error: { code: "INVALID_INTERVAL", message: `interval must be one of ${Object.keys(NAV_INTERVALS).join("|")}`, supported: Object.keys(NAV_INTERVALS) } } };
  }

  let rows: Array<Record<string, unknown>>;
  if (interval) {
    // Bucketed series (OHLC-style aggregation per interval via date_bin).
    const values: unknown[] = [NAV_INTERVALS[interval], pubkey];
    const conds = ["basket = $2"];
    if (fromDate) { values.push(fromDate); conds.push(`ts >= $${values.length}`); }
    if (toDate) { values.push(toDate); conds.push(`ts <= $${values.length}`); }
    const res = await db.query(
      `SELECT date_bin($1::interval, ts, TIMESTAMPTZ '2000-01-01') AS bucket,
              (array_agg(nav ORDER BY ts))[1]::text AS open,
              (array_agg(nav ORDER BY ts DESC))[1]::text AS close,
              MIN(nav)::text AS low, MAX(nav)::text AS high,
              AVG(nav)::text AS avg, MAX(supply)::text AS supply,
              COUNT(*) AS points
       FROM nav_snapshots WHERE ${conds.join(" AND ")}
       GROUP BY bucket ORDER BY bucket ASC LIMIT 5000`,
      values,
    );
    rows = res.rows as Array<Record<string, unknown>>;
  } else {
    const values: unknown[] = [pubkey];
    const conds = ["basket = $1"];
    if (fromDate) { values.push(fromDate); conds.push(`ts >= $${values.length}`); }
    if (toDate) { values.push(toDate); conds.push(`ts <= $${values.length}`); }
    const res = await db.query(
      `SELECT ts, nav::text AS nav, supply::text AS supply, share_price::text AS share_price, price_source
       FROM nav_snapshots WHERE ${conds.join(" AND ")}
       ORDER BY ts ASC LIMIT 5000`,
      values,
    );
    rows = res.rows as Array<Record<string, unknown>>;
  }

  return {
    status: 200,
    payload: {
      data: rows.map((r) => ({ ...r, source: "onchain-indexed" })),
      count: rows.length,
      interval: interval ?? "raw",
      source: "onchain-indexed",
    },
  };
}

/** GET /baskets/:pubkey/performance — 24h/7d/30d/90d/inception from snapshots. */
export async function basketPerformance(db: PgLike, pubkey: string): Promise<{ status: number; payload: unknown }> {
  const exists = await db.query("SELECT 1 FROM baskets WHERE pubkey = $1", [pubkey]);
  if (exists.rows.length === 0) {
    return { status: 404, payload: { error: { code: "NOT_INDEXED", message: `basket ${pubkey} is not indexed by this backend` } } };
  }
  const res = await db.query(
    `SELECT
       (SELECT nav::text FROM nav_snapshots WHERE basket = $1 ORDER BY ts DESC LIMIT 1) AS latest_nav,
       (SELECT ts FROM nav_snapshots WHERE basket = $1 ORDER BY ts DESC LIMIT 1) AS latest_ts,
       (SELECT nav::text FROM nav_snapshots WHERE basket = $1 AND ts <= NOW() - interval '24 hours' ORDER BY ts DESC LIMIT 1) AS b24,
       (SELECT ts FROM nav_snapshots WHERE basket = $1 AND ts <= NOW() - interval '24 hours' ORDER BY ts DESC LIMIT 1) AS b24_ts,
       (SELECT nav::text FROM nav_snapshots WHERE basket = $1 AND ts <= NOW() - interval '7 days' ORDER BY ts DESC LIMIT 1) AS b7d,
       (SELECT ts FROM nav_snapshots WHERE basket = $1 AND ts <= NOW() - interval '7 days' ORDER BY ts DESC LIMIT 1) AS b7d_ts,
       (SELECT nav::text FROM nav_snapshots WHERE basket = $1 AND ts <= NOW() - interval '30 days' ORDER BY ts DESC LIMIT 1) AS b30d,
       (SELECT ts FROM nav_snapshots WHERE basket = $1 AND ts <= NOW() - interval '30 days' ORDER BY ts DESC LIMIT 1) AS b30d_ts,
       (SELECT nav::text FROM nav_snapshots WHERE basket = $1 AND ts <= NOW() - interval '90 days' ORDER BY ts DESC LIMIT 1) AS b90d,
       (SELECT ts FROM nav_snapshots WHERE basket = $1 AND ts <= NOW() - interval '90 days' ORDER BY ts DESC LIMIT 1) AS b90d_ts,
       (SELECT nav::text FROM nav_snapshots WHERE basket = $1 ORDER BY ts ASC LIMIT 1) AS b_inception,
       (SELECT ts FROM nav_snapshots WHERE basket = $1 ORDER BY ts ASC LIMIT 1) AS b_inception_ts`,
    [pubkey],
  );
  const row = res.rows[0] as Record<string, unknown> | null;
  if (!row || typeof row.latest_nav !== "string") {
    return {
      status: 404,
      payload: { error: { code: "NOT_INDEXED", message: `no NAV snapshots indexed yet for ${pubkey}` } },
    };
  }
  const latest = { nav: row.latest_nav as string, ts: row.latest_ts as string };
  const perf = computePerformanceFromBaselines(latest, [
    { window: "24h", nav: row.b24 as string | null, ts: row.b24_ts as string | null },
    { window: "7d", nav: row.b7d as string | null, ts: row.b7d_ts as string | null },
    { window: "30d", nav: row.b30d as string | null, ts: row.b30d_ts as string | null },
    { window: "90d", nav: row.b90d as string | null, ts: row.b90d_ts as string | null },
    { window: "inception", nav: row.b_inception as string | null, ts: row.b_inception_ts as string | null },
  ]);
  return {
    status: 200,
    payload: {
      data: {
        basket: pubkey,
        latest: perf.latest,
        windows: perf.windows,
        basis: "nav_snapshots — pct = (latest − baseline) / baseline, exact fixed point",
        source: "onchain-indexed",
        asOf: latest.ts,
      },
    },
  };
}

/** GET /whitelist — whitelisted_mints. */
export async function listWhitelist(db: PgLike): Promise<{ status: number; payload: unknown }> {
  const res = await db.query(
    `SELECT mint, decimals, status, price_source, multiplier::text AS multiplier, updated_at
     FROM whitelisted_mints ORDER BY mint`,
  );
  const rows = res.rows as Array<Record<string, unknown>>;
  return {
    status: 200,
    payload: {
      data: rows.map((r) => ({ ...r, multiplier: Number(r.multiplier), source: "onchain-indexed", asOf: r.updated_at })),
      count: rows.length,
      source: "onchain-indexed",
    },
  };
}

/** GET /creators/:pubkey — creator_stats + created baskets. */
export async function creatorDetail(db: PgLike, creator: string): Promise<{ status: number; payload: unknown }> {
  const statsRes = await db.query(
    `SELECT basket_count, total_aum::text AS total_aum, total_fees_earned::text AS total_fees_earned, updated_at
     FROM creator_stats WHERE creator = $1`,
    [creator],
  );
  const basketsRes = await db.query(
    `SELECT b.pubkey, b.share_mint, b.created_at, r.nav::text AS nav, r.refreshed_at
     FROM baskets b
     LEFT JOIN basket_rankings r ON r.pubkey = b.pubkey
     WHERE b.creator = $1 ORDER BY b.created_at ASC`,
    [creator],
  );
  const baskets = basketsRes.rows as Array<Record<string, unknown>>;
  const stats = (statsRes.rows[0] ?? null) as Record<string, unknown> | null;
  if (!stats && baskets.length === 0) {
    return { status: 404, payload: { error: { code: "NOT_INDEXED", message: `creator ${creator} has no indexed baskets` } } };
  }
  return {
    status: 200,
    payload: {
      data: {
        creator,
        stats,
        baskets: baskets.map((b) => ({ ...b, source: "onchain-indexed" })),
        source: "onchain-indexed",
        asOf: baskets[0]?.refreshed_at ?? stats?.updated_at ?? null,
      },
    },
  };
}

/** GET /users/:pubkey/portfolio — user_positions + latest nav per basket. */
export async function userPortfolio(db: PgLike, user: string): Promise<{ status: number; payload: unknown }> {
  const res = await db.query(
    `SELECT up.basket, up.share_balance::text AS share_balance, up.cost_basis::text AS cost_basis, up.updated_at
     FROM user_positions up WHERE up."user" = $1 ORDER BY up.basket`,
    [user],
  );
  const positions = res.rows as Array<Record<string, unknown>>;
  if (positions.length === 0) {
    return { status: 200, payload: { data: [], count: 0, source: "onchain-indexed", note: "no indexed positions for this wallet" } };
  }
  const navs = await db.query(
    `SELECT DISTINCT ON (basket) basket, nav::text AS nav, supply::text AS supply,
            share_price::text AS share_price, ts
     FROM nav_snapshots WHERE basket = ANY($1) ORDER BY basket, ts DESC`,
    [positions.map((p) => p.basket as string)],
  );
  const navByBasket = new Map((navs.rows as Array<Record<string, unknown>>).map((n) => [n.basket as string, n]));
  const data = positions.map((p) => {
    const nav = navByBasket.get(p.basket as string) ?? null;
    const balance = BigInt(p.share_balance as string);
    const sharePrice = nav ? BigInt((nav.share_price as string).split(".")[0] || "0") : 0n;
    return {
      ...p,
      nav: nav ? { value: nav.nav, supply: nav.supply, asOf: nav.ts } : null,
      // value estimate in the same raw terms as share_price = nav/supply
      estimatedValue: nav && sharePrice > 0n ? (balance * sharePrice).toString() : null,
      source: "onchain-indexed",
      asOf: nav?.ts ?? p.updated_at,
    };
  });
  return { status: 200, payload: { data, count: data.length, source: "onchain-indexed" } };
}

/** GET /health — indexer lag, last slot, holdings staleness (spec §8). */
export async function healthReport(
  db: PgLike | null,
  status: () => SubsystemStatus,
  now: () => Date = () => new Date(),
): Promise<{ status: number; payload: unknown }> {
  const base = {
    ok: true,
    version: API_VERSION,
    ts: now().toISOString(),
    subsystems: status(),
  };
  if (!isPgLike(db)) {
    return {
      status: 200,
      payload: { ...base, db: { connected: false, note: "DB-less mode: API serves no indexed data" } },
    };
  }
  try {
    const res = await db.query(
      `SELECT (SELECT COUNT(*) FROM baskets) AS basket_count,
              (SELECT MAX(slot) FROM events) AS last_slot,
              (SELECT MAX(ts) FROM events) AS last_event_ts,
              (SELECT COUNT(*) FROM vault_holdings) AS holdings_rows,
              (SELECT MAX(updated_at) FROM vault_holdings) AS holdings_updated_at`,
    );
    const row = res.rows[0] as Record<string, unknown>;
    const lastEventTs = row.last_event_ts ? new Date(row.last_event_ts as string) : null;
    const holdingsUpdatedAt = row.holdings_updated_at ? new Date(row.holdings_updated_at as string) : null;
    const nowMs = now().getTime();
    return {
      status: 200,
      payload: {
        ...base,
        db: {
          connected: true,
          basketCount: Number(row.basket_count),
          lastSlot: row.last_slot ?? null,
          lastEventTs: lastEventTs?.toISOString() ?? null,
          indexerLagSeconds: lastEventTs ? Math.floor((nowMs - lastEventTs.getTime()) / 1000) : null,
          holdings: {
            rows: Number(row.holdings_rows),
            lastUpdatedAt: holdingsUpdatedAt?.toISOString() ?? null,
            staleSeconds: holdingsUpdatedAt ? Math.floor((nowMs - holdingsUpdatedAt.getTime()) / 1000) : null,
          },
        },
      },
    };
  } catch (err) {
    return {
      status: 200,
      payload: {
        ...base,
        db: { connected: true, degraded: true, note: `health query failed: ${err instanceof Error ? err.message : err}` },
      },
    };
  }
}

// --- handler -----------------------------------------------------------------

export function createHandler(ctx: ApiContext = { db: null }) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = url.pathname;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }

    // --- Health ---
    if (pathname === "/api/v1/health" && req.method === "GET") {
      const db = await resolveDb(ctx);
      const report = await healthReport(db, ctx.status ?? defaultStatus, ctx.now);
      sendJson(res, report.status, report.payload);
      return;
    }

    // --- Providers ---
    if (pathname === "/api/v1/providers" && req.method === "GET") {
      sendJson(res, 200, { data: [
        { id: "backed", name: "Backed Finance", type: "xstock", mints: Object.entries(TICKER_MINTS).map(([ticker, mint]) => ({ ticker, mint, decimals: 6, status: "Active", priceSource: `jupiter:${ticker}` })) },
        { id: "jupiter", name: "Jupiter Price v6", type: "price", url: "https://price.jup.ag/v6/price" },
        { id: "yahoo", name: "Yahoo Finance", type: "price", url: "https://query2.finance.yahoo.com" },
        { id: "nasdaq", name: "Nasdaq Benchmark (QQQ)", type: "index", symbol: "QQQ" },
      ] });
      return;
    }

    // --- xStocks list ---
    if (pathname === "/api/v1/xstocks" && req.method === "GET") {
      const data = Object.entries(TICKER_MINTS).map(([ticker, mint]) => ({
        ticker, mint, yahooSymbol: YAHOO_MAP[ticker], decimals: 6, provider: "backed", status: "Active",
      }));
      sendJson(res, 200, { data });
      return;
    }

    // --- Price compare: xStock (Jupiter) vs gerçek (Yahoo) ---
    // GET /api/v1/prices/compare?tickers=TSLAx,NVDAx
    if (pathname === "/api/v1/prices/compare" && req.method === "GET") {
      const tickersParam = url.searchParams.get("tickers");
      const tickers = tickersParam ? tickersParam.split(",") : undefined;
      const data = await comparePrices(tickers);
      sendJson(res, 200, { data, ts: new Date().toISOString(), note: "diffBps = (jupiter - yahoo)/yahoo*10000, LEGAL: xStock is structured instrument" });
      return;
    }

    // --- Chart series: xStock + Yahoo + Nasdaq overlay ---
    // GET /api/v1/prices/chart?tickers=TSLAx&range=1mo
    if (pathname === "/api/v1/prices/chart" && req.method === "GET") {
      const ticker = url.searchParams.get("ticker") || "TSLAx";
      const range = url.searchParams.get("range") || "1mo";
      const series = await getChartSeries(ticker, range);
      sendJson(res, 200, { data: series });
      return;
    }

    // --- Yahoo proxy: GET /api/v1/prices/yahoo?symbol=TSLA&range=1mo ---
    if (pathname === "/api/v1/prices/yahoo" && req.method === "GET") {
      const symbol = url.searchParams.get("symbol") || "TSLA";
      const range = url.searchParams.get("range") || "1mo";
      try {
        const s = await fetchYahooSeries(symbol, range, "1d");
        sendJson(res, 200, { data: s });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        sendError(res, 502, "YAHOO_FETCH_FAILED", message);
      }
      return;
    }

    // --- Market overview: Nasdaq (QQQ, SPY, DIA) ---
    if (pathname === "/api/v1/market/overview" && req.method === "GET") {
      const range = url.searchParams.get("range") || "1mo";
      const symbols = ["QQQ", "SPY", "DIA", "^IXIC"];
      const results = await Promise.all(symbols.map((s) => fetchYahooSeries(s, range, "1d").catch(() => ({ symbol: s, candles: [] })) ));
      // compute % change from first close
      const overview = results.map((r) => {
        const first = r.candles[0]?.close ?? 0;
        const last = r.candles[r.candles.length - 1]?.close ?? 0;
        const changePct = first ? (last - first) / first * 100 : 0;
        return { symbol: r.symbol, first, last, changePct, candles: r.candles, count: r.candles.length };
      });
      sendJson(res, 200, { data: overview, range });
      return;
    }

    // --- Core spec §8 routes (DB-backed) ---
    if (pathname === "/api/v1/baskets" && req.method === "GET") {
      const db = await resolveDb(ctx);
      if (!isPgLike(db)) { sendError(res, 503, "DB_UNAVAILABLE", "no Postgres configured — indexed basket data is unavailable (never fabricated)"); return; }
      try {
        const out = await listBaskets(db, {
          sort: url.searchParams.get("sort"),
          creator: url.searchParams.get("creator"),
          minAUM: url.searchParams.get("minAUM"),
          search: url.searchParams.get("search"),
          limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
        });
        sendJson(res, out.status, out.payload);
      } catch (err) {
        sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "basket list query failed");
      }
      return;
    }

    const basketsMatch = /^\/api\/v1\/baskets\/([^/]+)(\/(holdings|nav\/history|performance))?$/.exec(pathname);
    if (basketsMatch && req.method === "GET") {
      const pubkey = decodeURIComponent(basketsMatch[1]);
      if (!isValidPubkey(pubkey)) {
        sendError(res, 400, "INVALID_PUBKEY", `not a valid Solana pubkey: ${pubkey}`);
        return;
      }
      const sub = basketsMatch[3] ?? null;
      const db = await resolveDb(ctx);
      if (!isPgLike(db)) { sendError(res, 503, "DB_UNAVAILABLE", "no Postgres configured — indexed basket data is unavailable (never fabricated)"); return; }
      try {
        let out: { status: number; payload: unknown };
        if (sub === "holdings") out = await basketHoldings(db, pubkey);
        else if (sub === "nav/history") {
          out = await navHistory(db, pubkey, {
            interval: url.searchParams.get("interval"),
            from: url.searchParams.get("from"),
            to: url.searchParams.get("to"),
          });
        } else if (sub === "performance") out = await basketPerformance(db, pubkey);
        else out = await basketDetail(db, pubkey);
        sendJson(res, out.status, out.payload);
      } catch (err) {
        sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "basket query failed");
      }
      return;
    }

    if (pathname === "/api/v1/whitelist" && req.method === "GET") {
      const db = await resolveDb(ctx);
      if (!isPgLike(db)) { sendError(res, 503, "DB_UNAVAILABLE", "no Postgres configured — indexed whitelist data is unavailable (never fabricated)"); return; }
      try {
        const out = await listWhitelist(db);
        sendJson(res, out.status, out.payload);
      } catch (err) {
        sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "whitelist query failed");
      }
      return;
    }

    const creatorsMatch = /^\/api\/v1\/creators\/([^/]+)$/.exec(pathname);
    if (creatorsMatch && req.method === "GET") {
      const db = await resolveDb(ctx);
      if (!isPgLike(db)) { sendError(res, 503, "DB_UNAVAILABLE", "no Postgres configured — indexed creator data is unavailable (never fabricated)"); return; }
      try {
        const out = await creatorDetail(db, decodeURIComponent(creatorsMatch[1]));
        sendJson(res, out.status, out.payload);
      } catch (err) {
        sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "creator query failed");
      }
      return;
    }

    const portfolioMatch = /^\/api\/v1\/users\/([^/]+)\/portfolio$/.exec(pathname);
    if (portfolioMatch && req.method === "GET") {
      const db = await resolveDb(ctx);
      if (!isPgLike(db)) { sendError(res, 503, "DB_UNAVAILABLE", "no Postgres configured — indexed portfolio data is unavailable (never fabricated)"); return; }
      try {
        const out = await userPortfolio(db, decodeURIComponent(portfolioMatch[1]));
        sendJson(res, out.status, out.payload);
      } catch (err) {
        sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "portfolio query failed");
      }
      return;
    }

    // --- Zap quotes (spec §8; Jupiter legs, never fabricated) ---
    if ((pathname === "/api/v1/quotes/zap-in" || pathname === "/api/v1/quotes/zap-out") && req.method === "POST") {
      const body = await readJsonBody(req);
      if (body === null) { sendError(res, 400, "INVALID_JSON", "request body must be a JSON object"); return; }
      const qctx: QuoteContext = { db: ctx.db, cache: ctx.cache ?? null, fetchImpl: ctx.fetchImpl, now: ctx.now };
      // Quotes resolve the DB lazily like the GET routes (null → handlers 503).
      if (!qctx.db) qctx.db = await connectFromEnv();
      try {
        const out = pathname.endsWith("zap-in")
          ? await handleZapIn(qctx, body)
          : await handleZapOut(qctx, body);
        sendJson(res, out.status, out.payload);
      } catch (err) {
        sendError(res, 500, "QUOTE_ERROR", err instanceof Error ? err.message : "quote handler failed");
      }
      return;
    }

    sendError(res, 404, "NOT_FOUND", `no route for ${req.method} ${pathname}`);
  };
}

function defaultStatus(): SubsystemStatus {
  return {
    db: { connected: false, schemaApplied: null },
    indexer: { enabled: false, running: false },
    navEngine: { enabled: false, running: false },
    feeCrank: { enabled: false, running: false },
  };
}

if (process.argv[1]?.endsWith("server.ts")) {
  const handler = createHandler();
  http.createServer(handler).listen(3001, () => console.log("FolioX API on :3001 (DB-backed + providers + price compare)"));
}
