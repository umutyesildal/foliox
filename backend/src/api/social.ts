/**
 * api/social.ts — the social trading surface (V0.2): profiles, follows,
 * thesis posts, likes, comments, the unified trade+thesis feed, per-wallet
 * trade history / equity curve, and the leaderboard.
 *
 * Design rules carried over from server.ts:
 *   * every handler is `(db, …) → {status, payload}` and is exported for
 *     vitest with the fake-PgLike pattern (no live Postgres in tests);
 *   * SQL is always composed from STATIC string fragments selected by
 *     validated keys — request input only ever travels as bound parameters;
 *   * BIGINT/NUMERIC leave Postgres as decimal strings and only become
 *     JS numbers for display fields that cannot exceed 2^53;
 *   * no endpoint fabricates data — missing price/history is null;
 *   * privacy: a profiles row with is_public=false is excluded from the
 *     feed and leaderboard (wallets with no profile row are public — the
 *     on-chain ledger already is);
 *   * writes are the ONLY authenticated surface (api/auth.ts) — the backend
 *     still never signs or submits transactions (AGENTS.md §2 #5).
 */
import type http from "http";
import { PublicKey } from "@solana/web3.js";
import type { PgLike } from "../db/client.js";
import {
  consumeNonce,
  issueNonce,
  isValidWalletPubkey,
  signToken,
  socialAuthSecret,
  verifyWalletSignature,
  walletFromAuthHeader,
} from "./auth.js";

// --- response helpers (same envelope as server.ts) ---------------------------

type Res = http.ServerResponse;

function sendJson(res: Res, status: number, payload: unknown): void {
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

function sendError(res: Res, status: number, code: string, message: string, extra?: Record<string, unknown>): void {
  sendJson(res, status, { error: { code, message, ...extra } });
}

const SHARE_DECIMALS = 1e6; // share tokens are 6-decimal Token-2022 mints

/** Trim Postgres numeric text (trailing zeros) for display strings. */
function trimDecimals(s: string | null): string | null {
  if (s === null) return null;
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}

/** USD display number from an exact numeric string (null-safe, 2dp). */
function usdNumber(s: string | null): number | null {
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function clampLimit(raw: string | null, fallback = 20, max = 50): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), 1), max);
}

/**
 * Feed/history cursor: base64url of `v1:<iso timestamp>`. Pagination is
 * keyset-on-ts (strictly older than the cursor); rows sharing an exact
 * timestamp across page boundaries are rare and accepted for v1.
 */
function encodeCursor(ts: Date): string {
  return Buffer.from(`v1:${ts.toISOString()}`, "utf8").toString("base64url");
}

function decodeCursor(raw: string | null): { ts: Date } | { error: string } {
  if (raw === null) return { ts: new Date(8640000000000000) }; // +∞ sentinel: no filter
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return { error: "cursor is not valid base64url" };
  }
  const match = /^v1:(.+)$/.exec(decoded);
  if (!match) return { error: "cursor must be v1:<iso timestamp>" };
  const ts = new Date(match[1]);
  if (Number.isNaN(ts.getTime())) return { error: `cursor timestamp is not ISO: ${match[1]}` };
  return { ts };
}

/** Canonicalize a path-parameter pubkey; throws on invalid input. */
function assertWallet(value: string): string {
  const canonical = new PublicKey(value).toBase58(); // throws on garbage
  if (!isValidWalletPubkey(canonical)) throw new Error(`invalid wallet ${value.slice(0, 64)}`);
  return canonical;
}

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

// --- profile -----------------------------------------------------------------

const PROFILE_STATS_SQL = `
  SELECT COUNT(DISTINCT e.sig) AS trade_count
  FROM events e
  WHERE e.data->>'user' = $1 AND e.type IN ('Minted','Redeemed')`;

const PROFILE_ROW_SQL = `
  SELECT p.wallet, p.handle, p.display_name, p.avatar_url, p.bio, p.is_public, p.created_at,
         (SELECT COUNT(*) FROM follows f WHERE f.followee = p.wallet) AS followers,
         (SELECT COUNT(*) FROM follows f WHERE f.follower = p.wallet) AS following,
         (${PROFILE_STATS_SQL.replace("$1", "p.wallet")}) AS trade_count
  FROM profiles p
  WHERE p.wallet = $1`;

const PROFILE_VIEWER_SQL = `SELECT 1 FROM follows WHERE follower = $1 AND followee = $2`;

export interface ProfileShape {
  wallet: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  isPublic: boolean;
  createdAt: string | null;
}

/** GET /users/:wallet/profile — public; viewer adds isFollowing when authed. */
export async function getUserProfile(
  db: PgLike,
  wallet: string,
  viewerWallet: string | null,
): Promise<{ status: number; payload: unknown }> {
  const canonical = assertWallet(wallet);
  const rowRes = await db.query(PROFILE_ROW_SQL, [canonical]);
  const row = rowRes.rows[0] as Record<string, unknown> | undefined;
  let profile: ProfileShape | null = null;
  let stats: { followers: number; following: number; tradeCount: number };
  if (row) {
    profile = {
      wallet: canonical,
      handle: (row.handle as string | null) ?? null,
      displayName: (row.display_name as string | null) ?? null,
      avatarUrl: (row.avatar_url as string | null) ?? null,
      bio: (row.bio as string | null) ?? null,
      isPublic: row.is_public === true,
      createdAt: row.created_at ? new Date(row.created_at as string).toISOString() : null,
    };
    stats = {
      followers: Number(row.followers ?? 0),
      following: Number(row.following ?? 0),
      tradeCount: Number(row.trade_count ?? 0),
    };
  } else {
    // No claimed profile — the wallet may still have on-chain trades.
    const statsRes = await db.query(PROFILE_STATS_SQL, [canonical]);
    stats = {
      followers: 0,
      following: 0,
      tradeCount: Number((statsRes.rows[0] as Record<string, unknown> | undefined)?.trade_count ?? 0),
    };
  }
  let viewer: { isFollowing: boolean } | null = null;
  if (viewerWallet) {
    const followRes = await db.query(PROFILE_VIEWER_SQL, [viewerWallet, canonical]);
    viewer = { isFollowing: followRes.rows.length > 0 };
  }
  return {
    status: 200,
    payload: { wallet: canonical, profile, stats, viewer },
  };
}

export interface ProfileUpdateInput {
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  isPublic?: boolean;
}

export function validateProfileUpdate(body: Record<string, unknown>): { ok: true; value: ProfileUpdateInput } | { ok: false; error: string } {
  const value: ProfileUpdateInput = {};
  if ("handle" in body) {
    const h = body.handle;
    if (h !== null && h !== undefined) {
      if (typeof h !== "string" || !HANDLE_RE.test(h)) return { ok: false, error: "handle must be 3-20 chars of a-z, 0-9, _" };
      value.handle = h;
    } else {
      value.handle = null; // explicit clear
    }
  }
  if ("displayName" in body) {
    const d = body.displayName;
    if (d === null) value.displayName = null;
    else if (typeof d !== "string") return { ok: false, error: "displayName must be a string" };
    else if (d.length > 40) return { ok: false, error: "displayName must be at most 40 chars" };
    else value.displayName = d;
  }
  if ("avatarUrl" in body) {
    const a = body.avatarUrl;
    if (a === null) value.avatarUrl = null;
    else if (typeof a !== "string") return { ok: false, error: "avatarUrl must be a string" };
    else if (!a.startsWith("https://")) return { ok: false, error: "avatarUrl must be an https:// URL" };
    else if (a.length > 500) return { ok: false, error: "avatarUrl must be at most 500 chars" };
    else value.avatarUrl = a;
  }
  if ("bio" in body) {
    const b = body.bio;
    if (b === null) value.bio = null;
    else if (typeof b !== "string") return { ok: false, error: "bio must be a string" };
    else if (b.length > 280) return { ok: false, error: "bio must be at most 280 chars" };
    else value.bio = b;
  }
  if ("isPublic" in body) {
    if (typeof body.isPublic !== "boolean") return { ok: false, error: "isPublic must be a boolean" };
    value.isPublic = body.isPublic;
  }
  return { ok: true, value };
}

/**
 * PUT /me/profile — upsert; absent fields keep their value, explicit null
 * clears. SET fragments come from a fixed allowlist (values bound); handle
 * uniqueness violations surface as 409 HANDLE_TAKEN.
 */
export async function putMyProfile(
  db: PgLike,
  wallet: string,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: unknown }> {
  const canonical = assertWallet(wallet);
  const parsed = validateProfileUpdate(body);
  if (!parsed.ok) {
    return { status: 400, payload: { error: { code: "INVALID_PROFILE", message: parsed.error } } };
  }
  const value = parsed.value;
  const sets: string[] = [];
  const params: unknown[] = [canonical];
  const add = (fragment: string, param: unknown): void => {
    params.push(param);
    sets.push(fragment.replace("$?", `$${params.length}`));
  };
  if ("handle" in value) add("handle = $?", value.handle);
  if ("displayName" in value) add("display_name = $?", value.displayName);
  if ("avatarUrl" in value) add("avatar_url = $?", value.avatarUrl);
  if ("bio" in value) add("bio = $?", value.bio);
  if ("isPublic" in value) add("is_public = $?", value.isPublic);
  if (sets.length === 0) {
    return { status: 400, payload: { error: { code: "INVALID_PROFILE", message: "no profile fields provided" } } };
  }
  const insertRes = await db.query(
    `INSERT INTO profiles (wallet) VALUES ($1) ON CONFLICT (wallet) DO NOTHING`,
    [canonical],
  );
  void insertRes;
  try {
    await db.query(
      `UPDATE profiles SET ${sets.join(", ")}, updated_at = NOW() WHERE wallet = $1`,
      params,
    );
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
      return { status: 409, payload: { error: { code: "HANDLE_TAKEN", message: "that handle is already claimed" } } };
    }
    throw err;
  }
  const rowRes = await db.query(
    `SELECT wallet, handle, display_name, avatar_url, bio, is_public, created_at FROM profiles WHERE wallet = $1`,
    [canonical],
  );
  const row = rowRes.rows[0] as Record<string, unknown>;
  return {
    status: 200,
    payload: {
      profile: {
        wallet: canonical,
        handle: (row.handle as string | null) ?? null,
        displayName: (row.display_name as string | null) ?? null,
        avatarUrl: (row.avatar_url as string | null) ?? null,
        bio: (row.bio as string | null) ?? null,
        isPublic: row.is_public === true,
        createdAt: row.created_at ? new Date(row.created_at as string).toISOString() : null,
      } satisfies ProfileShape,
    },
  };
}

// --- trade history + equity curve ---------------------------------------------

/**
 * Static SQL for /users/:wallet/history — events ledger (the indexer already
 * attributes Minted/Redeemed to data->>'user') joined with basket names and
 * the latest at-or-before-event share price. shares/usd stay exact NUMERIC
 * strings; usdValue becomes a display number in JS (2dp) or stays null.
 */
const HISTORY_BASE_SQL = `
  SELECT h.sig, h.ts, h.trade_type, h.basket, h.basket_name,
         (h.shares_raw / ${SHARE_DECIMALS})::text AS shares,
         h.share_price::text AS share_price,
         (h.shares_raw * h.share_price / ${SHARE_DECIMALS})::text AS usd_value
  FROM (
    SELECT e.sig, e.ts, e.type AS trade_type, e.basket,
           b.metadata_json->>'name' AS basket_name,
           CASE WHEN e.type = 'Minted' THEN (e.data->>'netShares')::numeric
                ELSE ((e.data->>'sharesBurned')::numeric - (e.data->>'exitFeeShares')::numeric) END AS shares_raw,
           sp.share_price
    FROM events e
    JOIN baskets b ON b.pubkey = e.basket
    LEFT JOIN LATERAL (
      SELECT share_price FROM nav_snapshots WHERE basket = e.basket AND ts <= e.ts ORDER BY ts DESC LIMIT 1
    ) sp ON true
    WHERE e.type IN ('Minted','Redeemed') AND e.data->>'user' = $1
  ) h`;

export async function getUserHistory(
  db: PgLike,
  wallet: string,
  params: { limit?: number; cursor?: string | null },
): Promise<{ status: number; payload: unknown }> {
  const canonical = assertWallet(wallet);
  const cursor = decodeCursor(params.cursor ?? null);
  if ("error" in cursor) {
    return { status: 400, payload: { error: { code: "INVALID_CURSOR", message: cursor.error } } };
  }
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const hasCursor = params.cursor != null;
  const sql = hasCursor
    ? `${HISTORY_BASE_SQL} WHERE h.ts < $2 ORDER BY h.ts DESC, h.sig DESC LIMIT $3`
    : `${HISTORY_BASE_SQL} ORDER BY h.ts DESC, h.sig DESC LIMIT $2`;
  const values = hasCursor ? [canonical, cursor.ts, limit] : [canonical, limit];
  const res = await db.query(sql, values);
  const rows = res.rows as Array<Record<string, unknown>>;
  const items = rows.map((r) => ({
    sig: r.sig as string,
    ts: new Date(r.ts as string).toISOString(),
    type: r.trade_type as "Minted" | "Redeemed",
    basket: r.basket as string,
    basketName: (r.basket_name as string | null) ?? null,
    shares: trimDecimals(r.shares as string),
    sharePrice: usdNumber(r.share_price as string | null),
    usdValue: usdNumber(r.usd_value as string | null),
  }));
  const last = rows[rows.length - 1];
  return {
    status: 200,
    payload: {
      wallet: canonical,
      items,
      nextCursor: items.length === limit && last ? encodeCursor(new Date(last.ts as string)) : null,
    },
  };
}

const EQUITY_CURVE_SQL = `
  SELECT ts, value_usd::text AS value_usd, cost_basis::text AS cost_basis
  FROM user_value_snapshots
  WHERE wallet = $1 AND ts >= NOW() - make_interval(days => $2::int)
  ORDER BY ts ASC LIMIT 2000`;

/** GET /users/:wallet/equity-curve?days=30 — empty until the snapshotter runs. */
export async function getUserEquityCurve(
  db: PgLike,
  wallet: string,
  days: number,
): Promise<{ status: number; payload: unknown }> {
  const canonical = assertWallet(wallet);
  const windowDays = Math.min(Math.max(Math.floor(days) || 30, 1), 365);
  const res = await db.query(EQUITY_CURVE_SQL, [canonical, windowDays]);
  const rows = res.rows as Array<Record<string, unknown>>;
  return {
    status: 200,
    payload: {
      wallet: canonical,
      days: windowDays,
      points: rows.map((r) => ({
        ts: new Date(r.ts as string).toISOString(),
        valueUsd: usdNumber(r.value_usd as string),
        costBasis: usdNumber(r.cost_basis as string | null),
      })),
    },
  };
}

// --- unified feed ---------------------------------------------------------------

/**
 * Feed = Minted/Redeemed events ∪ thesis posts, keyset-paginated on ts.
 * Branch fragments are static; the only per-request inputs are bound params
 * ($1 cursor ts, $2 follow list when scope=following, $3 limit).
 */
const FEED_TRADES_INNER = `
    SELECT e.sig, e.ts, e.type AS trade_type, (e.data->>'user') AS wallet, e.basket,
           b.metadata_json->>'name' AS basket_name,
           CASE WHEN e.type = 'Minted' THEN (e.data->>'netShares')::numeric
                ELSE ((e.data->>'sharesBurned')::numeric - (e.data->>'exitFeeShares')::numeric) END AS shares_raw,
           sp.share_price, p.handle, p.display_name, p.avatar_url
    FROM events e
    JOIN baskets b ON b.pubkey = e.basket
    LEFT JOIN LATERAL (
      SELECT share_price FROM nav_snapshots WHERE basket = e.basket AND ts <= e.ts ORDER BY ts DESC LIMIT 1
    ) sp ON true
    LEFT JOIN profiles p ON p.wallet = e.data->>'user'
    WHERE e.type IN ('Minted','Redeemed')
      AND NOT EXISTS (SELECT 1 FROM profiles px WHERE px.wallet = e.data->>'user' AND px.is_public = false)`;

export interface FeedItem {
  kind: "trade" | "thesis";
  ts: string;
  wallet: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  basket: string | null;
  basketName: string | null;
  // trade-only
  sig?: string;
  type?: "Minted" | "Redeemed";
  shares?: string | null;
  usdValue?: number | null;
  // thesis-only
  id?: number;
  title?: string;
  body?: string;
  likeCount?: number;
  commentCount?: number;
}

/**
 * GET /feed — the verified-activity stream. scope=following requires the
 * authed wallet (401 otherwise). Privacy-exempted wallets never appear.
 */
export async function getFeed(
  db: PgLike,
  params: {
    scope: "all" | "following";
    type: "all" | "trades" | "theses";
    limit?: number;
    cursor?: string | null;
    viewerWallet: string | null;
  },
): Promise<{ status: number; payload: unknown }> {
  if (params.scope === "following" && !params.viewerWallet) {
    return { status: 401, payload: { error: { code: "UNAUTHORIZED", message: "scope=following requires wallet auth" } } };
  }
  const cursor = decodeCursor(params.cursor ?? null);
  if ("error" in cursor) {
    return { status: 400, payload: { error: { code: "INVALID_CURSOR", message: cursor.error } } };
  }
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);

  const tradesBranch = params.type !== "theses";
  const postsBranch = params.type !== "trades";
  const following = params.scope === "following";
  const hasCursor = params.cursor != null;

  // scope=following filters by the wallets THE VIEWER FOLLOWS — resolved here
  // (an empty follow list honestly yields an empty feed, never "all").
  let followList: string[] = [];
  if (following) {
    const followRes = await db.query(`SELECT followee FROM follows WHERE follower = $1`, [params.viewerWallet]);
    followList = followRes.rows.map((r) => r.followee as string);
  }

  // Assign parameter positions in a fixed order so every combination of
  // (cursor × following) keeps its numbering consistent.
  let nextParam = 1;
  const cursorParam = hasCursor ? `$${nextParam++}` : null;
  const followParam = following ? `$${nextParam++}` : null;
  const limitParam = `$${nextParam++}`;

  // Static fragment assembly — branch selection and the cursor predicate are
  // chosen by validated keys; the follow list and cursor ts are bound params.
  const tradeSelect = `
    SELECT 'trade'::text AS kind, s.sig AS item_key, s.ts, s.wallet,
           s.handle, s.display_name, s.avatar_url, s.basket, s.basket_name,
           s.trade_type, (s.shares_raw / ${SHARE_DECIMALS})::text AS shares,
           (s.shares_raw * s.share_price / ${SHARE_DECIMALS})::text AS usd_value,
           NULL::bigint AS post_id, NULL::text AS title, NULL::text AS body,
           NULL::bigint AS like_count, NULL::bigint AS comment_count
    FROM (${FEED_TRADES_INNER}${following ? ` AND (e.data->>'user') = ANY(${followParam}::text[])` : ""}) s`;
  const postSelect = `
    SELECT 'thesis'::text AS kind, po.id::text AS item_key, po.created_at AS ts, po.wallet,
           p.handle, p.display_name, p.avatar_url, po.basket,
           b.metadata_json->>'name' AS basket_name,
           NULL::text AS trade_type, NULL::text AS shares, NULL::text AS usd_value,
           po.id AS post_id, po.title, po.body_md AS body,
           (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = po.id) AS like_count,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id = po.id) AS comment_count
    FROM posts po
    LEFT JOIN baskets b ON b.pubkey = po.basket
    LEFT JOIN profiles p ON p.wallet = po.wallet
    WHERE NOT EXISTS (SELECT 1 FROM profiles px WHERE px.wallet = po.wallet AND px.is_public = false)${following ? ` AND po.wallet = ANY(${followParam}::text[])` : ""}`;
  const unionSql = [tradesBranch ? tradeSelect : null, postsBranch ? postSelect : null]
    .filter((s): s is string => s !== null)
    .join("\n  UNION ALL\n");
  const cursorClause = cursorParam ? `WHERE ts < ${cursorParam}::timestamptz\n  ` : "";
  const sql = `SELECT * FROM (\n${unionSql}\n) feed\n  ${cursorClause}ORDER BY ts DESC, item_key DESC\n  LIMIT ${limitParam}`;

  const values: unknown[] = [];
  if (cursorParam) values.push(cursor.ts);
  if (followParam) values.push(followList);
  values.push(limit);

  const res = await db.query(sql, values);
  const rows = res.rows as Array<Record<string, unknown>>;
  const items: FeedItem[] = rows.map((r) => {
    const base = {
      ts: new Date(r.ts as string).toISOString(),
      wallet: r.wallet as string,
      handle: (r.handle as string | null) ?? null,
      displayName: (r.display_name as string | null) ?? null,
      avatarUrl: (r.avatar_url as string | null) ?? null,
      basket: (r.basket as string | null) ?? null,
      basketName: (r.basket_name as string | null) ?? null,
    };
    if (r.kind === "trade") {
      return {
        ...base,
        kind: "trade" as const,
        sig: r.item_key as string,
        type: r.trade_type as "Minted" | "Redeemed",
        shares: trimDecimals(r.shares as string),
        usdValue: usdNumber(r.usd_value as string | null),
      };
    }
    const body = r.body as string;
    const truncated = body.length > 280;
    return {
      ...base,
      kind: "thesis" as const,
      id: Number(r.post_id),
      title: r.title as string,
      body: truncated ? `${body.slice(0, 280)}…` : body,
      ...(truncated ? { bodyTruncated: true } : {}),
      likeCount: Number(r.like_count ?? 0),
      commentCount: Number(r.comment_count ?? 0),
    };
  });
  const last = rows[rows.length - 1];
  return {
    status: 200,
    payload: {
      items,
      nextCursor: items.length === limit && last ? encodeCursor(new Date(last.ts as string)) : null,
      scope: params.scope,
      type: params.type,
      note: "Feed items come from the on-chain event ledger and thesis posts — never fabricated. Privacy-hidden profiles are excluded.",
    },
  };
}

// --- leaderboard ----------------------------------------------------------------

const LEADERBOARD_ELIGIBILITY_VAL = `
  val AS (
    SELECT up."user" AS wallet,
           SUM(up.share_balance * sp.share_price) AS value_usd,
           SUM(up.cost_basis) AS cost_basis,
           COUNT(*) AS position_count
    FROM user_positions up
    JOIN LATERAL (
      SELECT share_price FROM nav_snapshots WHERE basket = up.basket ORDER BY ts DESC LIMIT 1
    ) sp ON true
    WHERE up.share_balance > 0
    GROUP BY 1
  ),
  eligibility AS (
    SELECT e.data->>'user' AS wallet,
           COUNT(*) FILTER (WHERE e.type = 'Minted') AS mint_count,
           MIN(e.ts) AS first_trade
    FROM events e
    WHERE e.type IN ('Minted','Redeemed')
    GROUP BY 1
  )`;

/**
 * GET /leaderboard — all-time ranks by cost-basis ROI; 7d/30d rank by
 * windowed ROI from user_value_snapshots (empty until the snapshotter has
 * history — an empty leaderboard there is honest, not broken). Anti-sybil:
 * ≥2 mints, first trade ≥7 days old, live value > 0, public profile.
 */
export async function getLeaderboard(db: PgLike, window: string): Promise<{ status: number; payload: unknown }> {
  if (window !== "7d" && window !== "30d" && window !== "all") {
    return {
      status: 400,
      payload: { error: { code: "INVALID_WINDOW", message: "window must be one of 7d|30d|all" } },
    };
  }
  let sql: string;
  let values: unknown[];
  if (window === "all") {
    sql = `
      WITH ${LEADERBOARD_ELIGIBILITY_VAL}
      SELECT v.wallet, p.handle, p.display_name, p.avatar_url,
             v.value_usd::text AS value_usd, v.cost_basis::text AS cost_basis_usd,
             v.position_count, el.first_trade,
             ((v.value_usd - v.cost_basis) / NULLIF(v.cost_basis, 0))::text AS roi
      FROM val v
      JOIN eligibility el ON el.wallet = v.wallet
      LEFT JOIN profiles p ON p.wallet = v.wallet
      WHERE el.mint_count >= 2
        AND el.first_trade <= NOW() - interval '7 days'
        AND v.cost_basis IS NOT NULL AND v.cost_basis > 0 AND v.value_usd > 0
        AND NOT EXISTS (SELECT 1 FROM profiles px WHERE px.wallet = v.wallet AND px.is_public = false)
      ORDER BY ((v.value_usd - v.cost_basis) / NULLIF(v.cost_basis, 0)) DESC NULLS LAST
      LIMIT 50`;
    values = [];
  } else {
    const days = window === "7d" ? 7 : 30;
    sql = `
      WITH ${LEADERBOARD_ELIGIBILITY_VAL},
      win AS (
        SELECT s.wallet,
               (ARRAY_AGG(s.value_usd ORDER BY s.ts ASC))[1] AS start_value,
               (ARRAY_AGG(s.value_usd ORDER BY s.ts DESC))[1] AS current_value,
               COUNT(*) AS snapshot_count
        FROM user_value_snapshots s
        WHERE s.ts >= NOW() - make_interval(days => $1::int)
        GROUP BY s.wallet
      )
      SELECT w.wallet, p.handle, p.display_name, p.avatar_url,
             w.current_value::text AS value_usd, v.cost_basis::text AS cost_basis_usd,
             v.position_count, el.first_trade,
             ((w.current_value - w.start_value) / NULLIF(w.start_value, 0))::text AS roi
      FROM win w
      JOIN val v ON v.wallet = w.wallet
      JOIN eligibility el ON el.wallet = w.wallet
      LEFT JOIN profiles p ON p.wallet = w.wallet
      WHERE w.snapshot_count >= 2 AND w.start_value > 0 AND w.current_value > 0
        AND el.mint_count >= 2
        AND el.first_trade <= NOW() - interval '7 days'
        AND NOT EXISTS (SELECT 1 FROM profiles px WHERE px.wallet = w.wallet AND px.is_public = false)
      ORDER BY ((w.current_value - w.start_value) / NULLIF(w.start_value, 0)) DESC NULLS LAST
      LIMIT 50`;
    values = [days];
  }
  const res = await db.query(sql, values);
  const rows = res.rows as Array<Record<string, unknown>>;
  const items = rows.map((r) => {
    const roi = usdNumber(r.roi as string | null);
    return {
      wallet: r.wallet as string,
      handle: (r.handle as string | null) ?? null,
      displayName: (r.display_name as string | null) ?? null,
      avatarUrl: (r.avatar_url as string | null) ?? null,
      roiPct: roi === null ? null : Math.round(roi * 10000) / 100,
      valueUsd: usdNumber(r.value_usd as string),
      costBasisUsd: usdNumber(r.cost_basis_usd as string | null),
      positionCount: Number(r.position_count ?? 0),
      firstTradeAt: r.first_trade ? new Date(r.first_trade as string).toISOString() : null,
    };
  });
  return {
    status: 200,
    payload: {
      window,
      items,
      note: "ROI is estimated from on-chain cost basis (reference pricing) and current NAV — past performance does not guarantee future results.",
    },
  };
}

// --- follows ----------------------------------------------------------------------

const FOLLOWERS_SQL = `
  SELECT f.follower AS wallet, p.handle, p.display_name, p.avatar_url, f.created_at AS ts
  FROM follows f LEFT JOIN profiles p ON p.wallet = f.follower
  WHERE f.followee = $1`;

const FOLLOWING_SQL = `
  SELECT f.followee AS wallet, p.handle, p.display_name, p.avatar_url, f.created_at AS ts
  FROM follows f LEFT JOIN profiles p ON p.wallet = f.followee
  WHERE f.follower = $1`;

export async function getFollowList(
  db: PgLike,
  wallet: string,
  direction: "followers" | "following",
  params: { limit?: number; cursor?: string | null },
): Promise<{ status: number; payload: unknown }> {
  const canonical = assertWallet(wallet);
  const cursor = decodeCursor(params.cursor ?? null);
  if ("error" in cursor) {
    return { status: 400, payload: { error: { code: "INVALID_CURSOR", message: cursor.error } } };
  }
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const hasCursor = params.cursor != null;
  const base = direction === "followers" ? FOLLOWERS_SQL : FOLLOWING_SQL;
  const sql = hasCursor
    ? `${base} AND f.created_at < $2 ORDER BY f.created_at DESC LIMIT $3`
    : `${base} ORDER BY f.created_at DESC LIMIT $2`;
  const values = hasCursor ? [canonical, cursor.ts, limit] : [canonical, limit];
  const res = await db.query(sql, values);
  const rows = res.rows as Array<Record<string, unknown>>;
  const items = rows.map((r) => ({
    wallet: r.wallet as string,
    handle: (r.handle as string | null) ?? null,
    displayName: (r.display_name as string | null) ?? null,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    ts: new Date(r.ts as string).toISOString(),
  }));
  const last = rows[rows.length - 1];
  return {
    status: 200,
    payload: { wallet: canonical, direction, items, nextCursor: items.length === limit && last ? encodeCursor(new Date(last.ts as string)) : null },
  };
}

export async function setFollow(
  db: PgLike,
  follower: string,
  followee: string,
  follow: boolean,
): Promise<{ status: number; payload: unknown }> {
  const followerCanonical = assertWallet(follower);
  const followeeCanonical = assertWallet(followee);
  if (followerCanonical === followeeCanonical) {
    return { status: 400, payload: { error: { code: "SELF_FOLLOW", message: "you cannot follow your own wallet" } } };
  }
  const exists = await db.query(`SELECT 1 FROM profiles WHERE wallet = $1`, [followeeCanonical]);
  if (exists.rows.length === 0) {
    return { status: 404, payload: { error: { code: "PROFILE_REQUIRED", message: "that wallet has not claimed a profile yet" } } };
  }
  if (follow) {
    await db.query(
      `INSERT INTO follows (follower, followee) VALUES ($1, $2) ON CONFLICT (follower, followee) DO NOTHING`,
      [followerCanonical, followeeCanonical],
    );
  } else {
    await db.query(`DELETE FROM follows WHERE follower = $1 AND followee = $2`, [followerCanonical, followeeCanonical]);
  }
  const countRes = await db.query(
    `SELECT COUNT(*) AS n FROM follows WHERE followee = $1`,
    [followeeCanonical],
  );
  return {
    status: 200,
    payload: {
      following: follow,
      followerCount: Number((countRes.rows[0] as Record<string, unknown>).n),
    },
  };
}

// --- posts / theses ----------------------------------------------------------------

const POST_SELECT_SQL = `
  SELECT po.id, po.wallet, po.kind, po.basket, po.title, po.body_md, po.created_at, po.updated_at,
         p.handle, p.display_name, p.avatar_url,
         b.metadata_json->>'name' AS basket_name,
         (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = po.id) AS like_count,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = po.id) AS comment_count,
         EXISTS (SELECT 1 FROM post_likes pl2 WHERE pl2.post_id = po.id AND pl2.wallet = $2) AS liked_by_me
  FROM posts po
  LEFT JOIN profiles p ON p.wallet = po.wallet
  LEFT JOIN baskets b ON b.pubkey = po.basket
  WHERE po.id = $1`;

interface PostRow extends Record<string, unknown> {
  id: number;
  wallet: string;
  basket: string | null;
  basket_name: string | null;
  title: string;
  body_md: string;
  created_at: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  like_count: string;
  comment_count: string;
  liked_by_me: boolean;
}

function postPayload(row: PostRow, fullBody: boolean): Record<string, unknown> {
  const body = row.body_md;
  const truncated = !fullBody && body.length > 280;
  return {
    id: Number(row.id),
    kind: "thesis",
    wallet: row.wallet,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    basket: row.basket,
    basketName: row.basket_name,
    title: row.title,
    body: truncated ? `${body.slice(0, 280)}…` : body,
    ...(truncated ? { bodyTruncated: true } : {}),
    likeCount: Number(row.like_count ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    likedByMe: row.liked_by_me === true,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function createPost(
  db: PgLike,
  wallet: string,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: unknown }> {
  const canonical = assertWallet(wallet);
  const profile = await db.query(`SELECT 1 FROM profiles WHERE wallet = $1`, [canonical]);
  if (profile.rows.length === 0) {
    return { status: 404, payload: { error: { code: "PROFILE_REQUIRED", message: "claim a profile (PUT /me/profile) before posting" } } };
  }
  if (body.kind !== "thesis") {
    return { status: 400, payload: { error: { code: "INVALID_KIND", message: "kind must be 'thesis'" } } };
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (title.length < 3 || title.length > 120) {
    return { status: 400, payload: { error: { code: "INVALID_TITLE", message: "title must be 3-120 chars" } } };
  }
  if (text.length < 10 || text.length > 5000) {
    return { status: 400, payload: { error: { code: "INVALID_BODY", message: "body must be 10-5000 chars" } } };
  }
  let basket: string | null = null;
  if (body.basket != null) {
    if (typeof body.basket !== "string") {
      return { status: 400, payload: { error: { code: "INVALID_BASKET", message: "basket must be a pubkey string" } } };
    }
    basket = assertWallet(body.basket);
    const exists = await db.query(`SELECT 1 FROM baskets WHERE pubkey = $1`, [basket]);
    if (exists.rows.length === 0) {
      return { status: 404, payload: { error: { code: "BASKET_NOT_INDEXED", message: `basket ${basket} is not indexed` } } };
    }
  }
  const insertRes = await db.query(
    `INSERT INTO posts (wallet, kind, basket, title, body_md) VALUES ($1, 'thesis', $2, $3, $4)
     RETURNING id, created_at`,
    [canonical, basket, title, text],
  );
  const inserted = insertRes.rows[0] as Record<string, unknown>;
  const rowRes = await db.query(POST_SELECT_SQL, [Number(inserted.id), canonical]);
  const row = rowRes.rows[0] as PostRow;
  return { status: 201, payload: { post: postPayload(row, true) } };
}

export async function getPost(
  db: PgLike,
  postId: number,
  viewerWallet: string | null,
): Promise<{ status: number; payload: unknown }> {
  if (!Number.isInteger(postId) || postId <= 0) {
    return { status: 400, payload: { error: { code: "INVALID_POST_ID", message: "post id must be a positive integer" } } };
  }
  const res = await db.query(POST_SELECT_SQL, [postId, viewerWallet]);
  const row = res.rows[0] as PostRow | undefined;
  if (!row) {
    return { status: 404, payload: { error: { code: "NOT_FOUND", message: `post ${postId} does not exist` } } };
  }
  return { status: 200, payload: { post: postPayload(row, true) } };
}

export async function deletePost(db: PgLike, wallet: string, postId: number): Promise<{ status: number; payload: unknown }> {
  const canonical = assertWallet(wallet);
  if (!Number.isInteger(postId) || postId <= 0) {
    return { status: 400, payload: { error: { code: "INVALID_POST_ID", message: "post id must be a positive integer" } } };
  }
  const res = await db.query(`DELETE FROM posts WHERE id = $1 AND wallet = $2 RETURNING id`, [postId, canonical]);
  if (res.rows.length === 0) {
    const exists = await db.query(`SELECT wallet FROM posts WHERE id = $1`, [postId]);
    if (exists.rows.length === 0) {
      return { status: 404, payload: { error: { code: "NOT_FOUND", message: `post ${postId} does not exist` } } };
    }
    return { status: 403, payload: { error: { code: "FORBIDDEN", message: "only the author can delete a post" } } };
  }
  return { status: 200, payload: { deleted: true } };
}

export async function setLike(
  db: PgLike,
  wallet: string,
  postId: number,
  like: boolean,
): Promise<{ status: number; payload: unknown }> {
  const canonical = assertWallet(wallet);
  if (!Number.isInteger(postId) || postId <= 0) {
    return { status: 400, payload: { error: { code: "INVALID_POST_ID", message: "post id must be a positive integer" } } };
  }
  const exists = await db.query(`SELECT 1 FROM posts WHERE id = $1`, [postId]);
  if (exists.rows.length === 0) {
    return { status: 404, payload: { error: { code: "NOT_FOUND", message: `post ${postId} does not exist` } } };
  }
  if (like) {
    await db.query(
      `INSERT INTO post_likes (post_id, wallet) VALUES ($1, $2) ON CONFLICT (post_id, wallet) DO NOTHING`,
      [postId, canonical],
    );
  } else {
    await db.query(`DELETE FROM post_likes WHERE post_id = $1 AND wallet = $2`, [postId, canonical]);
  }
  const countRes = await db.query(`SELECT COUNT(*) AS n FROM post_likes WHERE post_id = $1`, [postId]);
  return {
    status: 200,
    payload: { likeCount: Number((countRes.rows[0] as Record<string, unknown>).n), likedByMe: like },
  };
}

const COMMENTS_SQL = `
  SELECT c.id, c.wallet, c.body, c.created_at, p.handle, p.display_name, p.avatar_url
  FROM comments c LEFT JOIN profiles p ON p.wallet = c.wallet
  WHERE c.post_id = $1 ORDER BY c.created_at ASC LIMIT 200`;

export async function listComments(db: PgLike, postId: number): Promise<{ status: number; payload: unknown }> {
  if (!Number.isInteger(postId) || postId <= 0) {
    return { status: 400, payload: { error: { code: "INVALID_POST_ID", message: "post id must be a positive integer" } } };
  }
  const exists = await db.query(`SELECT 1 FROM posts WHERE id = $1`, [postId]);
  if (exists.rows.length === 0) {
    return { status: 404, payload: { error: { code: "NOT_FOUND", message: `post ${postId} does not exist` } } };
  }
  const res = await db.query(COMMENTS_SQL, [postId]);
  const rows = res.rows as Array<Record<string, unknown>>;
  return {
    status: 200,
    payload: {
      postId,
      items: rows.map((r) => ({
        id: Number(r.id),
        wallet: r.wallet as string,
        handle: (r.handle as string | null) ?? null,
        displayName: (r.display_name as string | null) ?? null,
        avatarUrl: (r.avatar_url as string | null) ?? null,
        body: r.body as string,
        ts: new Date(r.created_at as string).toISOString(),
      })),
    },
  };
}

export async function addComment(
  db: PgLike,
  wallet: string,
  postId: number,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: unknown }> {
  const canonical = assertWallet(wallet);
  if (!Number.isInteger(postId) || postId <= 0) {
    return { status: 400, payload: { error: { code: "INVALID_POST_ID", message: "post id must be a positive integer" } } };
  }
  const exists = await db.query(`SELECT 1 FROM posts WHERE id = $1`, [postId]);
  if (exists.rows.length === 0) {
    return { status: 404, payload: { error: { code: "NOT_FOUND", message: `post ${postId} does not exist` } } };
  }
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (text.length < 1 || text.length > 500) {
    return { status: 400, payload: { error: { code: "INVALID_BODY", message: "comment must be 1-500 chars" } } };
  }
  const res = await db.query(
    `INSERT INTO comments (post_id, wallet, body) VALUES ($1, $2, $3) RETURNING id, created_at`,
    [postId, canonical, text],
  );
  const row = res.rows[0] as Record<string, unknown>;
  return {
    status: 201,
    payload: {
      comment: {
        id: Number(row.id),
        wallet: canonical,
        handle: null,
        displayName: null,
        avatarUrl: null,
        body: text,
        ts: new Date(row.created_at as string).toISOString(),
      },
    },
  };
}

// --- HTTP dispatcher (wired into server.ts) ---------------------------------------

export interface SocialDeps {
  getDb: () => Promise<PgLike | null>;
  readJsonBody: (req: http.IncomingMessage) => Promise<Record<string, unknown> | null>;
  /** Injectable auth secret for tests. */
  authSecret?: string;
}

function bearerWallet(req: http.IncomingMessage, secret: string): string | null {
  return walletFromAuthHeader(req.headers.authorization, secret);
}

function dbGuardPayload(): { status: number; payload: unknown } {
  return {
    status: 503,
    payload: { error: { code: "DB_UNAVAILABLE", message: "no Postgres configured — social data is unavailable (never fabricated)" } },
  };
}

/**
 * Handles every /api/v1 social route; returns false when the request is not
 * a social route so server.ts can fall through to its existing dispatch.
 */
export async function tryHandleSocialRoute(
  deps: SocialDeps,
  req: http.IncomingMessage,
  res: Res,
  url: URL,
): Promise<boolean> {
  const pathname = url.pathname;
  const method = req.method ?? "GET";
  const isSocial =
    pathname.startsWith("/api/v1/users/") ||
    pathname === "/api/v1/feed" ||
    pathname === "/api/v1/leaderboard" ||
    pathname === "/api/v1/me/profile" ||
    pathname.startsWith("/api/v1/posts") ||
    pathname.startsWith("/api/v1/auth/");
  if (!isSocial) return false;

  const secret = deps.authSecret ?? socialAuthSecret();
  const viewerWallet = bearerWallet(req, secret);

  // --- auth (no DB needed) ---
  if (pathname === "/api/v1/auth/nonce" && method === "POST") {
    const body = await deps.readJsonBody(req);
    const wallet = typeof body?.wallet === "string" ? body.wallet : "";
    if (!isValidWalletPubkey(wallet)) {
      sendError(res, 400, "INVALID_WALLET", "wallet must be a base58 Solana pubkey");
      return true;
    }
    sendJson(res, 200, issueNonce(wallet));
    return true;
  }
  if (pathname === "/api/v1/auth/verify" && method === "POST") {
    const body = await deps.readJsonBody(req);
    const wallet = typeof body?.wallet === "string" ? body.wallet : "";
    const nonce = typeof body?.nonce === "string" ? body.nonce : "";
    const signature = typeof body?.signature === "string" ? body.signature : "";
    if (!isValidWalletPubkey(wallet) || !nonce || !signature) {
      sendError(res, 400, "INVALID_REQUEST", "wallet, nonce and signature are required");
      return true;
    }
    if (!consumeNonce(wallet, nonce)) {
      sendError(res, 401, "NONCE_INVALID", "nonce is unknown, expired or already used");
      return true;
    }
    if (!verifyWalletSignature(wallet, nonce, signature)) {
      sendError(res, 401, "SIGNATURE_INVALID", "signature does not verify against the wallet pubkey");
      return true;
    }
    const { token, expiresAt } = signToken(wallet, secret);
    sendJson(res, 200, { token, wallet, expiresAt });
    return true;
  }

  // --- feed / leaderboard (public reads) ---
  if (pathname === "/api/v1/feed" && method === "GET") {
    const scopeRaw = url.searchParams.get("scope");
    const typeRaw = url.searchParams.get("type");
    const scope = scopeRaw === "following" ? "following" : "all";
    const type = typeRaw === "trades" ? "trades" : typeRaw === "theses" ? "theses" : "all";
    const db = await deps.getDb();
    if (!db) {
      const out = dbGuardPayload();
      sendJson(res, out.status, out.payload);
      return true;
    }
    try {
      const out = await getFeed(db, {
        scope,
        type,
        limit: clampLimit(url.searchParams.get("limit")),
        cursor: url.searchParams.get("cursor"),
        viewerWallet,
      });
      sendJson(res, out.status, out.payload);
    } catch (err) {
      sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "feed query failed");
    }
    return true;
  }
  if (pathname === "/api/v1/leaderboard" && method === "GET") {
    const db = await deps.getDb();
    if (!db) {
      const out = dbGuardPayload();
      sendJson(res, out.status, out.payload);
      return true;
    }
    try {
      const out = await getLeaderboard(db, url.searchParams.get("window") ?? "all");
      sendJson(res, out.status, out.payload);
    } catch (err) {
      sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "leaderboard query failed");
    }
    return true;
  }

  // --- /me (auth writes) ---
  if (pathname === "/api/v1/me/profile") {
    if (!viewerWallet) {
      sendError(res, 401, "UNAUTHORIZED", "wallet auth required — POST /auth/nonce then /auth/verify");
      return true;
    }
    const db = await deps.getDb();
    if (!db) {
      const out = dbGuardPayload();
      sendJson(res, out.status, out.payload);
      return true;
    }
    try {
      if (method === "GET") {
        const out = await getUserProfile(db, viewerWallet, viewerWallet);
        sendJson(res, out.status, out.payload);
        return true;
      }
      if (method === "PUT") {
        const body = await deps.readJsonBody(req);
        if (body === null) {
          sendError(res, 400, "INVALID_JSON", "request body must be a JSON object");
          return true;
        }
        const out = await putMyProfile(db, viewerWallet, body);
        sendJson(res, out.status, out.payload);
        return true;
      }
    } catch (err) {
      sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "profile query failed");
      return true;
    }
  }

  // --- /users/:wallet/... ---
  const usersMatch = /^\/api\/v1\/users\/([^/]+)(\/(profile|history|equity-curve|followers|following|follow))?$/.exec(pathname);
  if (usersMatch) {
    const sub = usersMatch[3] ?? null;
    if (method !== "GET" && !(sub === "follow" && (method === "POST" || method === "DELETE"))) {
      sendError(res, 405, "METHOD_NOT_ALLOWED", `${method} not supported on ${pathname}`);
      return true;
    }
    const db = await deps.getDb();
    if (!db) {
      const out = dbGuardPayload();
      sendJson(res, out.status, out.payload);
      return true;
    }
    let wallet: string;
    try {
      wallet = assertWallet(decodeURIComponent(usersMatch[1]));
    } catch {
      sendError(res, 400, "INVALID_WALLET", `not a valid Solana wallet: ${usersMatch[1].slice(0, 64)}`);
      return true;
    }
    try {
      if (sub === "follow" && (method === "POST" || method === "DELETE")) {
        if (!viewerWallet) {
          sendError(res, 401, "UNAUTHORIZED", "wallet auth required to follow");
          return true;
        }
        const out = await setFollow(db, viewerWallet, wallet, method === "POST");
        sendJson(res, out.status, out.payload);
        return true;
      }
      if (method === "GET") {
        if (sub === null || sub === "profile") {
          const out = await getUserProfile(db, wallet, viewerWallet);
          sendJson(res, out.status, out.payload);
          return true;
        }
        if (sub === "history") {
          const out = await getUserHistory(db, wallet, {
            limit: clampLimit(url.searchParams.get("limit")),
            cursor: url.searchParams.get("cursor"),
          });
          sendJson(res, out.status, out.payload);
          return true;
        }
        if (sub === "equity-curve") {
          const days = Number(url.searchParams.get("days") ?? "30");
          const out = await getUserEquityCurve(db, wallet, Number.isFinite(days) ? days : 30);
          sendJson(res, out.status, out.payload);
          return true;
        }
        if (sub === "followers" || sub === "following") {
          const out = await getFollowList(db, wallet, sub, {
            limit: clampLimit(url.searchParams.get("limit")),
            cursor: url.searchParams.get("cursor"),
          });
          sendJson(res, out.status, out.payload);
          return true;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("invalid wallet")) {
        sendError(res, 400, "INVALID_WALLET", err.message);
        return true;
      }
      sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "user query failed");
      return true;
    }
  }

  // --- /posts ---
  if (pathname === "/api/v1/posts" && method === "POST") {
    if (!viewerWallet) {
      sendError(res, 401, "UNAUTHORIZED", "wallet auth required to post");
      return true;
    }
    const db = await deps.getDb();
    if (!db) {
      const out = dbGuardPayload();
      sendJson(res, out.status, out.payload);
      return true;
    }
    try {
      const body = await deps.readJsonBody(req);
      if (body === null) {
        sendError(res, 400, "INVALID_JSON", "request body must be a JSON object");
        return true;
      }
      const out = await createPost(db, viewerWallet, body);
      sendJson(res, out.status, out.payload);
    } catch (err) {
      sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "post failed");
    }
    return true;
  }

  const postsMatch = /^\/api\/v1\/posts\/(\d+)(\/(like|comments))?$/.exec(pathname);
  if (postsMatch) {
    const postId = Number(postsMatch[1]);
    const sub = postsMatch[3] ?? null;
    const db = await deps.getDb();
    if (!db) {
      const out = dbGuardPayload();
      sendJson(res, out.status, out.payload);
      return true;
    }
    try {
      if (sub === null && method === "GET") {
        const out = await getPost(db, postId, viewerWallet);
        sendJson(res, out.status, out.payload);
        return true;
      }
      if (sub === null && method === "DELETE") {
        if (!viewerWallet) {
          sendError(res, 401, "UNAUTHORIZED", "wallet auth required to delete a post");
          return true;
        }
        const out = await deletePost(db, viewerWallet, postId);
        sendJson(res, out.status, out.payload);
        return true;
      }
      if (sub === "like" && (method === "POST" || method === "DELETE")) {
        if (!viewerWallet) {
          sendError(res, 401, "UNAUTHORIZED", "wallet auth required to like");
          return true;
        }
        const out = await setLike(db, viewerWallet, postId, method === "POST");
        sendJson(res, out.status, out.payload);
        return true;
      }
      if (sub === "comments" && method === "GET") {
        const out = await listComments(db, postId);
        sendJson(res, out.status, out.payload);
        return true;
      }
      if (sub === "comments" && method === "POST") {
        if (!viewerWallet) {
          sendError(res, 401, "UNAUTHORIZED", "wallet auth required to comment");
          return true;
        }
        const body = await deps.readJsonBody(req);
        if (body === null) {
          sendError(res, 400, "INVALID_JSON", "request body must be a JSON object");
          return true;
        }
        const out = await addComment(db, viewerWallet, postId, body);
        sendJson(res, out.status, out.payload);
        return true;
      }
    } catch (err) {
      sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "post query failed");
      return true;
    }
  }

  // Social path but unmatched method — explicit 404 so callers never fall
  // through to the generic handler with a half-matched route.
  sendError(res, 404, "NOT_FOUND", `no social route for ${method} ${pathname}`);
  return true;
}
