"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";

import { EmptyState, ErrorState, FreshnessBadge, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAsOf, formatRelativeTime, formatTokenAmount, formatUsd, truncateAddress } from "@/lib/format";
import { apiFetch } from "@/lib/api-client";
import { LegalReviewTag } from "@/components/create";
import {
  followWallet,
  fetchEquityCurve,
  fetchHistory,
  fetchProfile,
  unfollowWallet,
  type EquityPoint,
  type ProfilePayload,
  type TradeHistoryItem,
} from "@/lib/social-api";
import { useSocialAuth } from "@/lib/social-auth";
import { ProfileEditorModal } from "@/components/social/profile-editor";
import { SocialAvatar } from "@/components/social/avatar";
import { EquityCurveChart } from "@/components/social/equity-curve-chart";

interface CreatorStats {
  basket_count?: string | number | null;
  total_aum?: string | number | null;
  total_fees_earned?: string | number | null;
  updated_at?: string | null;
}

interface CreatorBasketRow {
  pubkey: string;
  share_mint?: string | null;
  created_at?: string | null;
  nav?: string | number | null;
  refreshed_at?: string | null;
  source?: string | null;
}

interface CreatorPayload {
  data?: {
    creator?: string;
    stats?: CreatorStats | null;
    baskets?: CreatorBasketRow[];
    source?: string | null;
    asOf?: string | null;
  };
  error?: { code?: string; message?: string };
}

function numeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const HISTORY_PAGE = 20;

/**
 * Trader profile = social identity (avatar/handle/bio, follow, equity curve,
 * trade history) over the existing indexer-fed creator section (stats +
 * baskets), which is kept verbatim. Everything degrades honestly: a wallet
 * with no social profile renders identicon + truncated address; a private
 * profile renders a minimal state while the indexer baskets stay visible.
 */
export default function CreatorPage() {
  const params = useParams<{ pubkey: string }>();
  const pubkeyParam = typeof params?.pubkey === "string" ? params.pubkey : "";

  const validKey = (() => {
    try {
      new PublicKey(pubkeyParam);
      return true;
    } catch {
      return false;
    }
  })();

  // ---- existing creator (indexer) state — unchanged behavior ----
  const [status, setStatus] = useState<"loading" | "ready" | "not-indexed" | "error" | "invalid">(
    validKey ? "loading" : "invalid",
  );
  const [payload, setPayload] = useState<CreatorPayload["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async () => {
    if (!validKey) {
      setStatus("invalid");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const res = await apiFetch(
        `/api/v1/creators/${encodeURIComponent(pubkeyParam)}`,
        { cache: "no-store" },
      );
      const body = (await res.json().catch(() => null)) as CreatorPayload | null;
      if (res.status === 404 || body?.error?.code === "NOT_INDEXED") {
        setPayload(null);
        setStatus("not-indexed");
        return;
      }
      if (!res.ok) {
        setPayload(null);
        setError(
          body?.error?.message ??
            `GET /api/v1/creators/:pubkey responded ${res.status}. Creator stats stay empty until the indexer tracks activity.`,
        );
        setStatus("error");
        return;
      }
      setPayload(body?.data ?? null);
      setStatus("ready");
    } catch (err) {
      setPayload(null);
      setError(
        err instanceof Error
          ? err.message
          : "The creators API did not respond. Creator stats stay empty until the indexer tracks activity.",
      );
      setStatus("error");
    }
  }, [pubkeyParam, validKey]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  // ---- social layer state ----
  const social = useSocialAuth();
  const isOwner =
    !!social.authWallet &&
    !!pubkeyParam &&
    social.authWallet.toLowerCase() === pubkeyParam.toLowerCase();

  const [profileStatus, setProfileStatus] = useState<"loading" | "ready" | "error">("loading");
  const [profilePayload, setProfilePayload] = useState<ProfilePayload | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [curve, setCurve] = useState<EquityPoint[] | null>(null);
  const [curveFailed, setCurveFailed] = useState(false);

  const [history, setHistory] = useState<TradeHistoryItem[] | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyFailed, setHistoryFailed] = useState(false);

  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const profile = profilePayload?.profile ?? null;
  const isPrivate = profile?.isPublic === false && !isOwner;

  const loadProfile = useCallback(async () => {
    if (!validKey) return;
    setProfileStatus("loading");
    setProfileError(null);
    try {
      const payload = await fetchProfile(pubkeyParam);
      setProfilePayload(payload);
      setProfileStatus("ready");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setProfileError(err instanceof Error ? err.message : "Could not load the social profile.");
      setProfileStatus("error");
    }
  }, [pubkeyParam, validKey]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  // Equity curve + first history page — public profiles only.
  useEffect(() => {
    if (!validKey || isPrivate) return;
    const controller = new AbortController();
    setCurve(null);
    setHistory(null);
    setCurveFailed(false);
    setHistoryFailed(false);
    void (async () => {
      try {
        const res = await fetchEquityCurve(pubkeyParam, { days: 30 }, controller.signal);
        setCurve(res.points);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setCurve([]);
        setCurveFailed(true);
      }
    })();
    void (async () => {
      try {
        const res = await fetchHistory(pubkeyParam, { limit: HISTORY_PAGE }, controller.signal);
        setHistory(res.items);
        setHistoryCursor(res.nextCursor);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setHistory([]);
        setHistoryFailed(true);
      }
    })();
    return () => controller.abort();
  }, [pubkeyParam, validKey, isPrivate]);

  const loadMoreHistory = async () => {
    if (!historyCursor || historyLoadingMore) return;
    setHistoryLoadingMore(true);
    try {
      const res = await fetchHistory(pubkeyParam, {
        limit: HISTORY_PAGE,
        cursor: historyCursor,
      });
      setHistory((prev) => [...(prev ?? []), ...res.items]);
      setHistoryCursor(res.nextCursor);
    } catch {
      // keep the current list; cursor stays so the user can retry
    } finally {
      setHistoryLoadingMore(false);
    }
  };

  const onFollow = async () => {
    if (followBusy || !profilePayload) return;
    setFollowBusy(true);
    setFollowError(null);
    const wasFollowing = profilePayload.viewer?.isFollowing ?? false;
    // Optimistic flip; reverted on any failure.
    setProfilePayload({
      ...profilePayload,
      viewer: { isFollowing: !wasFollowing },
      stats: {
        ...profilePayload.stats,
        followers: profilePayload.stats.followers + (wasFollowing ? -1 : 1),
      },
    });
    try {
      const token = await social.ensureAuth();
      const result = wasFollowing
        ? await unfollowWallet(token, pubkeyParam)
        : await followWallet(token, pubkeyParam);
      setProfilePayload((prev) =>
        prev
          ? {
              ...prev,
              viewer: { isFollowing: result.following },
              stats: { ...prev.stats, followers: result.followerCount },
            }
          : prev,
      );
    } catch (err) {
      setProfilePayload((prev) =>
        prev
          ? {
              ...prev,
              viewer: { isFollowing: wasFollowing },
              stats: {
                ...prev.stats,
                followers: prev.stats.followers + (wasFollowing ? 1 : -1),
              },
            }
          : prev,
      );
      setFollowError(
        err instanceof Error ? err.message : "The follow request failed — try again.",
      );
    } finally {
      setFollowBusy(false);
    }
  };

  const statsRow = profilePayload?.stats;
  const creatorStats = payload?.stats ?? null;
  const baskets = payload?.baskets ?? [];
  const basketCount = numeric(creatorStats?.basket_count);

  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* ---- social identity header ---- */}
      {validKey ? (
        <header className="pb-8">
          {profileStatus === "loading" ? (
            <div className="flex items-center gap-4" role="status" aria-label="Loading profile">
              <span className="sr-only">Loading profile</span>
              <Skeleton className="h-14 w-14 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
          ) : profileStatus === "error" ? (
            <p className="text-sm text-muted-foreground">
              Social profile unavailable — {profileError}
            </p>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-4">
                <SocialAvatar
                  wallet={pubkeyParam}
                  handle={profile?.handle}
                  displayName={profile?.displayName}
                  avatarUrl={profile?.avatarUrl}
                  size="md"
                />
                <div className="min-w-0">
                  <h1 className="text-3xl font-semibold tracking-tight">
                    {isPrivate ? (
                      <span
                        className="font-mono text-2xl tabular-nums"
                        title={pubkeyParam}
                      >
                        {truncateAddress(pubkeyParam, 4, 4)}
                      </span>
                    ) : profile ? (
                      profile.displayName?.trim() || `@${profile.handle}`
                    ) : (
                      <span
                        className="font-mono text-2xl tabular-nums text-muted-foreground"
                        title={pubkeyParam}
                      >
                        {truncateAddress(pubkeyParam, 4, 4)}
                      </span>
                    )}
                  </h1>
                  {profile && !isPrivate ? (
                    <p className="mt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                      @{profile.handle} · {truncateAddress(pubkeyParam, 4, 4)}
                    </p>
                  ) : null}
                  {profile && !isPrivate && profile.bio ? (
                    <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                      {profile.bio}
                    </p>
                  ) : null}
                  {isPrivate ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      This profile is private.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {isOwner ? (
                  <Button variant="outline" size="sm" onClick={() => setEditorOpen(true)}>
                    Edit profile
                  </Button>
                ) : profile && !isPrivate ? (
                  <Button
                    variant={profilePayload?.viewer?.isFollowing ? "outline" : "default"}
                    size="sm"
                    onClick={() => void onFollow()}
                    disabled={followBusy}
                  >
                    {followBusy
                      ? "…"
                      : profilePayload?.viewer?.isFollowing
                        ? "Following"
                        : "Follow"}
                  </Button>
                ) : null}
              </div>
            </div>
          )}

          {followError ? (
            <p role="alert" className="mt-3 text-sm text-foreground">
              {followError}
            </p>
          ) : null}

          {/* stats row — hidden for private profiles */}
          {!isPrivate && statsRow ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span className="font-mono tabular-nums">
                <span className="font-medium text-foreground">{statsRow.followers}</span>{" "}
                <span className="text-muted-foreground">followers</span>
              </span>
              <span className="font-mono tabular-nums">
                <span className="font-medium text-foreground">{statsRow.following}</span>{" "}
                <span className="text-muted-foreground">following</span>
              </span>
              <span className="font-mono tabular-nums">
                <span className="font-medium text-foreground">{statsRow.tradeCount}</span>{" "}
                <span className="text-muted-foreground">trades</span>
              </span>
              {profile?.createdAt ? (
                <span className="font-mono tabular-nums text-muted-foreground">
                  trader since {formatRelativeTime(profile.createdAt)}
                </span>
              ) : null}
            </div>
          ) : null}
        </header>
      ) : (
        <header className="pb-10">
          <h1 className="text-3xl font-semibold tracking-tight">
            Creator{" "}
            <span
              className="font-mono text-2xl tabular-nums text-muted-foreground"
              title={validKey ? pubkeyParam : undefined}
            >
              {validKey ? truncateAddress(pubkeyParam, 4, 4) : "invalid address"}
            </span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Baskets deployed by this wallet — stats stay empty until the indexer tracks activity.
          </p>
        </header>
      )}

      {!validKey && (
        <ErrorState
          className="mt-8"
          title="Invalid creator address"
          message={`"${truncateAddress(pubkeyParam || "—", 8, 6)}" is not a valid Solana public key. Creator profiles are keyed by the wallet that signed create_basket.`}
        />
      )}

      {/* ---- equity curve + trade history (public profiles only) ---- */}
      {validKey && !isPrivate ? (
        <section aria-label="Trading activity" className="border-t border-border py-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4">
            <h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Equity curve (30d)
            </h2>
            <p className="font-mono text-[11px] text-muted-foreground">
              estimated from on-chain snapshots · not advice
            </p>
          </div>
          <div className="rounded-xl bg-card shadow-sm ring-1 ring-border dark:shadow-xl dark:shadow-black/20">
            <div className="p-5">
              {curve === null ? (
                <div role="status" aria-label="Loading equity curve" className="flex h-[280px] items-end gap-2 p-4">
                  <span className="sr-only">Loading equity curve</span>
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="flex-1" style={{ height: `${25 + i * 10}%` }} />
                  ))}
                </div>
              ) : (
                <EquityCurveChart points={curve} />
              )}
            </div>
          </div>
          {curveFailed ? (
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              Snapshot series unavailable right now.
            </p>
          ) : null}

          <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 pt-10">
            <h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Trade history
            </h2>
          </div>
          {history === null ? (
            <div className="space-y-2" role="status" aria-label="Loading trade history">
              <span className="sr-only">Loading trade history</span>
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="ml-auto h-4 w-20" />
                </div>
              ))}
            </div>
          ) : historyFailed ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              Trade history unavailable right now.
            </p>
          ) : history.length === 0 ? (
            <EmptyState
              chip="EMPTY"
              title="No trades indexed yet"
              description="Mints and redeems on public baskets by this wallet appear here."
            />
          ) : (
            <>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {history.map((item, index) => {
                  const minted = item.type === "Minted";
                  return (
                    <li
                      key={`${item.sig}-${index}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
                    >
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                          minted
                            ? "border-[hsl(var(--chart-1)/40)] bg-[hsl(var(--chart-1)/10)] text-[hsl(var(--chart-1))]"
                            : "border-[hsl(var(--chart-2)/40)] bg-[hsl(var(--chart-2)/10)] text-[hsl(var(--chart-2))]"
                        }`}
                      >
                        {item.type}
                      </span>
                      <Link
                        href={`/basket/${item.basket}`}
                        title={item.basket}
                        className="min-w-0 truncate text-sm font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {item.basketName ?? truncateAddress(item.basket, 6, 4)}
                      </Link>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {formatTokenAmount(item.shares, { maximumFractionDigits: 2 })} shares
                      </span>
                      <span className="ml-auto font-mono text-xs tabular-nums text-foreground">
                        {item.usdValue !== null ? formatUsd(item.usdValue) : "—"}
                      </span>
                      <span className="w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                        {formatRelativeTime(item.ts)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {historyCursor ? (
                <div className="flex justify-center pt-4">
                  <Button variant="outline" size="sm" onClick={() => void loadMoreHistory()} disabled={historyLoadingMore}>
                    {historyLoadingMore ? "Loading…" : "Load more"}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {/* ---- existing indexer-fed creator section (unchanged behavior) ---- */}
      {status === "loading" && (
        <div className="mt-2 border-t border-border py-8" role="status" aria-label="Loading creator profile">
          <span className="sr-only">Loading creator profile</span>
          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} aria-hidden="true" className="rounded-lg border border-border bg-card p-5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-2 h-8 w-24" />
              </div>
            ))}
          </div>
          <div className="mt-8 grid gap-3 sm:grid-cols-2" aria-hidden="true">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-3 h-8 w-24" />
              </div>
            ))}
          </div>
        </div>
      )}

      {status === "not-indexed" && (
        <div className="border-t border-border py-8">
          <EmptyState
            className="mt-4"
            chip="NOT INDEXED"
            title="Creator stats appear once the indexer tracks activity"
            description={`No baskets or fee history are indexed for ${truncateAddress(pubkeyParam, 6, 6)} yet — deploy a basket with this wallet and the profile fills in from BasketCreated events.`}
            action={
              <Link
                href="/create"
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Open the create wizard
              </Link>
            }
          />
        </div>
      )}

      {status === "error" && (
        <div className="border-t border-border py-8">
          <ErrorState
            title="Creator data unavailable"
            message={error ?? "The creators API did not respond."}
            onRetry={() => setReloadToken((token) => token + 1)}
          />
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Until the indexer responds, no creator figures are shown — an empty
            state is preferred over a wrong number.
          </p>
        </div>
      )}

      {status === "ready" && payload && (
        <>
          {/* metric strip — same tile language as the basket-detail page */}
          <div className="grid gap-3 border-t border-border py-8 sm:grid-cols-3">
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardDescription>Baskets created</CardDescription>
                <CardTitle className="font-mono text-2xl tabular-nums">
                  {basketCount ?? baskets.length}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardDescription>Total AUM (indexed)</CardDescription>
                <CardTitle className="font-mono text-2xl tabular-nums">
                  {creatorStats ? (() => {
                    const aum = numeric(creatorStats.total_aum);
                    return aum === null ? "—" : formatUsd(aum);
                  })() : "—"}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardDescription>Fees earned (indexed)</CardDescription>
                <CardTitle className="font-mono text-2xl tabular-nums">
                  {creatorStats ? (() => {
                    const fees = numeric(creatorStats.total_fees_earned);
                    return fees === null ? "—" : formatUsd(fees);
                  })() : "—"}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <section aria-labelledby="creator-baskets" className="pb-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
              <h2 id="creator-baskets" className="text-sm font-medium tracking-tight">
                Baskets
              </h2>
              <FreshnessBadge
                source={payload.source ?? "creators · /api/v1/creators/:pubkey"}
                asOf={payload.asOf ?? undefined}
              />
            </div>
            {baskets.length === 0 ? (
              <EmptyState
                className="mt-4"
                chip="NOT INDEXED"
                title="No indexed baskets"
                description="The stats row exists but no baskets are linked to this creator yet."
              />
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {baskets.map((row) => {
                  const nav = numeric(row.nav);
                  const unavailable = nav === null;
                  return (
                    <Link
                      key={row.pubkey}
                      href={`/basket/${row.pubkey}`}
                      title={`Open basket ${row.pubkey}`}
                      className="group flex flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className="block break-words font-mono text-sm font-medium tracking-tight text-foreground"
                          title={row.pubkey}
                        >
                          {truncateAddress(row.pubkey, 6, 4)}
                        </span>
                        {unavailable ? (
                          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                            not indexed
                          </span>
                        ) : null}
                      </div>
                      <span
                        className={`mt-4 font-mono text-2xl tabular-nums ${
                          unavailable ? "text-muted-foreground" : "text-foreground"
                        }`}
                      >
                        {nav === null ? "—" : formatUsd(nav)}
                      </span>
                      <span className="mt-0.5 text-xs text-muted-foreground">
                        {row.share_mint
                          ? `Share mint ${truncateAddress(row.share_mint, 4, 4)}`
                          : "Share mint —"}
                      </span>
                      <div className="mt-auto border-t border-border/60 pt-3">
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Created
                        </span>
                        <span className="block font-mono text-xs tabular-nums">
                          {row.created_at ? formatAsOf(row.created_at) : "—"}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <p className="border-t border-border py-6 text-xs leading-5 text-muted-foreground">
            Creator stats describe baskets this wallet deployed. They are not an
            endorsement of any basket, and creators are not licensed advisers
            unless separately verified.{" "}
            <LegalReviewTag />
          </p>
        </>
      )}

      {isOwner ? (
        <ProfileEditorModal
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            void loadProfile();
            setEditorOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
