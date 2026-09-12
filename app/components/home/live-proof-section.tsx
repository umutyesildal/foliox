"use client";

/**
 * Live proof section — the conversion centerpiece of the "proof beats
 * process" home refresh (NEON FOUNDRY, 2026-09-12): live on-chain evidence
 * placed before any process talk. Two columns plus the merged steps strip:
 *
 *   Left  — "Latest verified trades": first page of GET /api/v1/feed
 *           (?type=trades), rendered as single-sentence rows — "<actor>
 *           bought 12.5 shares of <basket>" — with a basket avatar in the
 *           sentence and a compact usd-value / time block on the right.
 *   Right — "Top baskets": GET /api/v1/leaderboard/baskets through an
 *           adaptive window cascade (30d -> 7d -> all-time; the first
 *           window with rows wins) kept entirely internal — the header is
 *           just a link, it no longer labels which window was used.
 *   Below — the three-step PICK · OWN · SHARE strip (StepsStrip, merged
 *           into this section per owner feedback 2026-09-12 so proof and
 *           process live in one band).
 *
 * ANIMATED FEED (owner feedback, 2026-09-12): the trades column is a
 * rolling window — every 2.5s the next item from the queue surfaces at the
 * top (slides down from -100%, 250ms easeOut) while the oldest row exits
 * downward (+100%); middle rows glide via layout projection. Ticks pause
 * while the tab is hidden and swap without animation under
 * prefers-reduced-motion. Real mode rolls over the 12 fetched feed items;
 * the queue restarts from the newest item on every successful poll.
 *
 * DEMO OVERLAY (owner feedback, 2026-09-12): with NEXT_PUBLIC_HOME_DEMO=1
 * the section renders the labeled synthetic datasets from
 * home-demo-data.ts instead of fetching — real usernames + photos, basket
 * names, 1000+ holders — because synthetic DB rows are reaped by
 * positionsSync within ~2 minutes. The repo invariant "never fabricate
 * production-looking data" is preserved: the overlay is clearly chipped
 * ("demo data" mono chip by the header) and flag off = the real data path,
 * unchanged.
 *
 * FRIENDLY PREVIEW (owner feedback, 2026-09-12): a marketing surface, not
 * a terminal. No semantic red here: Minted/Redeemed read as the words
 * "bought"/"sold" (positive green on bought only), basket deltas are green
 * when positive and muted otherwise (a losing basket is stated, not
 * shouted), no badges, and anonymous wallets hide behind "a trader"
 * (ActorLine friendlyFallback). Nothing is fabricated in real mode — the
 * wallet address stays on the label's title attribute, null usdValue
 * renders "—", a null basket name reads "a basket" (pubkey in the title
 * attr), and every figure is still the real on-chain one.
 *
 * Real mode polls silently every 60s while the tab is visible and degrades
 * honestly: skeleton rows while loading, one quiet retry line when the
 * backend is unreachable, one muted line when nothing exists yet. A failed
 * silent refresh keeps the last good list on screen; only a resource that
 * has never loaded shows the error. Column headers are links (/feed,
 * /leaderboard); there are no footer links or freshness stamps anymore.
 */

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { DEMO_BASKETS, DEMO_TRADES } from "@/components/home/home-demo-data";
import { StepsStrip } from "@/components/home/steps-strip";
import { SectionHeader } from "@/components/ui/section-header";
import { BasketAvatar } from "@/components/social/basket-avatar";
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
  type TradeFeedItem,
} from "@/lib/social-api";

/**
 * Demo overlay switch — read once at module scope so Next inlines it at
 * build time and the real-data branch is dead code when the flag is off.
 */
const DEMO = process.env.NEXT_PUBLIC_HOME_DEMO === "1";

/** Silent poll cadence — previews stay fresh without a refresh button. */
const POLL_MS = 60_000;

/** Visible rows in the trades window. */
const VISIBLE_ROW_COUNT = 3;

/** Queue size behind the rolling window (the trades fetch limit). */
const FEED_QUEUE_SIZE = 12;

/** How often the rolling window surfaces the next trade. */
const ADVANCE_MS = 2500;

// ---------------------------------------------------------------------------
// Loaders — module-level so their identity is stable and the polling effect
// never re-arms on re-render.
// ---------------------------------------------------------------------------

async function loadRecentTrades(signal: AbortSignal): Promise<TradeFeedItem[]> {
  const payload = await fetchFeed({ type: "trades", limit: FEED_QUEUE_SIZE }, signal);
  // The endpoint already filters to trades; filter defensively anyway so a
  // backend regression can never push a thesis into the proof section.
  return payload.items.filter((item): item is TradeFeedItem => item.kind === "trade");
}

/** Cascade order: 30d first, then 7d, then all-time. */
const BASKETS_WINDOW_CASCADE = ["30d", "7d", "all"] as const;

/**
 * Adaptive window cascade — the first window with rows wins. A quiet devnet
 * board would render an empty 30d column, so the loader walks the fallbacks
 * until something honest shows. The window is intentionally internal now:
 * the header is a plain link and does not label which window was used.
 * One AbortController signal covers the whole cascade — aborting the
 * resource cancels whichever leg is in flight.
 */
async function loadTopBaskets(signal: AbortSignal): Promise<BasketLeaderboardEntry[]> {
  for (const win of BASKETS_WINDOW_CASCADE) {
    const payload = await fetchBasketLeaderboard(win, signal);
    if (payload.items.length > 0) {
      return payload.items;
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Shared polling hook — initial load + visibility-gated silent interval,
// mirroring feed-client's lifecycle (abort on supersede/unmount, in-flight
// poll skip, silent failures keep stale data).
// ---------------------------------------------------------------------------

interface LiveResource<T> {
  data: T | null;
  status: "loading" | "ready" | "error";
  retry: () => void;
}

function useLiveResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  pollMs: number,
): LiveResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<LiveResource<T>["status"]>("loading");
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

  return { data, status, retry: () => setAttempt((n) => n + 1) };
}

// ---------------------------------------------------------------------------
// Rolling trades queue — shared by demo and real mode. A window of
// VISIBLE_ROW_COUNT rows over a queue of items; every ADVANCE_MS the next
// item surfaces at the top and the oldest drops off the bottom.
// ---------------------------------------------------------------------------

interface RollingRow {
  item: TradeFeedItem;
  /** sig + cycle counter — unique per appearance so AnimatePresence keys
   *  never collide when the queue wraps. */
  key: string;
}

interface RollState {
  source: TradeFeedItem[];
  rows: RollingRow[];
  /** Monotonic index into `source` of the next item to surface. */
  cursor: number;
}

function initRoll(source: TradeFeedItem[]): RollState {
  return {
    source,
    rows: source
      .slice(0, VISIBLE_ROW_COUNT)
      .map((item, i) => ({ item, key: `${item.sig}-${i}` })),
    cursor: VISIBLE_ROW_COUNT,
  };
}

function useRollingTrades(items: TradeFeedItem[]): RollingRow[] {
  const [roll, setRoll] = useState<RollState>(() => initRoll(items));

  // New source (first demo import / fresh poll) → restart the window from
  // the newest item. Demo data is a stable module const, so this runs once
  // there; in real mode identical rows re-key to the same slots and never
  // re-animate.
  useEffect(() => {
    setRoll(initRoll(items));
  }, [items]);

  // Advance one item per tick while the tab is visible. A hidden tab simply
  // skips ticks — the queue holds its position and resumes on return.
  useEffect(() => {
    const source = roll.source;
    if (source.length <= VISIBLE_ROW_COUNT) return undefined;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setRoll((prev) => {
        if (prev.source !== source) return prev;
        const next = source[prev.cursor % source.length];
        return {
          source,
          cursor: prev.cursor + 1,
          rows: [
            { item: next, key: `${next.sig}-c${prev.cursor}` },
            ...prev.rows.slice(0, VISIBLE_ROW_COUNT - 1),
          ],
        };
      });
    }, ADVANCE_MS);
    return () => window.clearInterval(timer);
  }, [roll.source]);

  return roll.rows;
}

// ---------------------------------------------------------------------------
// Column furniture — linked header label, skeleton, quiet error.
// ---------------------------------------------------------------------------

/**
 * Mono micro-label wrapped in a link — the whole label is the target, with
 * a hidden ↗ that fades in on hover/focus pointing off the home surface.
 */
function ColumnHeaderLink({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <h3 className="section-label">{label}</h3>
      <span
        aria-hidden="true"
        className="font-mono text-xs text-primary-text opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
      >
        ↗
      </span>
    </Link>
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

// ---------------------------------------------------------------------------
// Trade rows — the animated sentence list (demo + real).
// ---------------------------------------------------------------------------

/** One trade sentence with its enter/exit motion. Enters sliding down from
 *  above, exits downward; under prefers-reduced-motion everything swaps
 *  without animation (duration 0 / no layout projection). */
function TradeRow({ item }: { item: TradeFeedItem }) {
  const reducedMotion = useReducedMotion();
  const minted = item.type === "Minted";
  // Skip the shares phrase when the count is absent/zero rather than
  // fabricating "0 shares bought …".
  const hasShares = Number.isFinite(item.shares) && item.shares > 0;
  return (
    <motion.div
      layout={reducedMotion ? false : true}
      initial={reducedMotion ? false : { y: "-100%", opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: "100%", opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.25, ease: "easeOut" }}
      className="flex items-center gap-3 border-l-2 border-l-primary/0 py-3 pl-4 transition-colors hover:border-l-primary/60"
    >
      {/* Actor + label, capped so a long displayName truncates before it
          crowds the sentence; friendlyFallback renders anonymous wallets as
          "a trader" (wallet stays on title). */}
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
          className="inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <BasketAvatar basket={item.basket} size={20} />
          <span className="truncate">{item.basketName ?? "a basket"}</span>
        </Link>
      </span>
      {/* Compact two-line right block: USD (em dash when null) over the
          muted relative time. suppressHydrationWarning: demo timestamps are
          computed at module-load time on both server and client, so a
          minute boundary crossed between SSR and hydration may shift the
          relative label by one step — the client value is the correct one. */}
      <span className="shrink-0 text-right">
        <span className="block font-mono text-sm font-semibold tabular-nums text-foreground">
          {item.usdValue !== null ? formatUsd(item.usdValue) : "—"}
        </span>
        <span
          suppressHydrationWarning
          className="mt-0.5 block font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          {formatRelativeTime(item.ts)}
        </span>
      </span>
    </motion.div>
  );
}

/**
 * The animated trades list: rolling window over `items`, entering row
 * slides down from above while the oldest row slides out below. popLayout
 * keeps the exiting row out of flow so the list never grows a phantom row;
 * overflow-hidden clips both slides. Rows are separated by hairlines (the
 * divide language of the rest of the section).
 */
function AnimatedTradeRows({ items }: { items: TradeFeedItem[] }) {
  const rows = useRollingTrades(items);
  return (
    <div className="relative divide-y divide-border overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        {rows.map(({ item, key }) => (
          <TradeRow key={key} item={item} />
        ))}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Baskets rows — shared by demo and real mode.
// ---------------------------------------------------------------------------

/** "+X.XX%" convention — negatives already carry their own sign. */
function formatReturnPct(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function BasketsRows({ items }: { items: BasketLeaderboardEntry[] }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((entry, index) => {
        const positive = entry.returnPct >= 0;
        const nav = entry.nav.trim() === "" ? NaN : Number(entry.nav);
        return (
          <li
            key={`${entry.basket}-${index}`}
            className="border-l-2 border-l-primary/0 py-3 pl-4 transition-colors hover:border-l-primary/60"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground/70"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                {/* The glyph IS the basket logo here — the demo datasets
                    deliberately ship no basket images. */}
                <BasketAvatar basket={entry.basket} />
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
  );
}

// ---------------------------------------------------------------------------
// Columns — demo (static labeled datasets) and real (polled resources).
// ---------------------------------------------------------------------------

function DemoTradesColumn() {
  return (
    <div>
      <ColumnHeaderLink label="LATEST VERIFIED TRADES" href="/feed" />
      <AnimatedTradeRows items={DEMO_TRADES} />
    </div>
  );
}

function DemoBasketsColumn() {
  return (
    <div>
      <ColumnHeaderLink label="TOP BASKETS" href="/leaderboard" />
      {/* Row parity (owner feedback, 2026-09-12): the full 5-basket dataset
          stays available for the demo, but the preview surfaces only
          VISIBLE_ROW_COUNT rows so the two columns match. */}
      <BasketsRows items={DEMO_BASKETS.slice(0, VISIBLE_ROW_COUNT)} />
    </div>
  );
}

function TradesColumn({ resource }: { resource: LiveResource<TradeFeedItem[]> }) {
  return (
    <div>
      <ColumnHeaderLink label="LATEST VERIFIED TRADES" href="/feed" />
      {resource.status === "loading" ? (
        <PreviewSkeleton rows={VISIBLE_ROW_COUNT} label="Loading verified trades" />
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
          <AnimatedTradeRows items={resource.data} />
        )
      ) : null}
    </div>
  );
}

function BasketsColumn({ resource }: { resource: LiveResource<BasketLeaderboardEntry[]> }) {
  return (
    <div>
      <ColumnHeaderLink label="TOP BASKETS" href="/leaderboard" />
      {resource.status === "loading" ? (
        <PreviewSkeleton rows={VISIBLE_ROW_COUNT} label="Loading top baskets" />
      ) : null}
      {resource.status === "error" ? (
        <QuietError message="Couldn't load the leaderboard just now." onRetry={resource.retry} />
      ) : null}
      {resource.status === "ready" && resource.data ? (
        resource.data.length === 0 ? (
          <p className="py-3 pl-4 text-sm leading-6 text-muted-foreground">
            The board builds as baskets trade.
          </p>
        ) : (
          // Row parity (owner feedback, 2026-09-12): cap the preview at
          // VISIBLE_ROW_COUNT rows so the baskets column matches the trades
          // column.
          <BasketsRows items={resource.data.slice(0, VISIBLE_ROW_COUNT)} />
        )
      ) : null}
    </div>
  );
}

/** Real-mode columns — the polling hooks live here so the demo overlay
 *  mounts zero fetching machinery. */
function RealColumns() {
  const trades = useLiveResource(loadRecentTrades, POLL_MS);
  const baskets = useLiveResource(loadTopBaskets, POLL_MS);
  return (
    <>
      <TradesColumn resource={trades} />
      <BasketsColumn resource={baskets} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Section.
// ---------------------------------------------------------------------------

/** The mono chip that keeps the demo overlay honest — small, quiet, and
 *  impossible to mistake for live data. */
function DemoChip() {
  return (
    <span
      title="Synthetic demo data — not live activity"
      className="self-start rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground sm:self-end"
    >
      demo data
    </span>
  );
}

export function LiveProofSection() {
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
          label="VERIFIED ACTIVITY"
          lead="What people are building and trading right now."
          right={DEMO ? <DemoChip /> : undefined}
        />
        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          {DEMO ? (
            <>
              <DemoTradesColumn />
              <DemoBasketsColumn />
            </>
          ) : (
            <RealColumns />
          )}
        </div>
        {/* Merged steps strip (owner feedback, 2026-09-12): proof above,
            process below — StepsStrip owns its own internal spacing. */}
        <StepsStrip />
      </div>
    </section>
  );
}
