import Link from "next/link";

import { SocialAvatar } from "@/components/social/avatar";
import { BasketAvatar } from "@/components/social/basket-avatar";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { DemoCreator } from "@/lib/demo-creator";
import { formatRelativeTime, formatTokenAmount, formatUsd, truncateAddress } from "@/lib/format";

/**
 * DemoCreatorProfile — the /creator/demo-wallet-1..7 overlay the creator page
 * renders behind its demo gate. ZERO NETWORK: a pure render over the static
 * demo dataset (lib/demo-creator) — no hooks, no fetches, no event handlers —
 * so it is server-safe and can never trigger an API call.
 *
 * Layout mirrors the real creator page (header → stats row → metric strip →
 * est. performance curve → positions → trade history → theses → honesty
 * note). Every affordance that would need the API (follow, like, comment) is
 * a frozen visual: the Follow button is aria-disabled with no click handler
 * (the ultimate no-op), likes/comments are static counts, and the whole page
 * carries the same "demo data" mono chip as the home/feed overlays.
 */

/** The mono chip that keeps the demo overlay honest — same as home/feed. */
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

// ---------------------------------------------------------------------------
// Deterministic sparkline — pure math, no network, no randomness that varies
// between renders. A seeded pseudo-random walk (mulberry32 over the wallet
// hash) drifts toward the trader's roiPct and lands exactly on it, so the
// same demo wallet always draws the same curve.
// ---------------------------------------------------------------------------

function seedFromWallet(wallet: string): number {
  let hash = 0;
  for (let i = 0; i < wallet.length; i += 1) {
    hash = (hash * 31 + wallet.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ~8 points: seeded walk from 0% that mean-reverts toward roiPct. */
function demoCurvePoints(wallet: string, roiPct: number): number[] {
  const rand = mulberry32(seedFromWallet(wallet));
  const swing = Math.max(4, Math.abs(roiPct) * 0.6);
  const points: number[] = [];
  let value = 0;
  for (let i = 0; i < 7; i += 1) {
    value += (rand() - 0.5) * swing + (roiPct - value) * 0.25;
    points.push(value);
  }
  points.push(roiPct); // the walk ends exactly at the headline return
  return points;
}

/** Map values to SVG line/area paths on a fixed 100x40 viewBox. */
function sparklinePaths(values: number[]): { line: string; area: string } {
  const w = 100;
  const h = 40;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = values.map((value, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = pad + (1 - (value - min) / span) * (h - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return {
    line: `M${coords.join(" L")}`,
    area: `M0,${h} L${coords.join(" L")} L${w},${h} Z`,
  };
}

/** Signed percent for the EST. RETURN figure ("+12.40%" / "-3.10%"). */
function formatRoiPct(roiPct: number): string {
  if (!Number.isFinite(roiPct)) return "—";
  return `${roiPct >= 0 ? "+" : ""}${roiPct.toFixed(2)}%`;
}

const BASKET_LINK_CLASS =
  "min-w-0 truncate text-sm font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function DemoCreatorProfile({ creator }: { creator: DemoCreator }) {
  const { stats } = creator;
  const positiveReturn = stats.roiPct >= 0;
  const curve = sparklinePaths(demoCurvePoints(creator.wallet, stats.roiPct));

  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* ---- social identity header (mirrors the real profile header) ---- */}
      <header className="pb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <SocialAvatar
              wallet={creator.wallet}
              handle={creator.handle}
              displayName={creator.displayName}
              avatarUrl={creator.avatarUrl}
              size="md"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-3xl font-semibold tracking-tight">
                  {creator.displayName?.trim() || `@${creator.handle}`}
                </h1>
                <DemoChip />
              </div>
              <p className="mt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                @{creator.handle} · {truncateAddress(creator.wallet, 4, 4)}
              </p>
              {creator.bio ? (
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{creator.bio}</p>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Visual Follow button only: aria-disabled, tooltip, and no click
                handler on purpose — demo mode never calls the API, and the
                handler-free component stays server-safe. */}
            <Button variant="outline" size="sm" aria-disabled="true" title="Demo data">
              Follow
            </Button>
          </div>
        </div>

        {/* stats row — same mono language as the real profile */}
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="font-mono tabular-nums">
            <span className="font-medium text-foreground">{stats.followers}</span>{" "}
            <span className="text-muted-foreground">followers</span>
          </span>
          <span className="font-mono tabular-nums">
            <span className="font-medium text-foreground">{stats.following}</span>{" "}
            <span className="text-muted-foreground">following</span>
          </span>
          <span className="font-mono tabular-nums">
            <span className="font-medium text-foreground">{stats.trades}</span>{" "}
            <span className="text-muted-foreground">trades</span>
          </span>
          <span
            suppressHydrationWarning
            className="font-mono tabular-nums text-muted-foreground"
          >
            member since {formatRelativeTime(stats.memberSince)}
          </span>
        </div>
      </header>

      {/* ---- metric strip — same tile language as the real creator page ---- */}
      <div className="grid gap-3 border-t border-border py-8 sm:grid-cols-3">
        <Card className="h-full">
          <CardHeader className="pb-2">
            <CardDescription className="font-mono text-[11px] uppercase tracking-wide">
              Est. return
            </CardDescription>
            <CardTitle
              className={`font-mono text-2xl tabular-nums ${
                positiveReturn ? "text-[hsl(var(--status-positive))]" : "text-[hsl(var(--destructive))]"
              }`}
            >
              {formatRoiPct(stats.roiPct)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="h-full">
          <CardHeader className="pb-2">
            <CardDescription className="font-mono text-[11px] uppercase tracking-wide">
              Est. value
            </CardDescription>
            <CardTitle className="font-mono text-2xl tabular-nums">
              {formatUsd(stats.valueUsd)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="h-full">
          <CardHeader className="pb-2">
            <CardDescription className="font-mono text-[11px] uppercase tracking-wide">
              Positions
            </CardDescription>
            <CardTitle className="font-mono text-2xl tabular-nums">{stats.positionCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* ---- est. performance — deterministic synthetic sparkline ---- */}
      <section aria-label="Estimated performance (demo)" className="border-t border-border py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4">
          <h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            EST. PERFORMANCE · DEMO
          </h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            synthetic curve · not advice
          </p>
        </div>
        <div className="rounded-sm bg-card ring-1 ring-border hairline-primary">
          <div className="p-5">
            <svg
              viewBox="0 0 100 40"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Synthetic performance curve ending at ${formatRoiPct(stats.roiPct)}`}
              className="h-28 w-full"
            >
              <path d={curve.area} fill="hsl(var(--chart-1))" fillOpacity={0.06} stroke="none" />
              <path
                d={curve.line}
                fill="none"
                stroke="hsl(var(--chart-1))"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        </div>
      </section>

      {/* ---- positions ---- */}
      <section aria-label="Positions (demo)" className="border-t border-border py-8">
        <h2 className="pb-4 font-mono text-xs uppercase tracking-wide text-muted-foreground">
          Positions
        </h2>
        {creator.positions.length === 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            No positions in the demo dataset.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-sm border border-border bg-card">
            {creator.positions.map((position, index) => (
              <li
                key={`${position.basket}-${index}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
              >
                <BasketAvatar basket={position.basket} size={28} />
                <Link
                  href={`/basket/${position.basket}`}
                  title={position.basket}
                  className={BASKET_LINK_CLASS}
                >
                  {position.basketName ?? truncateAddress(position.basket, 6, 4)}
                </Link>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatTokenAmount(position.shares, { maximumFractionDigits: 2 })} shares
                </span>
                <span className="ml-auto font-mono text-xs tabular-nums text-foreground">
                  {formatUsd(position.usdValue)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- trade history — home-preview row language: bought green, sold
              muted (never red — no loss shaming on a synthetic dataset) ---- */}
      <section aria-label="Trade history (demo)" className="border-t border-border py-8">
        <h2 className="pb-4 font-mono text-xs uppercase tracking-wide text-muted-foreground">
          Trade history
        </h2>
        {creator.trades.length === 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground">No trades in the demo dataset.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-sm border border-border bg-card">
            {creator.trades.map((trade, index) => {
              const minted = trade.type === "Minted";
              return (
                <li
                  key={`${trade.sig}-${index}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
                >
                  <span
                    className={`shrink-0 text-sm ${
                      minted
                        ? "font-medium text-[hsl(var(--status-positive))]"
                        : "text-muted-foreground"
                    }`}
                  >
                    {minted ? "bought" : "sold"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {formatTokenAmount(trade.shares)} shares of{" "}
                    <Link
                      href={`/basket/${trade.basket}`}
                      title={trade.basket}
                      className="inline-flex min-w-0 items-center gap-1.5 align-middle font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <BasketAvatar basket={trade.basket} size={20} />
                      <span className="truncate">{trade.basketName ?? "a basket"}</span>
                    </Link>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-sm font-semibold tabular-nums text-foreground">
                      {trade.usdValue !== null ? formatUsd(trade.usdValue) : "—"}
                    </span>
                    {/* suppressHydrationWarning: demo timestamps are computed
                        at module-load time, so a boundary crossed between SSR
                        and hydration may shift the label one step. */}
                    <span
                      suppressHydrationWarning
                      className="mt-0.5 block font-mono text-[11px] tabular-nums text-muted-foreground"
                    >
                      {formatRelativeTime(trade.ts)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---- theses — full body inline (demo bodies are stored complete) ---- */}
      <section aria-label="Theses (demo)" className="border-t border-border py-8">
        <h2 className="pb-4 font-mono text-xs uppercase tracking-wide text-muted-foreground">
          Theses
        </h2>
        {creator.theses.length === 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground">No theses in the demo dataset.</p>
        ) : (
          <ul className="divide-y divide-border">
            {creator.theses.map((thesis) => (
              <li key={thesis.id} className="border-l-2 border-l-border/60 py-4 pl-4 first:pt-0">
                <div className="flex justify-end">
                  <span
                    suppressHydrationWarning
                    className="font-mono text-[11px] tabular-nums text-muted-foreground"
                  >
                    {formatRelativeTime(thesis.ts)}
                  </span>
                </div>
                <span className="mt-1 block text-[15px] font-semibold text-foreground">
                  {thesis.title}
                </span>
                <span className="mt-1 block whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {thesis.body}
                </span>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  {thesis.basket ? (
                    <Link
                      href={`/basket/${thesis.basket}`}
                      title={thesis.basket}
                      className="inline-flex items-center gap-1.5 rounded-sm bg-accent px-2 py-0.5 font-mono text-[11px] text-accent-foreground transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <span aria-hidden="true" className="text-accent-foreground/70">
                        basket
                      </span>
                      {thesis.basketName ?? truncateAddress(thesis.basket, 4, 4)}
                    </Link>
                  ) : null}
                  {/* Static counts — likes are write endpoints and never fire
                      on the synthetic dataset. */}
                  <span
                    title="Demo data"
                    className="inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-xs tabular-nums text-muted-foreground"
                  >
                    <span aria-hidden="true">♡</span>
                    {thesis.likeCount}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                    <span aria-hidden="true">💬</span>
                    {thesis.commentCount}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="border-t border-border py-6 text-xs leading-5 text-muted-foreground">
        Demo profile — every figure, trade and thesis above is synthetic demo
        data (lib/demo-creator) rendered locally with zero network calls. Not
        live activity, not advice.
      </p>
    </div>
  );
}
