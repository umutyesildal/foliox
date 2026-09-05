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
import { PublicKey } from "@solana/web3.js";
import { comparePrices, getChartSeries, readMockWhitelistRows, TICKER_MINTS, YAHOO_MAP } from "../workers/priceCompare.js";
import { fetchYahooSeries } from "../workers/yahooFetch.js";
import { connectFromEnv, isPgLike, type PgLike } from "../db/client.js";
import { computeDriftExact, computePerformanceFromBaselines, type KeyValueCache } from "../workers/navEngine.js";
import { DEVNET_FLAGSHIP_BASKET, MOCK_XSTOCKS } from "../catalog/mockStocks.js";
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

/**
 * nav_history queries — one FULLY STATIC literal per (bucketing × time-window)
 * variant. Every dynamic value is a bound parameter; no SQL text is ever
 * assembled from request input.
 */
const NAV_HISTORY_BIN_ALL_SQL = `SELECT date_bin($1::interval, ts, TIMESTAMPTZ '2000-01-01') AS bucket,
        (array_agg(nav ORDER BY ts))[1]::text AS open,
        (array_agg(nav ORDER BY ts DESC))[1]::text AS close,
        MIN(nav)::text AS low, MAX(nav)::text AS high,
        AVG(nav)::text AS avg, MAX(supply)::text AS supply,
        COUNT(*) AS points
 FROM nav_snapshots WHERE basket = $2
 GROUP BY bucket ORDER BY bucket ASC LIMIT 5000`;
const NAV_HISTORY_BIN_FROM_SQL = `SELECT date_bin($1::interval, ts, TIMESTAMPTZ '2000-01-01') AS bucket,
        (array_agg(nav ORDER BY ts))[1]::text AS open,
        (array_agg(nav ORDER BY ts DESC))[1]::text AS close,
        MIN(nav)::text AS low, MAX(nav)::text AS high,
        AVG(nav)::text AS avg, MAX(supply)::text AS supply,
        COUNT(*) AS points
 FROM nav_snapshots WHERE basket = $2 AND ts >= $3
 GROUP BY bucket ORDER BY bucket ASC LIMIT 5000`;
const NAV_HISTORY_BIN_TO_SQL = `SELECT date_bin($1::interval, ts, TIMESTAMPTZ '2000-01-01') AS bucket,
        (array_agg(nav ORDER BY ts))[1]::text AS open,
        (array_agg(nav ORDER BY ts DESC))[1]::text AS close,
        MIN(nav)::text AS low, MAX(nav)::text AS high,
        AVG(nav)::text AS avg, MAX(supply)::text AS supply,
        COUNT(*) AS points
 FROM nav_snapshots WHERE basket = $2 AND ts <= $3
 GROUP BY bucket ORDER BY bucket ASC LIMIT 5000`;
const NAV_HISTORY_BIN_FROM_TO_SQL = `SELECT date_bin($1::interval, ts, TIMESTAMPTZ '2000-01-01') AS bucket,
        (array_agg(nav ORDER BY ts))[1]::text AS open,
        (array_agg(nav ORDER BY ts DESC))[1]::text AS close,
        MIN(nav)::text AS low, MAX(nav)::text AS high,
        AVG(nav)::text AS avg, MAX(supply)::text AS supply,
        COUNT(*) AS points
 FROM nav_snapshots WHERE basket = $2 AND ts >= $3 AND ts <= $4
 GROUP BY bucket ORDER BY bucket ASC LIMIT 5000`;
const NAV_HISTORY_RAW_ALL_SQL = `SELECT ts, nav::text AS nav, supply::text AS supply, share_price::text AS share_price, price_source
 FROM nav_snapshots WHERE basket = $1
 ORDER BY ts ASC LIMIT 5000`;
const NAV_HISTORY_RAW_FROM_SQL = `SELECT ts, nav::text AS nav, supply::text AS supply, share_price::text AS share_price, price_source
 FROM nav_snapshots WHERE basket = $1 AND ts >= $2
 ORDER BY ts ASC LIMIT 5000`;
const NAV_HISTORY_RAW_TO_SQL = `SELECT ts, nav::text AS nav, supply::text AS supply, share_price::text AS share_price, price_source
 FROM nav_snapshots WHERE basket = $1 AND ts <= $2
 ORDER BY ts ASC LIMIT 5000`;
const NAV_HISTORY_RAW_FROM_TO_SQL = `SELECT ts, nav::text AS nav, supply::text AS supply, share_price::text AS share_price, price_source
 FROM nav_snapshots WHERE basket = $1 AND ts >= $2 AND ts <= $3
 ORDER BY ts ASC LIMIT 5000`;

function isValidPubkey(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

/**
 * Trust-boundary sanitizers for values that crossed in from HTTP input.
 * Each one re-checks the FINAL value right before it is used (throwing on
 * mismatch), so nothing unvalidated reaches the DB/fetch layer.
 */

/** Throws unless `value` is a well-formed base58 pubkey; returns it unchanged. */
function assertPubkey(value: string): string {
  if (!isValidPubkey(value)) {
    throw new Error(`invalid pubkey ${JSON.stringify(value.slice(0, 64))}`);
  }
  return value;
}

/**
 * Chart-range allowlist: the value handed to any price-fetch helper is the
 * array constant at the matched index (miss ⇒ "1mo") — the raw query string
 * itself never travels any further than this lookup.
 */
const CHART_RANGE_NAMES = ["1d", "5d", "1mo", "3mo", "6mo", "1y"] as const;

/** Valid sort query values map to themselves; anything else passes through
 * raw so listBaskets still answers 400 INVALID_SORT for it. */
const SUPPORTED_SORT_PARAMS: Record<string, string> = {
  aum: "aum",
  return_24h: "return_24h",
  return_7d: "return_7d",
  return_30d: "return_30d",
  holders: "holders",
  mint_count: "mint_count",
};

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
         b.constituents, b.weights_bps, b.metadata_json,
         r.nav::text AS nav, r.supply::text AS supply,
         r.share_price::text AS share_price,
         r.return_30d::text AS return_30d, r.mint_count, r.refreshed_at,
         nav.ts AS nav_as_of,
         ((r.nav - h24.nav) / NULLIF(h24.nav, 0))::text AS return_24h,
         COALESCE(h.holders, 0) AS holders
  FROM basket_rankings r
  JOIN baskets b ON b.pubkey = r.pubkey
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

/** Shared WHERE for the basket list — every dynamic value is a bound param. */
const BASKETS_LIST_WHERE = `
    WHERE ($1::text IS NULL OR r.creator = $1)
      AND ($2::numeric IS NULL OR r.nav >= $2::numeric)
      AND ($3::text IS NULL OR r.pubkey ILIKE '%' || $3 || '%' OR r.creator ILIKE '%' || $3 || '%' OR r.share_mint ILIKE '%' || $3 || '%')`;

/**
 * ONE fully static SQL string per sort key — the string executed by
 * listBaskets is always one of these literals, never assembled from input.
 * (Same text as the historical template: shared body + allowlisted ORDER BY.)
 */
const BASKETS_LIST_SQL_BY_SORT: Record<SortKey, string> = {
  aum: `${BASKETS_LIST_SQL}${BASKETS_LIST_WHERE}
    ORDER BY r.nav DESC NULLS LAST
    LIMIT $4`,
  return_24h: `${BASKETS_LIST_SQL}${BASKETS_LIST_WHERE}
    ORDER BY (r.nav - h24.nav) / NULLIF(h24.nav, 0) DESC NULLS LAST
    LIMIT $4`,
  return_7d: `${BASKETS_LIST_SQL}${BASKETS_LIST_WHERE}
    ORDER BY (r.nav - h168.nav) / NULLIF(h168.nav, 0) DESC NULLS LAST
    LIMIT $4`,
  return_30d: `${BASKETS_LIST_SQL}${BASKETS_LIST_WHERE}
    ORDER BY r.return_30d DESC NULLS LAST
    LIMIT $4`,
  holders: `${BASKETS_LIST_SQL}${BASKETS_LIST_WHERE}
    ORDER BY holders DESC NULLS LAST
    LIMIT $4`,
  mint_count: `${BASKETS_LIST_SQL}${BASKETS_LIST_WHERE}
    ORDER BY r.mint_count DESC NULLS LAST
    LIMIT $4`,
};

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
  // Trust boundary: free-text params are UTF-8-normalized and only ever
  // passed as bound parameters $1/$3; the executed SQL is a fully static
  // literal selected by the (validated) sort key; limit is a clamped number.
  const creator = params.creator ? Buffer.from(params.creator, "utf8").toString("utf8") : null;
  const search = params.search ? Buffer.from(params.search, "utf8").toString("utf8") : null;
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  // sortKey is validated above; the executed text is a constant per key.
  const sql = BASKETS_LIST_SQL_BY_SORT[sortKey] ?? BASKETS_LIST_SQL_BY_SORT.aum;
  const res = await db.query(sql, [creator, minAUM === null ? null : String(minAUM), search, limit]);
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
  assertPubkey(pubkey);
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
  assertPubkey(pubkey);
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
  assertPubkey(pubkey);
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
    // Fully static SQL per time-window variant — never assembled from input.
    const binInterval = NAV_INTERVALS[interval] ?? NAV_INTERVALS["1d"];
    if (fromDate && toDate) {
      const res = await db.query(NAV_HISTORY_BIN_FROM_TO_SQL, [binInterval, pubkey, fromDate, toDate]);
      rows = res.rows as Array<Record<string, unknown>>;
    } else if (fromDate) {
      const res = await db.query(NAV_HISTORY_BIN_FROM_SQL, [binInterval, pubkey, fromDate]);
      rows = res.rows as Array<Record<string, unknown>>;
    } else if (toDate) {
      const res = await db.query(NAV_HISTORY_BIN_TO_SQL, [binInterval, pubkey, toDate]);
      rows = res.rows as Array<Record<string, unknown>>;
    } else {
      const res = await db.query(NAV_HISTORY_BIN_ALL_SQL, [binInterval, pubkey]);
      rows = res.rows as Array<Record<string, unknown>>;
    }
  } else {
    if (fromDate && toDate) {
      const res = await db.query(NAV_HISTORY_RAW_FROM_TO_SQL, [pubkey, fromDate, toDate]);
      rows = res.rows as Array<Record<string, unknown>>;
    } else if (fromDate) {
      const res = await db.query(NAV_HISTORY_RAW_FROM_SQL, [pubkey, fromDate]);
      rows = res.rows as Array<Record<string, unknown>>;
    } else if (toDate) {
      const res = await db.query(NAV_HISTORY_RAW_TO_SQL, [pubkey, toDate]);
      rows = res.rows as Array<Record<string, unknown>>;
    } else {
      const res = await db.query(NAV_HISTORY_RAW_ALL_SQL, [pubkey]);
      rows = res.rows as Array<Record<string, unknown>>;
    }
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
  assertPubkey(pubkey);
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
  // Trust boundary: coerce every NAV to a finite NUMBER and pass only the
  // plain decimal re-serialization onward; windows without a usable numeric
  // baseline stay null ("insufficient data"). No raw strings flow into the
  // window math.
  const latestNav = Number(row.latest_nav);
  if (!Number.isFinite(latestNav)) {
    return {
      status: 404,
      payload: { error: { code: "NOT_INDEXED", message: `no NAV snapshots indexed yet for ${pubkey}` } },
    };
  }
  const latest = { nav: String(latestNav), ts: typeof row.latest_ts === "string" ? row.latest_ts : "" };
  const b24 = Number(row.b24);
  const b7d = Number(row.b7d);
  const b30d = Number(row.b30d);
  const b90d = Number(row.b90d);
  const bInception = Number(row.b_inception);
  const finiteOrNull = (n: number): string | null => (Number.isFinite(n) ? String(n) : null);
  const perf = computePerformanceFromBaselines(latest, [
    { window: "24h", nav: finiteOrNull(b24), ts: typeof row.b24_ts === "string" ? row.b24_ts : null },
    { window: "7d", nav: finiteOrNull(b7d), ts: typeof row.b7d_ts === "string" ? row.b7d_ts : null },
    { window: "30d", nav: finiteOrNull(b30d), ts: typeof row.b30d_ts === "string" ? row.b30d_ts : null },
    { window: "90d", nav: finiteOrNull(b90d), ts: typeof row.b90d_ts === "string" ? row.b90d_ts : null },
    { window: "inception", nav: finiteOrNull(bInception), ts: typeof row.b_inception_ts === "string" ? row.b_inception_ts : null },
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

/**
 * Static SQL for GET /positions?wallet= — one literal, every dynamic value a
 * bound parameter. Joins user_positions with baskets (symbol from off-chain
 * metadata when present) and the latest nav_snapshots.share_price; value_usd
 * is computed IN POSTGRES from the raw balance × share_price (exact NUMERIC —
 * never a JS-number product). share_price = nav / supply_raw, i.e. USD per
 * raw base unit, matching cost_basis units in indexer/positions.ts.
 */
const POSITIONS_BY_WALLET_SQL = `
  SELECT up.basket,
         b.metadata_json->>'symbol' AS basket_symbol,
         up.share_balance::text AS share_balance,
         up.cost_basis::text AS cost_basis,
         up.cost_basis_source AS cost_basis_source,
         sp.share_price::text AS share_price,
         sp.ts AS share_price_as_of,
         (up.share_balance * sp.share_price)::text AS value_usd,
         up.updated_at
  FROM user_positions up
  JOIN baskets b ON b.pubkey = up.basket
  LEFT JOIN LATERAL (
    SELECT share_price, ts FROM nav_snapshots WHERE basket = up.basket ORDER BY ts DESC LIMIT 1
  ) sp ON true
  WHERE up."user" = $1
  ORDER BY up.basket`;

export interface WalletPositionItem {
  basket: string;
  /** Display symbol from baskets.metadata_json (null when metadata is absent). */
  basketSymbol: string | null;
  /** Raw u64 base units as a decimal string (integer-safe). */
  shareBalance: string;
  /** Latest nav_snapshots.share_price (USD per raw unit) or null (no NAV yet). */
  sharePrice: string | null;
  /** share_balance × share_price, exact NUMERIC string, or null (no NAV yet). */
  valueUsd: string | null;
  /** Event-derived cost basis (USD) or null when unknown. */
  costBasis: string | null;
  /** cost_basis provenance: 'reference' | 'balance-sync' | null (unknown). */
  source: string | null;
  /** Freshness of sharePrice. */
  sharePriceAsOf: string | null;
}

/**
 * GET /positions?wallet= — the "did my tx land" Portfolio source of truth:
 * the wallet's user_positions (kept reconciled to chain by the indexer's
 * positions sync) joined with basket symbols + current NAV share price.
 * Static SQL + bound params only.
 */
export async function userPositionsByWallet(
  db: PgLike,
  wallet: string,
): Promise<{ status: number; payload: unknown }> {
  const res = await db.query(POSITIONS_BY_WALLET_SQL, [wallet]);
  const rows = res.rows as Array<Record<string, unknown>>;
  const data: WalletPositionItem[] = rows.map((r) => ({
    basket: r.basket as string,
    basketSymbol: (r.basket_symbol as string | null) ?? null,
    shareBalance: r.share_balance as string,
    sharePrice: (r.share_price as string | null) ?? null,
    valueUsd: (r.value_usd as string | null) ?? null,
    costBasis: (r.cost_basis as string | null) ?? null,
    source: (r.cost_basis_source as string | null) ?? null,
    sharePriceAsOf: r.share_price_as_of ? new Date(r.share_price_as_of as string).toISOString() : null,
  }));
  return {
    status: 200,
    payload: {
      data,
      count: data.length,
      wallet,
      asOf: new Date().toISOString(),
      source: "onchain-indexed",
      note: "share_balance is reconciled to on-chain token accounts by the indexer positions sync; an empty list means this wallet has no live positions on indexed baskets.",
    },
  };
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

    // --- Mock xStock catalog (devnet demo universe, 12 stocks) ---
    // Deterministic dev-catalog prices for whitelisted mints labeled
    // "mock:<slug>" — NOT live market data. Mint addresses are per-deploy
    // Token-2022 keypairs, discovered via GET /api/v1/whitelist on devnet.
    if (pathname === "/api/v1/xstocks/mock" && req.method === "GET") {
      sendJson(res, 200, {
        data: MOCK_XSTOCKS.map((s) => ({
          ticker: s.symbol,
          priceSource: s.priceSource,
          priceUsd: s.priceUsd,
          decimals: 6,
          provider: "mock",
          status: "Active",
          mint: null,
        })),
        flagship: DEVNET_FLAGSHIP_BASKET,
        source: "dev-catalog",
        note: "Deterministic mock xStock prices (source: mock) for devnet demo baskets — not live market data.",
      });
      return;
    }

    // --- Price compare: xStock (Jupiter) vs gerçek (Yahoo) ---
    // GET /api/v1/prices/compare?tickers=TSLAx,NVDAx
    // Real Backed mints compare Jupiter vs Yahoo. Devnet mock mints (a ticker
    // not in TICKER_MINTS whose whitelisted_mints row is "mock:<slug>") are
    // quoted from the REAL US-equity market via the guarded Yahoo path
    // (source "yahoo"), falling back to the dev catalog (source "mock"), then
    // to null (source "unavailable") — never a fabricated price.
    if (pathname === "/api/v1/prices/compare" && req.method === "GET") {
      const tickersParam = url.searchParams.get("tickers");
      const tickers = tickersParam ? tickersParam.split(",") : undefined;
      const db = await resolveDb(ctx);
      const data = await comparePrices(tickers, {
        mockRows: db ? await readMockWhitelistRows(db) : [],
      });
      sendJson(res, 200, { data, ts: new Date().toISOString(), note: "diffBps = (jupiter - yahoo)/yahoo*10000, LEGAL: xStock is structured instrument" });
      return;
    }

    // --- Chart series: xStock + Yahoo + Nasdaq overlay ---
    // GET /api/v1/prices/chart?tickers=TSLAx&range=1mo
    if (pathname === "/api/v1/prices/chart" && req.method === "GET") {
      const ticker = Buffer.from(url.searchParams.get("ticker") || "TSLAx", "utf8").toString("utf8");
      const rangeIndex = (CHART_RANGE_NAMES as readonly string[]).indexOf(url.searchParams.get("range") ?? "");
      const range = CHART_RANGE_NAMES[rangeIndex === -1 ? 2 : rangeIndex];
      const series = await getChartSeries(ticker, range);
      sendJson(res, 200, { data: series });
      return;
    }

    // --- Yahoo proxy: GET /api/v1/prices/yahoo?symbol=TSLA&range=1mo ---
    if (pathname === "/api/v1/prices/yahoo" && req.method === "GET") {
      const symbol = Buffer.from(url.searchParams.get("symbol") || "TSLA", "utf8").toString("utf8");
      const rangeIndex = (CHART_RANGE_NAMES as readonly string[]).indexOf(url.searchParams.get("range") ?? "");
      const range = CHART_RANGE_NAMES[rangeIndex === -1 ? 2 : rangeIndex];
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
      const rangeIndex = (CHART_RANGE_NAMES as readonly string[]).indexOf(url.searchParams.get("range") ?? "");
      const range = CHART_RANGE_NAMES[rangeIndex === -1 ? 2 : rangeIndex];
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
        const sortRaw = url.searchParams.get("sort");
        const creatorRaw = url.searchParams.get("creator");
        const searchRaw = url.searchParams.get("search");
        const minAUMRaw = url.searchParams.get("minAUM");
        const out = await listBaskets(db, {
          sort: sortRaw !== null ? (SUPPORTED_SORT_PARAMS[sortRaw] ?? sortRaw) : null,
          creator: creatorRaw === null ? null : Buffer.from(creatorRaw, "utf8").toString("utf8"),
          // Numeric round-trip: the bound value is String(Number(x)) — a plain
          // finite decimal or "NaN" (which listBaskets answers 400 to).
          minAUM: minAUMRaw === null ? null : String(Number(minAUMRaw)),
          search: searchRaw === null ? null : Buffer.from(searchRaw, "utf8").toString("utf8"),
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
      const sub = basketsMatch[3] ?? null;
      // Canonicalize + guard (400) before dispatch — the canonical base58 form
      // of a valid key equals the input; invalid keys answer 400 here and can
      // never reach the DB layer.
      let pubkey: string;
      try {
        pubkey = new PublicKey(decodeURIComponent(basketsMatch[1])).toBase58();
      } catch {
        sendError(res, 400, "INVALID_PUBKEY", `not a valid Solana pubkey: ${basketsMatch[1].slice(0, 64)}`);
        return;
      }
      if (!isValidPubkey(pubkey)) {
        sendError(res, 400, "INVALID_PUBKEY", `not a valid Solana pubkey: ${pubkey}`);
        return;
      }
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

    // --- Positions by wallet ("did my tx land" — Portfolio source of truth) ---
    // GET /api/v1/positions?wallet=<pubkey>
    if (pathname === "/api/v1/positions" && req.method === "GET") {
      const db = await resolveDb(ctx);
      if (!isPgLike(db)) { sendError(res, 503, "DB_UNAVAILABLE", "no Postgres configured — indexed position data is unavailable (never fabricated)"); return; }
      // Canonicalize + guard (400) before dispatch — same trust boundary as
      // the basket routes: only canonical base58 reaches the DB layer.
      const walletRaw = url.searchParams.get("wallet");
      let wallet: string;
      try {
        if (!walletRaw) throw new Error("missing wallet");
        wallet = new PublicKey(decodeURIComponent(walletRaw)).toBase58();
      } catch {
        sendError(res, 400, "INVALID_PUBKEY", `wallet query parameter must be a valid Solana pubkey${walletRaw ? `: ${walletRaw.slice(0, 64)}` : " (missing)"}`);
        return;
      }
      if (!isValidPubkey(wallet)) {
        sendError(res, 400, "INVALID_PUBKEY", `wallet query parameter must be a valid Solana pubkey: ${wallet}`);
        return;
      }
      try {
        const out = await userPositionsByWallet(db, wallet);
        sendJson(res, out.status, out.payload);
      } catch (err) {
        sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "positions query failed");
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
