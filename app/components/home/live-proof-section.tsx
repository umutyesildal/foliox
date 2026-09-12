"use client";

/**
 * Live proof section — the conversion centerpiece of the "proof beats
 * process" home refresh (NEON FOUNDRY, 2026-09-12): live on-chain evidence
 * placed before any process talk. Two columns:
 *
 *   Left  — "Latest verified trades": first page of GET /api/v1/feed
 *           (?type=trades&limit=3), rendered as single-sentence rows —
 *           "<actor> bought 12.5 shares of <basket>" — with a compact
 *           usd-value / time block on the right.
 *   Right — "Top baskets": GET /api/v1/leaderboard/baskets through an
 *           adaptive window cascade (30d -> 7d -> all-time; the first window
 *           with rows wins) so a quiet board never shows an empty column and
 *           absurd all-time devnet mock deltas never lead the surface. The
 *           header labels whichever window was actually used.
 *
 * FRIENDLY PREVIEW (owner feedback, 2026-09-12): same honest data, warmer
 * presentation — this is a marketing surface, not a terminal. No semantic
 * red here: Minted/Redeemed read as the words "bought"/"sold" (positive
 * green on bought only; the red Redeem badges stay inside /feed), basket
 * deltas follow the same rule (green when positive, muted otherwise — a
 * losing basket is stated, not shouted), no badges
 * at all, and anonymous wallets hide behind "a trader" (ActorLine
 * friendlyFallback). Nothing is fabricated — the wallet address stays on
 * the label's title attribute, null usdValue renders "—", a null basket
 * name reads "a basket" (pubkey in the title attr), and every figure is
 * still the real on-chain one.
 *
 * Both poll silently every 60s while the tab is visible (same visibility
 * gate as feed-client; no manual refresh — this is a preview) and degrade
 * honestly: skeleton rows while loading, one quiet retry line when the
 * backend is unreachable, one muted line when nothing exists yet. A failed
 * silent refresh keeps the last good list on screen; only a resource that
 * has never loaded shows the error.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SectionHeader } from "@/components/ui/section-header";
import { ActorLine } from "@/components/social/avatar";
import { Skeleton } from "@/components/states";
import {
  formatRelativeTime,
  formatTokenAmount,
  formatUsd,
  truncateAddress,
} from "@/lib/format";
import {
  fetchBasketLeaderboard,
  fetchFeed,
  type BasketLeaderboardEntry,
  type BasketLeaderboardWindow,
  type TradeFeedItem,
} from "@/lib/social-api";

/** Silent poll cadence — previews stay fresh without a refresh button. */
const POLL_MS = 60_000;

/** Row count per column — the trades fetch limit and both skeletons' rows. */
const PREVIEW_ROW_COUNT = 3;

// ---------------------------------------------------------------------------
// Loaders — module-level so their identity is stable and the polling effect
// never re-arms on re-render.
// ---------------------------------------------------------------------------

async function loadRecentTrades(signal: AbortSignal): Promise<TradeFeedItem[]> {
  const payload = await fetchFeed({ type: "trades", limit: PREVIEW_ROW_COUNT }, signal);
  // The endpoint already filters to trades; filter defensively anyway so a
  // backend regression can never push a thesis into the proof section.
  return payload.items.filter((item): item is TradeFeedItem => item.kind === "trade");
}

/** What the baskets column renders, plus the window that actually produced it. */
interface BasketsSnapshot {
  items: BasketLeaderboardEntry[];
  window: BasketLeaderboardWindow;
}

/** Cascade order: 30d first, then 7d, then all-time. */
const BASKETS_WINDOW_CASCADE = ["30d", "7d", "all"] as const;

/**
 * Adaptive window cascade — the first window with rows wins. A quiet devnet
 * board would render an empty 30d column, so the loader widens/narrows
 * through the fallbacks until something honest shows; the header then labels
 * the window actually used. One AbortController signal covers the whole
 * cascade — aborting the resource cancels whichever leg is in flight.
 */
async function loadTopBaskets(signal: AbortSignal): Promise<BasketsSnapshot> {
  let usedWindow: BasketLeaderboardWindow = "all";
  for (const win of BASKETS_WINDOW_CASCADE) {
    usedWindow = win;
    const payload = await fetchBasketLeaderboard(win, signal);
    if (payload.items.length > 0) {
      return { items: payload.items, window: win };
    }
  }
  return { items: [], window: usedWindow };
}

// ---------------------------------------------------------------------------
// Shared polling hook — initial load + visibility-gated silent interval,
// mirroring feed-client's lifecycle (abort on supersede/unmount, in-flight
// poll skip, silent failures keep stale data).
// ---------------------------------------------------------------------------

interface LiveResource<T> {
  data: T | null;
  status: "loading" | "ready" | "error";
  /** Wall-clock time of the last SUCCESSFUL fetch — drives the freshness stamp. */
  fetchedAt: Date | null;
  retry: () => void;
}

function useLiveResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  pollMs: number,
): LiveResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<LiveResource<T>["status"]>("loading");
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [attempt, setAttempt] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const hasDataRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    const run = async () => {
      // Abort any in-flight fetch, then start fresh — superseded runs settle
      // as AbortError and never touch state (their guards below).
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      inFlightRef.current = true;
      try {
        const next = await load(controller.signal);
        if (disposed || abortRef.current !== controller) return;
        hasDataRef.current = true;
        setData(next);
        setFetchedAt(new Date());
        setStatus("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (disposed || abortRef.current !== controller) return;
        // A failed silent refresh keeps the last good list on screen; only a
        // resource that has never loaded surfaces the error line.
        if (!hasDataRef.current) setStatus("error");
      } finally {
        if (abortRef.current === controller) inFlightRef.current = false;
      }
    };
    void run();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !inFlightRef.current) void run();
    }, pollMs);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [load, pollMs, attempt]);

  return { data, status, fetchedAt, retry: () => setAttempt((n) => n + 1) };
}

// ---------------------------------------------------------------------------
// Column furniture — header stamp, skeleton, quiet error, footer link.
// ---------------------------------------------------------------------------

/** Mono micro-label + right-aligned muted freshness stamp. */
function ColumnHeader({ label, fetchedAt }: { label: string; fetchedAt: Date | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="section-label">{label}</h3>
      {/* Freshness stamp — the wall-clock time of the last successful fetch,
          muted; nothing renders before the first load succeeds. */}
      {fetchedAt ? (
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          updated {formatRelativeTime(fetchedAt)}
        </span>
      ) : null}
    </div>
  );
}

/** Loading rows in the FeedSkeleton shape (avatar circle + two bars),
 *  compacted to the preview row rhythm. */
function PreviewSkeleton({ rows, label }: { rows: number; label: string }) {
  return (
    <div role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div className="divide-y divide-border" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-start gap-3 py-3 pl-4">
            <Skeleton className="h-7 w-7 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-full max-w-[240px]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One quiet muted line + retry — ErrorState is too heavy for a preview. */
function QuietError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="py-3 pl-4">
      <p className="text-xs text-muted-foreground">
        {message}{" "}
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Retry
        </button>
      </p>
    </div>
  );
}

/** Footer link in the home sections' shared arrow language: the ↗ lifts
 *  and warms. */
function FooterLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="group mt-5 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {children}
      <span
        aria-hidden="true"
        className="font-mono text-sm text-muted-foreground transition-all duration-200 group-hover:-translate-y-0.5 group-hover:text-primary-text motion-reduce:transform-none motion-reduce:transition-none"
      >
        ↗
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Left column — latest verified trades, one sentence per trade.
// ---------------------------------------------------------------------------

function TradesColumn({ resource }: { resource: LiveResource<TradeFeedItem[]> }) {
  return (
    <div>
      <ColumnHeader label="LATEST VERIFIED TRADES" fetchedAt={resource.fetchedAt} />
      {resource.status === "loading" ? (
        <PreviewSkeleton rows={PREVIEW_ROW_COUNT} label="Loading verified trades" />
      ) : null}
      {resource.status === "error" ? (
        <QuietError message="Couldn't load verified trades just now." onRetry={resource.retry} />
      ) : null}
      {resource.status === "ready" && resource.data ? (
        resource.data.length === 0 ? (
          <p className="py-3 pl-4 text-sm leading-6 text-muted-foreground">
            No verified trades yet — be the first to build one.{" "}
            <Link
              href="/create"
              className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Create an index →
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {resource.data.map((item, index) => {
              const minted = item.type === "Minted";
              // Skip the shares phrase when the count is absent/zero rather
              // than fabricating "0 shares bought …".
              const hasShares = Number.isFinite(item.shares) && item.shares > 0;
              return (
                <li
                  key={`${item.sig}-${index}`}
                  className="flex items-center gap-3 border-l-2 border-l-primary/0 py-3 pl-4 transition-colors hover:border-l-primary/60"
                >
                  {/* Actor + label, capped so a long displayName truncates
                      before it crowds the sentence; friendlyFallback renders
                      anonymous wallets as "a trader" (wallet stays on title). */}
                  <ActorLine
                    wallet={item.wallet}
                    handle={item.handle}
                    displayName={item.displayName}
                    avatarUrl={item.avatarUrl}
                    friendlyFallback
                    emphasis
                    className="max-w-[45%] shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    <span
                      className={
                        minted
                          ? "font-medium text-[hsl(var(--status-positive))]"
                          : "text-muted-foreground"
                      }
                    >
                      {minted ? "bought" : "sold"}
                    </span>
                    {hasShares ? ` ${formatTokenAmount(item.shares)} shares of ` : " "}
                    <Link
                      href={`/basket/${item.basket}`}
                      title={item.basket}
                      className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {item.basketName ?? "a basket"}
                    </Link>
                  </span>
                  {/* Compact two-line right block: real USD (em dash when
                      null) over the muted relative time. */}
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-sm font-semibold tabular-nums text-foreground">
                      {item.usdValue !== null ? formatUsd(item.usdValue) : "—"}
                    </span>
                    <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-muted-foreground">
                      {formatRelativeTime(item.ts)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
      <FooterLink href="/feed">Open the feed</FooterLink>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right column — top baskets (adaptive window).
// ---------------------------------------------------------------------------

/** "+X.XX%" convention — negatives already carry their own sign. */
function formatReturnPct(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

/** Header label for the window the cascade actually used. */
function windowLabel(win: BasketLeaderboardWindow): string {
  return win === "all" ? "ALL-TIME" : win.toUpperCase();
}

function BasketsColumn({ resource }: { resource: LiveResource<BasketsSnapshot> }) {
  return (
    <div>
      <ColumnHeader
        label={
          resource.data ? `TOP BASKETS · ${windowLabel(resource.data.window)}` : "TOP BASKETS"
        }
        fetchedAt={resource.fetchedAt}
      />
      {resource.status === "loading" ? (
        <PreviewSkeleton rows={PREVIEW_ROW_COUNT} label="Loading top baskets" />
      ) : null}
      {resource.status === "error" ? (
        <QuietError message="Couldn't load the leaderboard just now." onRetry={resource.retry} />
      ) : null}
      {resource.status === "ready" && resource.data ? (
        resource.data.items.length === 0 ? (
          <p className="py-3 pl-4 text-sm leading-6 text-muted-foreground">
            The board builds as baskets trade.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {resource.data.items.map((entry, index) => {
              const positive = entry.returnPct >= 0;
              const nav = entry.nav.trim() === "" ? NaN : Number(entry.nav);
              return (
                <li
                  key={`${entry.basket}-${index}`}
                  className="border-l-2 border-l-primary/0 py-3 pl-4 transition-colors hover:border-l-primary/60"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-baseline gap-3">
                      <span
                        aria-hidden="true"
                        className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground/70"
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <Link
                        href={`/basket/${entry.basket}`}
                        title={entry.basket}
                        className="min-w-0 truncate text-sm font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {entry.basketName ?? truncateAddress(entry.basket, 6, 4)}
                      </Link>
                    </span>
                    <span
                      className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${
                        positive ? "text-[hsl(var(--status-positive))]" : "text-muted-foreground"
                      }`}
                    >
                      {formatReturnPct(entry.returnPct)}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                    NAV {Number.isFinite(nav) ? formatUsd(nav) : "—"} ·{" "}
                    {entry.holders} {entry.holders === 1 ? "holder" : "holders"}
                  </p>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
      <FooterLink href="/leaderboard">Full leaderboard</FooterLink>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section.
// ---------------------------------------------------------------------------

export function LiveProofSection() {
  const trades = useLiveResource(loadRecentTrades, POLL_MS);
  const baskets = useLiveResource(loadTopBaskets, POLL_MS);

  return (
    <section
      aria-labelledby="proof-heading"
      className="border-t border-border py-16 dark:border-border/60"
    >
      {/* Site rhythm: sibling home sections own their container inside the
          page's centered main (flow: 5xl, ledger: 3xl) — this one spans the
          full 6xl content width. */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeader
          id="proof-heading"
          size="eyebrow"
          label="VERIFIED ACTIVITY · LIVE"
          lead="What people are building and trading right now."
        />
        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          <TradesColumn resource={trades} />
          <BasketsColumn resource={baskets} />
        </div>
      </div>
    </section>
  );
}
