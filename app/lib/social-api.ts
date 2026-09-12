"use client";

/**
 * Typed client for the FolioX social layer (feed / profiles / theses).
 *
 * Same discipline as components/basket/basket-api.ts: every fetch goes through
 * the validated `apiFetch`/`apiQuery` pair (lib/api-client.ts), paths are
 * literal `/api/v1/...` strings at every call site, and dynamic values are
 * encodeURIComponent'd or passed as URLSearchParams. Success payloads are the
 * plain JSON objects documented per function; errors arrive as
 * `{ error: { code, message } }` with an HTTP status — normalized into
 * `SocialApiError` so callers can branch on `code` (PROFILE_REQUIRED,
 * HANDLE_TAKEN, …).
 *
 * Write endpoints require a wallet-signed bearer token — obtain one with
 * `useSocialAuth().ensureAuth()` (lib/social-auth.ts) and pass it explicitly;
 * this module never touches localStorage or the wallet.
 */

import { apiFetch, apiQuery } from "@/lib/api-client";

/** Mirrors the basket API error shape (status + machine code). */
export class SocialApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "SocialApiError";
    this.status = status;
    this.code = code;
  }
}

/** True when `err` is a SocialApiError carrying one of `codes`. */
export function isSocialApiError(
  err: unknown,
  codes?: string[],
): err is SocialApiError {
  if (!(err instanceof SocialApiError)) return false;
  return !codes || codes.includes(err.code ?? "");
}

// ---------------------------------------------------------------------------
// Payload types (verbatim from the social backend contract)
// ---------------------------------------------------------------------------

export interface SocialProfile {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  isPublic: boolean;
  createdAt: string;
}

export interface SocialStats {
  followers: number;
  following: number;
  tradeCount: number;
}

/** viewer is null when the request is unauthenticated (or not the viewer). */
export interface SocialViewer {
  isFollowing: boolean;
}

export interface ProfilePayload {
  wallet: string;
  profile: SocialProfile | null;
  stats: SocialStats;
  viewer: SocialViewer | null;
}

export type TradeSide = "Minted" | "Redeemed";

export interface TradeHistoryItem {
  sig: string;
  ts: string;
  type: TradeSide;
  basket: string;
  basketName: string | null;
  shares: number;
  /** null renders as an em dash — never fabricated. */
  sharePrice: number | null;
  usdValue: number | null;
}

export interface EquityPoint {
  ts: string;
  valueUsd: number;
  costBasis: number;
}

export interface EquityCurvePayload {
  wallet: string;
  days: number;
  points: EquityPoint[];
}

export interface TradeFeedItem {
  kind: "trade";
  ts: string;
  wallet: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  basket: string;
  basketName: string | null;
  sig: string;
  type: TradeSide;
  shares: number;
  usdValue: number | null;
}

export interface ThesisFeedItem {
  kind: "thesis";
  ts: string;
  wallet: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  basket: string | null;
  basketName: string | null;
  id: string;
  title: string;
  body: string;
  bodyTruncated?: boolean;
  likeCount: number;
  commentCount: number;
}

export type FeedItem = TradeFeedItem | ThesisFeedItem;

export interface FeedPayload {
  items: FeedItem[];
  nextCursor: string | null;
  note?: string | null;
}

export type LeaderboardWindow = "7d" | "30d" | "all";

export interface LeaderboardEntry {
  wallet: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** null renders "est. —" — honest when snapshots are missing. */
  roiPct: number | null;
  valueUsd: number | null;
  costBasisUsd: number | null;
  positionCount: number;
  firstTradeAt: string | null;
}

export interface LeaderboardPayload {
  window: LeaderboardWindow;
  items: LeaderboardEntry[];
  note?: string | null;
}

/**
 * Baskets leaderboard (GET /leaderboard/baskets) shares the users window
 * vocabulary — the same 7d/30d/all switcher drives both tabs.
 */
export type BasketLeaderboardWindow = LeaderboardWindow;

export interface BasketLeaderboardEntry {
  basket: string;
  basketName: string | null;
  /** Ticker chip; null hides the chip (basket renders by name only). */
  symbol: string | null;
  /** Window return in percent — ranked DESC server-side. */
  returnPct: number;
  /** Current NAV per share — BigInt-safe string, parsed at display time. */
  nav: string;
  /** Basket AUM — BigInt-safe string. */
  aum: string;
  holders: number;
  mintCount: number;
  /** Freshness stamp of the NAV snapshot behind returnPct. */
  asOf: string;
}

export interface BasketLeaderboardPayload {
  window: BasketLeaderboardWindow;
  items: BasketLeaderboardEntry[];
  note: string;
}

export interface FullPost {
  id: string;
  wallet: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  basket: string | null;
  basketName: string | null;
  title: string;
  body: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  ts: string;
}

export interface PostPayload {
  post: FullPost;
}

export interface CommentItem {
  id: string;
  wallet: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  body: string;
  ts: string;
}

export interface CommentsPayload {
  postId: string;
  items: CommentItem[];
}

export interface FollowListItem {
  wallet: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  ts: string;
}

export interface FollowListPayload {
  wallet: string;
  direction: "followers" | "following";
  items: FollowListItem[];
  nextCursor: string | null;
}

export interface FollowResultPayload {
  following: boolean;
  followerCount: number;
}

export interface AuthNoncePayload {
  nonce: string;
  expiresAt: string;
}

export interface AuthVerifyPayload {
  token: string;
  wallet: string;
  expiresAt: string;
}

export interface ProfilePatch {
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  isPublic?: boolean;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function errFrom(payload: unknown, res: Response): SocialApiError {
  const errObj = (payload as { error?: { code?: string; message?: string } } | null)?.error;
  return new SocialApiError(
    errObj?.message ?? `Social API responded with HTTP ${res.status}`,
    res.status,
    errObj?.code,
  );
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** GET without auth. */
export async function socialGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(path, {
      signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new SocialApiError("Could not reach the social API.", 0);
  }
  const payload = await readJson(res);
  if (!res.ok) throw errFrom(payload, res);
  return payload as T;
}

/** GET with query params (encoded via URLSearchParams — never concatenated). */
export async function socialGetQuery<T>(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await apiQuery(path, params, {
      signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new SocialApiError("Could not reach the social API.", 0);
  }
  const payload = await readJson(res);
  if (!res.ok) throw errFrom(payload, res);
  return payload as T;
}

/** JSON request with the wallet-signed bearer token (writes + /me reads). */
export async function socialWrite<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  token: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(path, {
      method,
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new SocialApiError("Could not reach the social API.", 0);
  }
  const payload = await readJson(res);
  if (!res.ok) throw errFrom(payload, res);
  return payload as T;
}

// ---------------------------------------------------------------------------
// Auth (used by lib/social-auth.ts)
// ---------------------------------------------------------------------------

export function requestNonce(wallet: string): Promise<AuthNoncePayload> {
  return socialWrite<AuthNoncePayload>("/api/v1/auth/nonce", "POST", "", { wallet });
}

export function verifyWallet(
  wallet: string,
  nonce: string,
  signature: string,
): Promise<AuthVerifyPayload> {
  return socialWrite<AuthVerifyPayload>("/api/v1/auth/verify", "POST", "", {
    wallet,
    nonce,
    signature,
  });
}

// ---------------------------------------------------------------------------
// Reads (public)
// ---------------------------------------------------------------------------

export function fetchProfile(wallet: string, signal?: AbortSignal): Promise<ProfilePayload> {
  return socialGet<ProfilePayload>(`/api/v1/users/${encodeURIComponent(wallet)}/profile`, signal);
}

export function fetchHistory(
  wallet: string,
  opts?: { limit?: number; cursor?: string | null },
  signal?: AbortSignal,
): Promise<{ wallet: string; items: TradeHistoryItem[]; nextCursor: string | null }> {
  const params: Record<string, string> = {};
  if (opts?.limit !== undefined) params.limit = String(opts.limit);
  if (opts?.cursor) params.cursor = opts.cursor;
  const path = `/api/v1/users/${encodeURIComponent(wallet)}/history`;
  return Object.keys(params).length > 0
    ? socialGetQuery(path, params, signal)
    : socialGet(path, signal);
}

export function fetchEquityCurve(
  wallet: string,
  opts?: { days?: number },
  signal?: AbortSignal,
): Promise<EquityCurvePayload> {
  if (opts?.days !== undefined) {
    return socialGetQuery(
      `/api/v1/users/${encodeURIComponent(wallet)}/equity-curve`,
      { days: String(opts.days) },
      signal,
    );
  }
  return socialGet(`/api/v1/users/${encodeURIComponent(wallet)}/equity-curve`, signal);
}

export type FeedScope = "all" | "following";
export type FeedType = "all" | "trades" | "theses";

export function fetchFeed(
  opts?: { scope?: FeedScope; type?: FeedType; limit?: number; cursor?: string | null },
  signal?: AbortSignal,
): Promise<FeedPayload> {
  const params: Record<string, string> = {};
  if (opts?.scope) params.scope = opts.scope;
  if (opts?.type) params.type = opts.type;
  if (opts?.limit !== undefined) params.limit = String(opts.limit);
  if (opts?.cursor) params.cursor = opts.cursor;
  return Object.keys(params).length > 0
    ? socialGetQuery("/api/v1/feed", params, signal)
    : socialGet("/api/v1/feed", signal);
}

export function fetchLeaderboard(
  win: LeaderboardWindow,
  signal?: AbortSignal,
): Promise<LeaderboardPayload> {
  return socialGetQuery<LeaderboardPayload>("/api/v1/leaderboard", { window: win }, signal);
}

export function fetchBasketLeaderboard(
  win: BasketLeaderboardWindow,
  signal?: AbortSignal,
): Promise<BasketLeaderboardPayload> {
  return socialGetQuery<BasketLeaderboardPayload>(
    "/api/v1/leaderboard/baskets",
    { window: win },
    signal,
  );
}

export function fetchPost(id: string, signal?: AbortSignal): Promise<PostPayload> {
  return socialGet<PostPayload>(`/api/v1/posts/${encodeURIComponent(id)}`, signal);
}

export function fetchComments(postId: string, signal?: AbortSignal): Promise<CommentsPayload> {
  return socialGet<CommentsPayload>(`/api/v1/posts/${encodeURIComponent(postId)}/comments`, signal);
}

export function fetchFollowers(
  wallet: string,
  opts?: { limit?: number; cursor?: string | null },
  signal?: AbortSignal,
): Promise<FollowListPayload> {
  const params: Record<string, string> = {};
  if (opts?.limit !== undefined) params.limit = String(opts.limit);
  if (opts?.cursor) params.cursor = opts.cursor;
  const path = `/api/v1/users/${encodeURIComponent(wallet)}/followers`;
  return Object.keys(params).length > 0
    ? socialGetQuery(path, params, signal)
    : socialGet(path, signal);
}

export function fetchFollowing(
  wallet: string,
  opts?: { limit?: number; cursor?: string | null },
  signal?: AbortSignal,
): Promise<FollowListPayload> {
  const params: Record<string, string> = {};
  if (opts?.limit !== undefined) params.limit = String(opts.limit);
  if (opts?.cursor) params.cursor = opts.cursor;
  const path = `/api/v1/users/${encodeURIComponent(wallet)}/following`;
  return Object.keys(params).length > 0
    ? socialGetQuery(path, params, signal)
    : socialGet(path, signal);
}

// ---------------------------------------------------------------------------
// Writes (Authorization: Bearer token)
// ---------------------------------------------------------------------------

export function fetchMeProfile(token: string): Promise<ProfilePayload> {
  return socialWrite<ProfilePayload>("/api/v1/me/profile", "GET", token);
}

export function putMeProfile(token: string, patch: ProfilePatch): Promise<{ profile: SocialProfile }> {
  return socialWrite<{ profile: SocialProfile }>("/api/v1/me/profile", "PUT", token, patch);
}

export function followWallet(token: string, wallet: string): Promise<FollowResultPayload> {
  return socialWrite<FollowResultPayload>(
    `/api/v1/users/${encodeURIComponent(wallet)}/follow`,
    "POST",
    token,
  );
}

export function unfollowWallet(token: string, wallet: string): Promise<FollowResultPayload> {
  return socialWrite<FollowResultPayload>(
    `/api/v1/users/${encodeURIComponent(wallet)}/follow`,
    "DELETE",
    token,
  );
}

export function createThesis(
  token: string,
  input: { title: string; body: string; basket?: string },
): Promise<{ post: FullPost }> {
  return socialWrite<{ post: FullPost }>("/api/v1/posts", "POST", token, {
    kind: "thesis",
    title: input.title,
    body: input.body,
    ...(input.basket ? { basket: input.basket } : {}),
  });
}

export function deletePost(token: string, id: string): Promise<{ deleted: boolean }> {
  return socialWrite<{ deleted: boolean }>(
    `/api/v1/posts/${encodeURIComponent(id)}`,
    "DELETE",
    token,
  );
}

export function likePost(token: string, id: string): Promise<{ likeCount: number; likedByMe: boolean }> {
  return socialWrite<{ likeCount: number; likedByMe: boolean }>(
    `/api/v1/posts/${encodeURIComponent(id)}/like`,
    "POST",
    token,
  );
}

export function unlikePost(token: string, id: string): Promise<{ likeCount: number; likedByMe: boolean }> {
  return socialWrite<{ likeCount: number; likedByMe: boolean }>(
    `/api/v1/posts/${encodeURIComponent(id)}/like`,
    "DELETE",
    token,
  );
}

export function createComment(
  token: string,
  postId: string,
  body: string,
): Promise<{ comment: CommentItem }> {
  return socialWrite<{ comment: CommentItem }>(
    `/api/v1/posts/${encodeURIComponent(postId)}/comments`,
    "POST",
    token,
    { body },
  );
}
