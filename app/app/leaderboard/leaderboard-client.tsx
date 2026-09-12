"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { RangeLinks } from "@/components/ui/range-links";
import { SocialAvatar } from "@/components/social/avatar";
import {
  formatRelativeTime,
  formatUsd,
  NOT_A_NUMBER_LABEL,
  truncateAddress,
} from "@/lib/format";
import {
  fetchBasketLeaderboard,
  fetchLeaderboard,
  type BasketLeaderboardEntry,
  type LeaderboardEntry,
  type LeaderboardWindow,
} from "@/lib/social-api";

const POLL_MS = 30_000;

/** Primary switcher — ranked traders vs ranked baskets. Client state, not URL. */
type BoardTab = "users" | "baskets";

const TABS: { value: BoardTab; label: string }[] = [
  { value: "users", label: "Users" },
  { value: "baskets", label: "Baskets" },
];

const WINDOWS: { value: LeaderboardWindow; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
];

/**
 * Leaderboard over GET /leaderboard (Users tab) and GET /leaderboard/baskets
 * (Baskets tab). Return figures are on-chain estimates — always labeled
 * "est."; empty 7d/30d windows are the honest "snapshots still accumulating"
 * state, never backfilled with fake ranks.
 */
export default function LeaderboardClient() {
  const [tab, setTab] = useState<BoardTab>("users");
  const [win, setWin] = useState<LeaderboardWindow>("all");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<LeaderboardEntry[]>([]);
  const [basketItems, setBasketItems] = useState<BasketLeaderboardEntry[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  const load = useCallback(
    async (which: LeaderboardWindow, whichTab: BoardTab, silent = false) => {
      // Silent loads (polling / Refresh) defer to an in-flight request; explicit
      // loads (tab / window switch, error retry) supersede it by aborting. A
      // superseded request drops its results via the abortRef checks, so each
      // tab always renders data matching the current tab + window pair.
      if (inFlightRef.current && silent) return;
      inFlightRef.current = true;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (!silent) setStatus("loading");
      try {
        if (whichTab === "baskets") {
          const payload = await fetchBasketLeaderboard(which, controller.signal);
          if (controller !== abortRef.current) return;
          setBasketItems(payload.items);
          setNote(payload.note);
        } else {
          const payload = await fetchLeaderboard(which, controller.signal);
          if (controller !== abortRef.current) return;
          setItems(payload.items);
          setNote(payload.note ?? null);
        }
        setError(null);
        setStatus("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (controller !== abortRef.current) return;
        setError(err instanceof Error ? err.message : "Could not reach the leaderboard.");
        if (!silent) setStatus("error");
      } finally {
        if (controller === abortRef.current) inFlightRef.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    void load(win, tab);
    return () => abortRef.current?.abort();
  }, [win, tab, load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(win, tab, true);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [win, tab, load]);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="flex flex-wrap items-baseline justify-between gap-3 pb-6">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Public traders ranked by estimated portfolio return. Self-custodial wallets only —
            nothing here is managed or advised.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load(win, tab, true)}>
          Refresh
        </Button>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        {/* Primary switcher — mono uppercase micro-labels so it outranks the
            secondary window RangeLinks on the right. */}
        <nav aria-label="Leaderboard tab" className="flex flex-wrap items-center gap-5">
          {TABS.map((t) => {
            const active = t.value === tab;
            return (
              <button
                key={t.value}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => setTab(t.value)}
                className={`font-mono text-xs uppercase tracking-widest transition-colors ${
                  active
                    ? "font-medium text-primary-text underline decoration-primary-text/60 underline-offset-4"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
        <RangeLinks
          options={WINDOWS}
          value={win}
          onChange={(next) => setWin(next)}
          label={null}
          ariaLabel="Leaderboard window"
        />
      </div>

      <p className="pt-3 text-xs leading-5 text-muted-foreground">
        {tab === "baskets"
          ? "Returns are derived from on-chain NAV snapshots. Past performance does not guarantee future results."
          : "Return estimates are derived from on-chain cost basis and current NAV. Past performance does not guarantee future results."}
      </p>

      {status === "loading" ? <BoardSkeleton /> : null}

      {status === "error" ? (
        <div className="pt-6">
          <ErrorState
            title="Leaderboard unavailable"
            message={error ?? "Could not reach the leaderboard."}
            onRetry={() => void load(win, tab)}
          />
        </div>
      ) : null}

      {status === "ready" && tab === "baskets" ? (
        <>
          {note ? (
            <p className="pt-4 font-mono text-[11px] text-muted-foreground">{note}</p>
          ) : null}
          {basketItems.length === 0 ? (
            <div className="pt-6">
              <EmptyState
                chip="NOT ENOUGH HISTORY"
                title="Not enough history yet — NAV snapshots are still accumulating."
                description={
                  win === "all"
                    ? "No ranked baskets yet — NAV snapshots build the board as baskets trade."
                    : "Switch to the All-time window, or check back as more snapshots accumulate."
                }
              />
            </div>
          ) : (
            <ol className="divide-y divide-border pt-2">
              {basketItems.map((entry, index) => (
                <BasketRow key={entry.basket} rank={index + 1} entry={entry} />
              ))}
            </ol>
          )}
        </>
      ) : null}

      {status === "ready" && tab === "users" ? (
        <>
          {note ? (
            <p className="pt-4 font-mono text-[11px] text-muted-foreground">{note}</p>
          ) : null}
          {items.length === 0 ? (
            <div className="pt-6">
              <EmptyState
                chip="NOT ENOUGH HISTORY"
                title="Not enough history yet — equity snapshots are still accumulating."
                description={
                  win === "all"
                    ? "No ranked traders yet — trade a public basket and snapshots build the board."
                    : "Switch to the All-time window, or check back as more snapshots accumulate."
                }
              />
            </div>
          ) : (
            <ol className="divide-y divide-border pt-2">
              {items.map((entry, index) => (
                <Row key={entry.wallet} rank={index + 1} entry={entry} />
              ))}
            </ol>
          )}
        </>
      ) : null}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="pt-4" role="status" aria-label="Loading leaderboard">
      <span className="sr-only">Loading leaderboard</span>
      <div className="divide-y divide-border" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-4">
            <Skeleton className="h-5 w-6" />
            <Skeleton className="h-7 w-7 rounded-full" />
            <Skeleton className="h-4 w-36" />
            <div className="ml-auto flex gap-6">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoiValue({ roiPct }: { roiPct: number | null }) {
  if (roiPct === null) {
    return (
      <span className="font-mono text-sm tabular-nums text-muted-foreground" title="No estimate yet — needs equity snapshots">
        {NOT_A_NUMBER_LABEL}
      </span>
    );
  }
  const positive = roiPct >= 0;
  return (
    <span
      className={`font-mono text-sm tabular-nums ${
        positive
          ? "text-[hsl(var(--status-positive))]"
          : "text-[hsl(var(--destructive))]"
      }`}
    >
      {positive ? "+" : ""}
      {roiPct.toFixed(2)}%
    </span>
  );
}

function Row({ rank, entry }: { rank: number; entry: LeaderboardEntry }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
      {/* Rank #1 is the page's single yellow accent spot. */}
      <span
        className={`w-7 shrink-0 font-mono text-sm tabular-nums ${
          rank === 1 ? "text-glow text-primary-text" : "text-muted-foreground"
        }`}
      >
        {rank}
      </span>
      <Link
        href={`/creator/${entry.wallet}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <SocialAvatar
          wallet={entry.wallet}
          handle={entry.handle}
          displayName={entry.displayName}
          avatarUrl={entry.avatarUrl}
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">
            {entry.displayName?.trim() ||
              (entry.handle ? `@${entry.handle}` : truncateAddress(entry.wallet, 4, 4))}
          </span>
          <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">
            {entry.positionCount} {entry.positionCount === 1 ? "position" : "positions"}
            {entry.firstTradeAt ? ` · trading since ${formatRelativeTime(entry.firstTradeAt)}` : ""}
          </span>
        </span>
      </Link>
      <div className="flex shrink-0 items-baseline gap-5">
        <span className="text-right">
          <span className="block font-mono text-sm tabular-nums text-foreground">
            {entry.valueUsd !== null ? formatUsd(entry.valueUsd, { maximumFractionDigits: 0 }) : NOT_A_NUMBER_LABEL}
          </span>
          <span className="block font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            est. value
          </span>
        </span>
        <span className="w-20 text-right">
          <RoiValue roiPct={entry.roiPct} />
          <span className="block font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            est. return
          </span>
        </span>
      </div>
    </li>
  );
}

/**
 * One ranked basket on the Baskets tab. The whole row is a link to the basket
 * page; returnPct is a NAV-snapshot estimate, so it keeps the "est. return"
 * honesty label (and the +/- status colors) from the users tab.
 */
function BasketRow({ rank, entry }: { rank: number; entry: BasketLeaderboardEntry }) {
  const navValue = entry.nav.trim() ? Number(entry.nav) : NaN;
  return (
    <li className="py-4">
      <Link
        href={`/basket/${entry.basket}`}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {/* Rank #1 is the page's single yellow accent spot. */}
        <span
          className={`w-7 shrink-0 font-mono text-sm tabular-nums ${
            rank === 1 ? "text-glow text-primary-text" : "text-muted-foreground"
          }`}
        >
          {rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {entry.basketName?.trim() || truncateAddress(entry.basket, 4, 4)}
            </span>
            {entry.symbol ? (
              <span className="shrink-0 rounded-sm bg-accent px-1.5 py-0.5 font-mono text-[10px] uppercase text-accent-foreground">
                {entry.symbol}
              </span>
            ) : null}
          </span>
          <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">
            {entry.mintCount} {entry.mintCount === 1 ? "mint" : "mints"} · updated{" "}
            {formatRelativeTime(entry.asOf)}
          </span>
        </span>
        <span className="flex shrink-0 items-baseline gap-5">
          <span className="text-right">
            <span className="block font-mono text-sm tabular-nums text-foreground">
              {formatUsd(navValue)}
            </span>
            <span className="block font-mono text-[10px] text-muted-foreground">
              {entry.holders} {entry.holders === 1 ? "holder" : "holders"}
            </span>
          </span>
          <span className="w-20 text-right">
            <RoiValue roiPct={entry.returnPct} />
            <span className="block font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              est. return
            </span>
          </span>
        </span>
      </Link>
    </li>
  );
}
