"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEMO_THESES, DEMO_TRADES } from "@/components/home/home-demo-data";
import { ErrorState, EmptyState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { RangeLinks } from "@/components/ui/range-links";
import { ActorLine, SocialAvatar } from "@/components/social/avatar";
import { ThesisComposerModal } from "@/components/social/thesis-composer";
import { isDemoMode } from "@/lib/demo-mode";
import { formatRelativeTime, formatTokenAmount, formatUsd, truncateAddress } from "@/lib/format";
import {
  fetchFeed,
  fetchPost,
  fetchComments,
  likePost,
  unlikePost,
  SocialApiError,
  type FeedItem,
  type FeedPayload,
  type FullPost,
  type CommentItem,
} from "@/lib/social-api";
import { useSocialAuth } from "@/lib/social-auth";

const PAGE_LIMIT = 20;
const POLL_MS = 30_000;

type Tab = "all" | "following" | "theses";
const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "following", label: "Following" },
  { value: "theses", label: "Theses" },
];

function tabQuery(tab: Tab): { scope: "all" | "following"; type: "all" | "trades" | "theses" } {
  if (tab === "following") return { scope: "following", type: "all" };
  if (tab === "theses") return { scope: "all", type: "theses" };
  return { scope: "all", type: "all" };
}

/**
 * Unified social feed: All / Following / Theses tabs over GET /feed, 30s
 * polling with manual refresh, cursor "Load more". Trade cards link the
 * trader's profile and the basket; thesis cards expand inline (GET /posts/:id
 * + comments) with an optimistic like button gated behind wallet sign-in.
 *
 * Demo overlay (NEXT_PUBLIC_HOME_DEMO=1): renders the static labeled dataset
 * from home-demo-data.ts instead — zero network calls, zero auth prompts, no
 * polling, no composer. Flag off → FeedClientReal below, byte-identical.
 */
export default function FeedClient() {
  if (isDemoMode()) {
    return <DemoFeed />;
  }
  return <FeedClientReal />;
}

function FeedClientReal() {
  const social = useSocialAuth();
  const [tab, setTab] = useState<Tab>("all");

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  const load = useCallback(
    async (which: Tab, opts?: { cursor?: string | null; silent?: boolean }) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const query = tabQuery(which);
      // Only the initial/tab-switch load shows the full skeleton; cursor and
      // silent refreshes keep the current list on screen.
      if (!opts?.cursor && !opts?.silent) setStatus("loading");
      if (opts?.cursor) setLoadingMore(true);
      else if (opts?.silent) setRefreshing(true);
      try {
        const payload: FeedPayload = await fetchFeed(
          { ...query, limit: PAGE_LIMIT, cursor: opts?.cursor ?? null },
          controller.signal,
        );
        setItems((prev) => (opts?.cursor ? [...prev, ...payload.items] : payload.items));
        setNextCursor(payload.nextCursor);
        setNote(payload.note ?? null);
        setError(null);
        setStatus("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not reach the social feed.");
        if (!opts?.cursor) setStatus("error");
      } finally {
        inFlightRef.current = false;
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [],
  );

  // Initial + tab-switch load.
  useEffect(() => {
    void load(tab);
    return () => abortRef.current?.abort();
  }, [tab, load]);

  // 30s polling — silent first-page refresh, skipped while a fetch is active.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(tab, { silent: true });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [tab, load]);

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    void load(tab, { cursor: nextCursor });
  };

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="flex flex-wrap items-baseline justify-between gap-3 pb-6">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Feed</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Trades and theses from public Basalt baskets — self-reported, not advice.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void load(tab, { silent: true })}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <Button size="sm" onClick={() => setComposerOpen(true)}>
            Write thesis
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <RangeLinks
          options={TABS}
          value={tab}
          onChange={(next) => setTab(next)}
          label={null}
          ariaLabel="Feed scope"
        />
        {tab === "following" && !social.isAuthed ? (
          <p className="text-xs text-muted-foreground">
            Sign in with your wallet to see traders you follow.
          </p>
        ) : null}
      </div>

      {status === "loading" ? <FeedSkeleton /> : null}

      {status === "error" ? (
        <div className="pt-6">
          <ErrorState
            title="Feed unavailable"
            message={error ?? "Could not reach the social feed."}
            onRetry={() => void load(tab)}
          />
        </div>
      ) : null}

      {status === "ready" ? (
        <>
          {note ? (
            <p className="pt-4 font-mono text-[11px] text-muted-foreground">{note}</p>
          ) : null}
          {items.length === 0 ? (
            <div className="pt-6">
              {tab === "following" && !social.isAuthed ? (
                <EmptyState
                  chip="NO WALLET"
                  title="Sign in to follow traders"
                  description="The Following tab shows trades and theses from wallets you follow. Connect your wallet and sign in to build your list."
                  action={
                    <Button size="sm" onClick={() => void social.ensureAuth().catch(() => undefined)}>
                      {social.authing ? "Signing in…" : "Sign in with wallet"}
                    </Button>
                  }
                />
              ) : tab === "following" && social.isAuthed ? (
                <EmptyState
                  chip="EMPTY"
                  title="Your following feed is quiet"
                  description="Open any trader's profile and follow them — their trades and theses will appear here."
                  action={
                    <Button render={<Link href="/leaderboard" />} size="sm">
                      Browse the leaderboard
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  chip="EMPTY"
                  title={tab === "theses" ? "No theses published yet" : "No public trades yet"}
                  description={
                    tab === "theses"
                      ? "Be the first — open a basket and write the reasoning behind it."
                      : "Trades on public baskets appear here as they are indexed."
                  }
                  action={
                    <Button size="sm" onClick={() => setComposerOpen(true)}>
                      Write the first thesis
                    </Button>
                  }
                />
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item, index) =>
                item.kind === "trade" ? (
                  <TradeCard key={`${item.sig}-${index}`} item={item} />
                ) : (
                  <ThesisCard key={item.id} item={item} social={social} />
                ),
              )}
            </ul>
          )}

          {nextCursor ? (
            <div className="flex justify-center pt-6">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      <ThesisComposerModal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onPosted={() => void load(tab, { silent: true })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo overlay (NEXT_PUBLIC_HOME_DEMO=1) — the same labeled datasets as the
// home live-proof band. No network, no auth, no polling: the flag branch in
// FeedClient returns here before any real fetch/auth code ever mounts.
// ---------------------------------------------------------------------------

/** The mono chip that keeps the demo overlay honest — same as home's. */
function DemoChip() {
  return (
    <span
      title="Synthetic demo data — not live activity"
      className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground"
    >
      demo data
    </span>
  );
}

/**
 * Static demo feed: DEMO_TRADES + DEMO_THESES merged by recency over the
 * real tab row. Every API-hitting affordance is disabled — no refresh, no
 * composer, no likes, no expand fetch (negative demo ids would 404 on
 * GET /posts/:id by design).
 */
function DemoFeed() {
  const [tab, setTab] = useState<Tab>("all");
  // Demo timestamps are computed at module load, so the prerendered HTML
  // would carry stale relative labels and hydration would see different
  // strings — show the static skeleton until the client has mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const items = useMemo(() => {
    const merged = [...DEMO_TRADES, ...DEMO_THESES].sort(
      (a, b) => Date.parse(b.ts) - Date.parse(a.ts),
    );
    // Demo has no follow graph — Following shows everything too; the tab
    // still switches so the demo audience can exercise the real tab row.
    return tab === "theses" ? merged.filter((item) => item.kind === "thesis") : merged;
  }, [tab]);

  if (!mounted) return <FeedSkeleton />;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="flex flex-wrap items-baseline justify-between gap-3 pb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl font-semibold tracking-tight">Feed</h1>
            <DemoChip />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Trades and theses from public Basalt baskets — self-reported, not advice.
          </p>
        </div>
        {/* Refresh / Write thesis are hidden in demo — both would need the API. */}
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <RangeLinks
          options={TABS}
          value={tab}
          onChange={(next) => setTab(next)}
          label={null}
          ariaLabel="Feed scope"
        />
        {tab === "following" ? (
          <p className="text-xs text-muted-foreground">
            Demo mode has no follows — showing the full feed.
          </p>
        ) : null}
      </div>

      <ul className="divide-y divide-border">
        {items.map((item, index) =>
          item.kind === "trade" ? (
            <TradeCard key={`${item.sig}-${index}`} item={item} />
          ) : (
            <ThesisCard key={item.id} item={item} social={null} demo />
          ),
        )}
      </ul>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="pt-2" role="status" aria-label="Loading feed">
      <span className="sr-only">Loading feed</span>
      <div className="divide-y divide-border" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-start gap-3 py-4">
            <Skeleton className="h-7 w-7 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full max-w-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Trade row: actor, side badge (chart tokens), basket link, shares + USD. */
function TradeCard({ item }: { item: Extract<FeedItem, { kind: "trade" }> }) {
  const minted = item.type === "Minted";
  return (
    // Borderless divider list → the row earns a 2px yellow left accent on
    // hover only (thesis rows keep a quiet static one) — never full borders.
    <li className="border-l-2 border-l-primary/0 py-4 pl-4 transition-colors hover:border-l-primary/60">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={`/creator/${item.wallet}`}
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ActorLine
              emphasis
              wallet={item.wallet}
              handle={item.handle}
              displayName={item.displayName}
              avatarUrl={item.avatarUrl}
            />
          </Link>
          <span
            className={`shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
              minted
                ? "border-[hsl(var(--status-positive)/40)] bg-[hsl(var(--status-positive)/10)] text-[hsl(var(--status-positive))]"
                : "border-[hsl(var(--destructive)/40)] bg-[hsl(var(--destructive)/10)] text-[hsl(var(--destructive))]"
            }`}
          >
            {item.type}
          </span>
        </div>
        <div className="flex shrink-0 items-baseline gap-x-3">
          {/* USD is the headline number (sentence below no longer repeats it). */}
          <span className="text-right leading-tight">
            <span className="block font-mono text-sm font-semibold tabular-nums text-foreground">
              {item.usdValue !== null ? formatUsd(item.usdValue) : "—"}
            </span>
            <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-muted-foreground">
              {formatTokenAmount(item.shares, { maximumFractionDigits: 2 })} shares
            </span>
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {formatRelativeTime(item.ts)}
          </span>
        </div>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {minted ? "Bought" : "Sold"}{" "}
        <span className="font-mono tabular-nums text-foreground">
          {formatTokenAmount(item.shares, { maximumFractionDigits: 2 })}
        </span>{" "}
        shares of{" "}
        <Link
          href={`/basket/${item.basket}`}
          className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          title={item.basket}
        >
          {item.basketName ?? truncateAddress(item.basket, 6, 4)}
        </Link>
      </p>
    </li>
  );
}

/**
 * Thesis card: excerpt + inline expansion (GET /posts/:id brings the full body
 * and the true likedByMe), optimistic like gated behind wallet sign-in.
 *
 * Demo mode (`demo`) freezes every API affordance: the full body renders
 * inline (no expand fetch — negative demo ids 404 on /posts/:id by design),
 * the like button becomes a static count and no comments panel is reachable.
 */
function ThesisCard({
  item,
  social,
  demo = false,
}: {
  item: Extract<FeedItem, { kind: "thesis" }>;
  /** Real mode only — the wallet sign-in hook. `null` in demo mode. */
  social: ReturnType<typeof useSocialAuth> | null;
  demo?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState<FullPost | null>(null);
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [expandError, setExpandError] = useState<string | null>(null);

  const [likeCount, setLikeCount] = useState(item.likeCount);
  const [liked, setLiked] = useState(false);
  const [liking, setLiking] = useState(false);

  const toggleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (!next || full) return;
    setExpandError(null);
    try {
      const [postRes, commentsRes] = await Promise.all([
        fetchPost(item.id),
        fetchComments(item.id).catch(() => null),
      ]);
      setFull(postRes.post);
      setLikeCount(postRes.post.likeCount);
      setLiked(postRes.post.likedByMe);
      setComments(commentsRes?.items ?? []);
    } catch (err) {
      setExpandError(err instanceof Error ? err.message : "Could not load the full thesis.");
    }
  };

  const onLike = async () => {
    if (!social) return; // demo mode never wires this handler
    if (liking) return;
    setLiking(true);
    const wasLiked = liked;
    // Optimistic: flip immediately; revert to the server value on failure.
    // `liked` is only ever true from our own successful like or the full-post
    // fetch, so the DELETE toggle never removes a like we did not know about.
    setLiked(!wasLiked);
    setLikeCount((count) => count + (wasLiked ? -1 : 1));
    try {
      const token = await social.ensureAuth();
      const result = wasLiked
        ? await unlikePost(token, item.id)
        : await likePost(token, item.id);
      setLikeCount(result.likeCount);
      setLiked(result.likedByMe);
    } catch (err) {
      setLiked(wasLiked);
      setLikeCount(item.likeCount);
      if (err instanceof Error && !(err instanceof SocialApiError && err.status === 0)) {
        setExpandError(err.message);
      }
    } finally {
      setLiking(false);
    }
  };

  return (
    // Quiet static left accent — thesis rows are content, not hover targets
    // for the whole row, so the accent never turns yellow here.
    <li className="border-l-2 border-l-border/60 py-4 pl-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Link
          href={`/creator/${item.wallet}`}
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ActorLine
            emphasis
            wallet={item.wallet}
            handle={item.handle}
            displayName={item.displayName}
            avatarUrl={item.avatarUrl}
          />
        </Link>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatRelativeTime(item.ts)}
        </span>
      </div>

      {demo ? (
        // Demo: bodyTruncated is ignored — demo bodies are stored in full, so
        // render straight through with no expand button and no Read more.
        <div className="mt-2">
          <span className="block text-[15px] font-semibold text-foreground">{item.title}</span>
          <span className="mt-1 block whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
            {item.body}
          </span>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => void toggleExpand()}
            aria-expanded={expanded}
            className="mt-2 block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="block text-[15px] font-semibold text-foreground">{item.title}</span>
            <span className="mt-1 block whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {expanded && full ? full.body : item.body}
              {expanded && !full ? "" : item.bodyTruncated && !expanded ? "…" : ""}
            </span>
          </button>
          {!expanded && item.bodyTruncated ? (
            <button
              type="button"
              onClick={() => void toggleExpand()}
              className="mt-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Read more
            </button>
          ) : null}
        </>
      )}

      {expandError ? (
        <p role="alert" className="mt-2 text-xs text-foreground">
          {expandError}{" "}
          <button
            type="button"
            onClick={() => {
              setFull(null);
              void toggleExpand();
            }}
            className="underline underline-offset-4"
          >
            Retry
          </button>
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {item.basket ? (
          <Link
            href={`/basket/${item.basket}`}
            className="inline-flex items-center gap-1.5 rounded-sm bg-accent px-2 py-0.5 font-mono text-[11px] text-accent-foreground transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            title={item.basket}
          >
            <span aria-hidden="true" className="text-accent-foreground/70">
              basket
            </span>
            {item.basketName ?? truncateAddress(item.basket, 4, 4)}
          </Link>
        ) : null}
        {demo ? (
          // Demo: static count, no handler — likes are write endpoints and
          // must never fire against the synthetic dataset.
          <span
            title="Demo data"
            className="inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-xs tabular-nums text-muted-foreground"
          >
            <span aria-hidden="true">♡</span>
            {item.likeCount}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void onLike()}
            disabled={liking}
            aria-pressed={liked}
            className={`inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
              liked ? "text-primary-text" : "text-muted-foreground hover:text-foreground"
            }`}
            title={social?.isAuthed ? undefined : "Sign-in with your wallet is requested on like"}
          >
            <span aria-hidden="true">{liked ? "♥" : "♡"}</span>
            {likeCount}
          </button>
        )}
        <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
          <span aria-hidden="true">💬</span>
          {item.commentCount}
        </span>
      </div>

      {expanded && full ? (
        <div className="mt-3 space-y-3 rounded-sm border border-border bg-card p-4">
          {comments === null ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading comments…
            </p>
          ) : comments.length === 0 ? (
            <p className="text-xs text-muted-foreground">No comments yet.</p>
          ) : (
            <ul className="space-y-3">
              {comments.map((comment) => (
                <li key={comment.id} className="flex items-start gap-2.5">
                  <SocialAvatar
                    wallet={comment.wallet}
                    handle={comment.handle}
                    displayName={comment.displayName}
                    avatarUrl={comment.avatarUrl}
                  />
                  <div className="min-w-0">
                    <p className="text-xs">
                      <Link
                        href={`/creator/${comment.wallet}`}
                        className="font-medium text-foreground hover:underline underline-offset-4"
                      >
                        {/* Handle first — comment rows reinforce usernames. */}
                        {comment.handle
                          ? `@${comment.handle}`
                          : comment.displayName?.trim() ||
                            truncateAddress(comment.wallet, 4, 4)}
                      </Link>
                      <span className="ml-2 font-mono text-[10px] tabular-nums text-muted-foreground">
                        {formatRelativeTime(comment.ts)}
                      </span>
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm leading-5 text-muted-foreground">
                      {comment.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}
