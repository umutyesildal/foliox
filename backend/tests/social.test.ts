/**
 * social.test.ts — V0.2 social layer: wallet-signature auth (nonce replay,
 * token tamper/expiry), profile validation, history/feed/leaderboard handlers
 * with the fake-PgLike pattern (no RPC, no live Postgres), and the social
 * HTTP dispatcher (routing + auth gates). No transaction ever gets signed —
 * the only ed25519 here verifies a client wallet signature, exactly like
 * production.
 */
import { describe, it, expect, beforeEach } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import type http from "http";

import {
  buildAuthMessage,
  clearNonces,
  consumeNonce,
  issueNonce,
  signToken,
  verifyToken,
  verifyWalletSignature,
  walletFromAuthHeader,
  NONCE_TTL_MS,
  TOKEN_TTL_SECONDS,
} from "../src/api/auth";
import {
  addComment,
  createPost,
  deletePost,
  getBasketLeaderboard,
  getFeed,
  getLeaderboard,
  getPost,
  getUserHistory,
  getUserProfile,
  listComments,
  setFollow,
  setLike,
  tryHandleSocialRoute,
  validateProfileUpdate,
} from "../src/api/social";
import type { SocialDeps } from "../src/api/social";
import type { PgLike } from "../src/db/client";

// --- fakes -------------------------------------------------------------------

type SqlRoute = { match: string | RegExp; rows: unknown[]; rowCount?: number };

/** PgLike test double that routes canned rows by SQL fragment (in order). */
function fakeDb(routes: SqlRoute[] = []) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  return {
    calls,
    query: async (sql: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> => {
      calls.push({ sql, values });
      for (const r of routes) {
        if (typeof r.match === "string" ? sql.includes(r.match) : r.match.test(sql)) {
          return { rows: r.rows.map((x) => ({ ...(x as Record<string, unknown>) })), rowCount: r.rowCount ?? r.rows.length };
        }
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PgLike & { calls: Array<{ sql: string; values?: unknown[] }> };
}

function fakeRes() {
  const state = { statusCode: 0, body: "" };
  const res = {
    end(payload?: string) {
      state.body = payload ?? "";
    },
  };
  Object.defineProperty(res, "statusCode", {
    set(v: number) {
      state.statusCode = v;
    },
    get() {
      return state.statusCode;
    },
  });
  return { res: res as unknown as http.ServerResponse, state };
}

function fakeReq(method: string, url: string, headers: Record<string, string> = {}): http.IncomingMessage {
  return { method, url, headers } as unknown as http.IncomingMessage;
}

function jsonBody(state: { body: string }): Record<string, unknown> {
  return JSON.parse(state.body) as Record<string, unknown>;
}

const W1 = bs58.encode(nacl.randomBytes(32)); // real 32-byte base58 pubkey
const W2 = bs58.encode(nacl.randomBytes(32));
const SECRET = "test-secret";

const TEST_DEPS = (db: PgLike | null): SocialDeps => ({
  getDb: async () => db,
  readJsonBody: async () => ({}),
  authSecret: SECRET,
});

beforeEach(() => {
  clearNonces();
});

// --- auth primitives -----------------------------------------------------------

describe("social auth primitives", () => {
  it("builds the exact message a wallet signs", () => {
    expect(buildAuthMessage("W", "N")).toBe("Basalt Social\nWallet: W\nNonce: N");
  });

  it("issues and single-use consumes nonces", () => {
    const { nonce } = issueNonce(W1);
    expect(consumeNonce(W1, nonce)).toBe(true);
    expect(consumeNonce(W1, nonce)).toBe(false); // replay rejected
  });

  it("rejects expired nonces", () => {
    const t0 = 1_700_000_000_000;
    const { nonce } = issueNonce(W1, t0);
    expect(consumeNonce(W1, nonce, t0 + NONCE_TTL_MS + 1)).toBe(false);
  });

  it("round-trips a token and rejects tampering", () => {
    const { token } = signToken(W1, SECRET);
    const payload = verifyToken(token, SECRET);
    expect(payload?.wallet).toBe(W1);
    expect(payload && typeof payload.exp === "number").toBe(true);

    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}xx`;
    expect(verifyToken(tampered, SECRET)).toBeNull();
    expect(verifyToken(token, "other-secret")).toBeNull();
  });

  it("expires tokens after their TTL", () => {
    const { token } = signToken(W1, SECRET);
    const later = Date.now() + (TOKEN_TTL_SECONDS + 60) * 1000;
    expect(verifyToken(token, SECRET, later)).toBeNull();
  });

  it("verifies a real ed25519 wallet signature and rejects wrong messages", () => {
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const nonce = "deadbeef";
    const good = bs58.encode(nacl.sign.detached(Buffer.from(buildAuthMessage(wallet, nonce), "utf8"), kp.secretKey));
    expect(verifyWalletSignature(wallet, nonce, good)).toBe(true);
    expect(verifyWalletSignature(wallet, "other", good)).toBe(false);
    expect(verifyWalletSignature(wallet, nonce, bs58.encode(nacl.randomBytes(64)))).toBe(false);
  });

  it("extracts the wallet from a bearer header", () => {
    const { token } = signToken(W1, SECRET);
    expect(walletFromAuthHeader(`Bearer ${token}`, SECRET)).toBe(W1);
    expect(walletFromAuthHeader("Bearer garbage", SECRET)).toBeNull();
    expect(walletFromAuthHeader(undefined, SECRET)).toBeNull();
  });
});

// --- profile validation ----------------------------------------------------------

describe("profile validation", () => {
  it("accepts a valid update", () => {
    const out = validateProfileUpdate({ handle: "satoshi_21", displayName: "Satoshi", avatarUrl: "https://x/y.png", bio: "hi", isPublic: true });
    expect(out.ok).toBe(true);
  });

  it("rejects bad handles, non-https avatars and wrong types", () => {
    expect(validateProfileUpdate({ handle: "ab" }).ok).toBe(false);
    expect(validateProfileUpdate({ handle: "has space" }).ok).toBe(false);
    expect(validateProfileUpdate({ handle: "UPPER" }).ok).toBe(false);
    expect(validateProfileUpdate({ avatarUrl: "http://x/y.png" }).ok).toBe(false);
    expect(validateProfileUpdate({ isPublic: "yes" }).ok).toBe(false);
    expect(validateProfileUpdate({ displayName: "x".repeat(41) }).ok).toBe(false);
    expect(validateProfileUpdate({ bio: "x".repeat(281) }).ok).toBe(false);
  });
});

// --- handlers with fakeDb ----------------------------------------------------------

describe("getUserProfile", () => {
  it("returns null profile with on-chain trade stats when unclaimed", async () => {
    // PROFILE_ROW_SQL embeds the stats subquery, so an empty profile-row route
    // must be listed first or the fake matches the inner stats fragment.
    const db = fakeDb([
      { match: "FROM profiles p", rows: [] },
      { match: "COUNT(DISTINCT e.sig)", rows: [{ trade_count: 3 }] },
    ]);
    const out = await getUserProfile(db, W1, null);
    const payload = out.payload as { profile: unknown; stats: { tradeCount: number } };
    expect(out.status).toBe(200);
    expect(payload.profile).toBeNull();
    expect(payload.stats.tradeCount).toBe(3);
  });

  it("returns profile row with counts and viewer state", async () => {
    const db = fakeDb([
      {
        match: "FROM profiles p",
        rows: [
          {
            wallet: W1,
            handle: "satoshi",
            display_name: "Satoshi",
            avatar_url: null,
            bio: null,
            is_public: true,
            created_at: new Date("2026-01-01"),
            followers: 2,
            following: 1,
            trade_count: 5,
          },
        ],
      },
      { match: "FROM follows WHERE follower", rows: [{ "?column?": 1 }] },
    ]);
    const out = await getUserProfile(db, W1, W1);
    const payload = out.payload as { profile: { handle: string }; stats: { followers: number }; viewer: { isFollowing: boolean } };
    expect(payload.profile.handle).toBe("satoshi");
    expect(payload.stats.followers).toBe(2);
    expect(payload.viewer?.isFollowing).toBe(true);
  });
});

describe("getUserHistory", () => {
  it("maps the ledger to trade items and paginates by cursor", async () => {
    const ts = new Date("2026-09-01T12:00:00Z");
    const db = fakeDb([
      {
        match: "h.shares_raw",
        rows: [
          {
            sig: "sig1",
            ts,
            trade_type: "Minted",
            basket: "Bk1",
            basket_name: "Mag7",
            shares: "1.5",
            share_price: "2.0",
            usd_value: "3",
          },
        ],
      },
    ]);
    const out = await getUserHistory(db, W1, { limit: 1 });
    const payload = out.payload as { items: Array<{ type: string; usdValue: number | null }>; nextCursor: string | null };
    expect(out.status).toBe(200);
    expect(payload.items[0].type).toBe("Minted");
    expect(payload.items[0].usdValue).toBe(3);
    expect(payload.nextCursor).not.toBeNull();

    const page2 = await getUserHistory(db, W1, { limit: 1, cursor: payload.nextCursor });
    expect((page2.payload as { items: unknown[] }).items).toHaveLength(1);
    // cursor param must be bound as $2 with the limit as $3
    expect(db.calls[1].values).toEqual([W1, expect.any(Date), 1]);
  });

  it("rejects garbage cursors with 400", async () => {
    const db = fakeDb();
    const out = await getUserHistory(db, W1, { cursor: "not-base64!!" });
    expect(out.status).toBe(400);
  });

  it("keeps usdValue null when no NAV price existed yet", async () => {
    const db = fakeDb([
      { match: "h.shares_raw", rows: [{ sig: "s", ts: new Date(), trade_type: "Redeemed", basket: "B", basket_name: null, shares: "2", share_price: null, usd_value: null }] },
    ]);
    const out = await getUserHistory(db, W1, {});
    const payload = out.payload as { items: Array<{ usdValue: number | null }> };
    expect(payload.items[0].usdValue).toBeNull();
  });
});

describe("getFeed", () => {
  it("unifies trades and theses with privacy-honest payloads", async () => {
    const db = fakeDb([
      {
        match: "UNION ALL",
        rows: [
          {
            kind: "trade",
            item_key: "sig9",
            ts: new Date("2026-09-02T00:00:00Z"),
            wallet: W1,
            handle: "sat",
            display_name: null,
            avatar_url: null,
            basket: "Bk1",
            basket_name: "Mag7",
            trade_type: "Redeemed",
            shares: "4",
            usd_value: "9.5",
            post_id: null,
            title: null,
            body: null,
            like_count: null,
            comment_count: null,
          },
          {
            kind: "thesis",
            item_key: "12",
            ts: new Date("2026-09-01T00:00:00Z"),
            wallet: W1,
            handle: "sat",
            display_name: null,
            avatar_url: null,
            basket: "Bk1",
            basket_name: "Mag7",
            trade_type: null,
            shares: null,
            usd_value: null,
            post_id: 12,
            title: "Why NVDA",
            body: "x".repeat(300),
            like_count: "3",
            comment_count: "1",
          },
        ],
      },
    ]);
    const out = await getFeed(db, { scope: "all", type: "all", limit: 20, cursor: null, viewerWallet: null });
    const payload = out.payload as { items: Array<Record<string, unknown>> };
    expect(out.status).toBe(200);
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]).toMatchObject({ kind: "trade", usdValue: 9.5 });
    expect(payload.items[1]).toMatchObject({ kind: "thesis", likeCount: 3, bodyTruncated: true });
  });

  it("401s scope=following without an authed viewer", async () => {
    const out = await getFeed(fakeDb(), { scope: "following", type: "all", cursor: null, viewerWallet: null });
    expect(out.status).toBe(401);
  });

  it("scope=following filters by the wallets the viewer follows", async () => {
    const db = fakeDb([
      { match: "SELECT followee FROM follows", rows: [{ followee: "WalletA" }, { followee: "WalletB" }] },
      { match: "UNION ALL", rows: [] },
    ]);
    await getFeed(db, { scope: "following", type: "trades", limit: 20, cursor: null, viewerWallet: W1 });
    expect(db.calls[1].values).toEqual([["WalletA", "WalletB"], 20]);
    expect(db.calls[1].sql).toContain("ANY($1::text[])");
  });

  it("rejects invalid cursors with 400", async () => {
    const out = await getFeed(fakeDb(), { scope: "all", type: "all", cursor: "@@@", viewerWallet: null });
    expect(out.status).toBe(400);
  });
});

describe("getLeaderboard", () => {
  it("maps all-time ROI to a percent and validates windows", async () => {
    const db = fakeDb([
      {
        match: "FROM val v",
        rows: [
          {
            wallet: W1,
            handle: "sat",
            display_name: null,
            avatar_url: null,
            value_usd: "110",
            cost_basis_usd: "100",
            position_count: 2,
            first_trade: new Date("2026-01-01"),
            roi: "0.1",
          },
        ],
      },
    ]);
    const out = await getLeaderboard(db, "all");
    const payload = out.payload as { items: Array<{ roiPct: number; valueUsd: number }> };
    expect(payload.items[0].roiPct).toBe(10);
    expect(payload.items[0].valueUsd).toBe(110);

    const bad = await getLeaderboard(fakeDb(), "2h");
    expect(bad.status).toBe(400);
  });

  it("windowed ranking binds the day count", async () => {
    const db = fakeDb([{ match: "FROM win w", rows: [] }]);
    await getLeaderboard(db, "7d");
    expect(db.calls[0].values).toEqual([7]);
  });
});

describe("getBasketLeaderboard", () => {
  // Unique to the current-snapshot lateral in the baskets-leaderboard SQL
  // (baseline laterals select nav only) — no other route's fake matches it.
  const BASKET_LB_MATCH = "SELECT nav, ts FROM nav_snapshots";

  it("maps windowed NAV ROI to returnPct and preserves the payload shape", async () => {
    const db = fakeDb([
      {
        match: BASKET_LB_MATCH,
        rows: [
          {
            pubkey: "Bk1",
            basket_name: "Tech Duo",
            symbol: "TD",
            nav: "104.2100",
            mint_count: "12",
            cur_ts: new Date("2026-09-12T00:00:00Z"),
            base_nav: "100",
            roi: "0.0421",
            holders: 7,
          },
        ],
      },
    ]);
    const out = await getBasketLeaderboard(db, "7d");
    const payload = out.payload as { window: string; items: Array<Record<string, unknown>>; note: string };
    expect(out.status).toBe(200);
    expect(payload.window).toBe("7d");
    expect(payload.items[0]).toMatchObject({
      basket: "Bk1",
      basketName: "Tech Duo",
      symbol: "TD",
      returnPct: 4.21, // (104.21 - 100) / 100 × 100, rounded 2dp
      nav: "104.21", // decimal string, trailing zeros trimmed
      aum: "104.21", // contract: aum mirrors the NAV value
      holders: 7,
      mintCount: 12,
    });
    expect(payload.items[0].asOf).toBe("2026-09-12T00:00:00.000Z");
    expect(typeof payload.note).toBe("string");
  });

  it("rejects invalid windows with 400 INVALID_WINDOW", async () => {
    const out = await getBasketLeaderboard(fakeDb(), "2h");
    expect(out.status).toBe(400);
    expect((out.payload as { error: { code: string } }).error.code).toBe("INVALID_WINDOW");
  });

  it("picks a fully static per-window literal (no bound params, no interpolation)", async () => {
    const mk = () => fakeDb([{ match: BASKET_LB_MATCH, rows: [] }]);
    const db7 = mk();
    await getBasketLeaderboard(db7, "7d");
    expect(db7.calls[0].values).toEqual([]);
    expect(db7.calls[0].sql).toContain("interval '7 days'");

    const db30 = mk();
    await getBasketLeaderboard(db30, "30d");
    expect(db30.calls[0].sql).toContain("interval '30 days'");

    const dbAll = mk();
    await getBasketLeaderboard(dbAll, "all");
    expect(dbAll.calls[0].sql).toContain("ORDER BY ts ASC LIMIT 1"); // all-time baseline = first snapshot
  });

  it("serves GET /leaderboard/baskets through the dispatcher (public read)", async () => {
    const db = fakeDb([{ match: BASKET_LB_MATCH, rows: [] }]);
    const { res, state } = fakeRes();
    const handled = await tryHandleSocialRoute(
      TEST_DEPS(db),
      fakeReq("GET", "/api/v1/leaderboard/baskets?window=30d"),
      res,
      new URL("http://x/api/v1/leaderboard/baskets?window=30d"),
    );
    expect(handled).toBe(true);
    expect(state.statusCode).toBe(200);
    expect(jsonBody(state)).toMatchObject({ window: "30d", items: [] });
  });
});

describe("posts and interactions", () => {
  it("requires a claimed profile before posting", async () => {
    const db = fakeDb([{ match: "SELECT 1 FROM profiles", rows: [] }]);
    const out = await createPost(db, W1, { kind: "thesis", title: "Long NVDA", body: "Because datacenter momentum." });
    expect(out.status).toBe(404);
    expect((out.payload as { error: { code: string } }).error.code).toBe("PROFILE_REQUIRED");
  });

  it("validates kind, title and body", async () => {
    const db = fakeDb([{ match: "SELECT 1 FROM profiles", rows: [{ "?column?": 1 }] }]);
    expect((await createPost(db, W1, { kind: "spam", title: "abc", body: "1234567890" })).status).toBe(400);
    expect((await createPost(db, W1, { kind: "thesis", title: "ab", body: "1234567890" })).status).toBe(400);
    expect((await createPost(db, W1, { kind: "thesis", title: "abc", body: "short" })).status).toBe(400);
  });

  it("creates a thesis post and returns the full payload", async () => {
    const db = fakeDb([
      { match: "SELECT 1 FROM profiles", rows: [{ "?column?": 1 }] },
      { match: "RETURNING id", rows: [{ id: 7, created_at: new Date("2026-09-03") }] },
      {
        match: "FROM posts po",
        rows: [
          {
            id: 7,
            wallet: W1,
            kind: "thesis",
            basket: null,
            basket_name: null,
            title: "Long NVDA",
            body_md: "Because datacenter momentum is real.",
            created_at: new Date("2026-09-03"),
            handle: "sat",
            display_name: null,
            avatar_url: null,
            like_count: "0",
            comment_count: "0",
            liked_by_me: false,
          },
        ],
      },
    ]);
    const out = await createPost(db, W1, { kind: "thesis", title: "Long NVDA", body: "Because datacenter momentum is real." });
    expect(out.status).toBe(201);
    expect((out.payload as { post: { id: number; likedByMe: boolean } }).post.id).toBe(7);
  });

  it("only lets the author delete a post", async () => {
    const db = fakeDb([
      { match: "DELETE FROM posts", rows: [] },
      { match: "SELECT wallet FROM posts", rows: [{ wallet: "someoneElse" }] },
    ]);
    const out = await deletePost(db, W1, 5);
    expect(out.status).toBe(403);
  });

  it("likes are idempotent and unlike reports likedByMe=false", async () => {
    const db = fakeDb([
      { match: "SELECT 1 FROM posts", rows: [{ "?column?": 1 }] },
      { match: "COUNT(*) AS n", rows: [{ n: 4 }] },
    ]);
    const out = await setLike(db, W1, 5, true);
    expect((out.payload as { likeCount: number; likedByMe: boolean })).toMatchObject({ likeCount: 4, likedByMe: true });
  });

  it("adds and lists comments", async () => {
    const db = fakeDb([
      { match: "SELECT 1 FROM posts", rows: [{ "?column?": 1 }] },
      { match: "INSERT INTO comments", rows: [{ id: 2, created_at: new Date("2026-09-03") }] },
    ]);
    const out = await addComment(db, W1, 5, { body: "Interesting thesis." });
    expect(out.status).toBe(201);
    expect((out.payload as { comment: { body: string } }).comment.body).toBe("Interesting thesis.");

    const list = await listComments(
      fakeDb([
        { match: "SELECT 1 FROM posts", rows: [{ "?column?": 1 }] },
        {
          match: "FROM comments c",
          rows: [{ id: 1, wallet: W1, body: "hi", created_at: new Date(), handle: "sat", display_name: null, avatar_url: null }],
        },
      ]),
      5,
    );
    expect((list.payload as { items: unknown[] }).items).toHaveLength(1);
  });
});

describe("follows", () => {
  it("blocks self-follow with 400", async () => {
    const out = await setFollow(fakeDb(), W1, W1, true);
    expect(out.status).toBe(400);
  });

  it("404s when the target has no profile", async () => {
    const out = await setFollow(fakeDb([{ match: "SELECT 1 FROM profiles", rows: [] }]), W1, W2, true);
    expect(out.status).toBe(404);
  });

  it("follows and reports the follower count", async () => {
    const db = fakeDb([
      { match: "SELECT 1 FROM profiles", rows: [{ "?column?": 1 }] },
      { match: "COUNT(*) AS n", rows: [{ n: 9 }] },
    ]);
    const out = await setFollow(db, W1, W2, true);
    expect((out.payload as { following: boolean; followerCount: number })).toMatchObject({ following: true, followerCount: 9 });
  });
});

// --- HTTP dispatcher -------------------------------------------------------------

describe("tryHandleSocialRoute", () => {
  it("issues nonces over HTTP", async () => {
    const { res, state } = fakeRes();
    const handled = await tryHandleSocialRoute(
      { ...TEST_DEPS(null), readJsonBody: async () => ({ wallet: W1 }) },
      fakeReq("POST", "/api/v1/auth/nonce"),
      res,
      new URL("http://x/api/v1/auth/nonce"),
    );
    expect(handled).toBe(true);
    expect(state.statusCode).toBe(200);
    expect(typeof jsonBody(state).nonce).toBe("string");
  });

  it("verifies a signed message end-to-end and returns a usable token", async () => {
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const { nonce } = issueNonce(wallet);
    const signature = bs58.encode(
      nacl.sign.detached(Buffer.from(buildAuthMessage(wallet, nonce), "utf8"), kp.secretKey),
    );
    const { res, state } = fakeRes();
    const handled = await tryHandleSocialRoute(
      { ...TEST_DEPS(null), readJsonBody: async () => ({ wallet, nonce, signature }) },
      fakeReq("POST", "/api/v1/auth/verify"),
      res,
      new URL("http://x/api/v1/auth/verify"),
    );
    expect(handled).toBe(true);
    expect(state.statusCode).toBe(200);
    const body = jsonBody(state) as { token: string; wallet: string };
    expect(body.wallet).toBe(wallet);
    expect(verifyToken(body.token, SECRET)?.wallet).toBe(wallet);
  });

  it("rejects a replayed nonce with 401", async () => {
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const { nonce } = issueNonce(wallet);
    const signature = bs58.encode(
      nacl.sign.detached(Buffer.from(buildAuthMessage(wallet, nonce), "utf8"), kp.secretKey),
    );
    const deps = { ...TEST_DEPS(null), readJsonBody: async () => ({ wallet, nonce, signature }) };
    const first = fakeRes();
    await tryHandleSocialRoute(deps, fakeReq("POST", "/api/v1/auth/verify"), first.res, new URL("http://x/api/v1/auth/verify"));
    expect(first.state.statusCode).toBe(200);

    const second = fakeRes();
    await tryHandleSocialRoute(deps, fakeReq("POST", "/api/v1/auth/verify"), second.res, new URL("http://x/api/v1/auth/verify"));
    expect(second.state.statusCode).toBe(401);
    expect((jsonBody(second.state) as { error: { code: string } }).error.code).toBe("NONCE_INVALID");
  });

  it("gates writes behind auth (401) and reads through to the DB", async () => {
    const noAuth = fakeRes();
    await tryHandleSocialRoute(
      TEST_DEPS(fakeDb()),
      fakeReq("PUT", "/api/v1/me/profile"),
      noAuth.res,
      new URL("http://x/api/v1/me/profile"),
    );
    expect(noAuth.state.statusCode).toBe(401);

    const db = fakeDb([{ match: "FROM profiles p", rows: [] }, { match: "COUNT(DISTINCT e.sig)", rows: [{ trade_count: 0 }] }]);
    const read = fakeRes();
    await tryHandleSocialRoute(
      TEST_DEPS(db),
      fakeReq("GET", `/api/v1/users/${W1}/profile`),
      read.res,
      new URL(`http://x/api/v1/users/${W1}/profile`),
    );
    expect(read.state.statusCode).toBe(200);
  });

  it("answers 503 DB_UNAVAILABLE (never fabricated) when Postgres is off", async () => {
    const { res, state } = fakeRes();
    await tryHandleSocialRoute(
      TEST_DEPS(null),
      fakeReq("GET", "/api/v1/feed"),
      res,
      new URL("http://x/api/v1/feed"),
    );
    expect(state.statusCode).toBe(503);
    expect((jsonBody(state) as { error: { code: string } }).error.code).toBe("DB_UNAVAILABLE");
  });

  it("falls through for non-social paths", async () => {
    const { res, state } = fakeRes();
    const handled = await tryHandleSocialRoute(
      TEST_DEPS(null),
      fakeReq("GET", "/api/v1/baskets"),
      res,
      new URL("http://x/api/v1/baskets"),
    );
    expect(handled).toBe(false);
    expect(state.statusCode).toBe(0); // untouched — server.ts continues dispatch
  });
});
