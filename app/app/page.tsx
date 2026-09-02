"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { EmptyState, FreshnessBadge, TableRowSkeleton } from "@/components/states";
import { formatTokenAmount, formatUsd, truncateAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API || "http://localhost:3001";

interface BasketRow {
  pubkey: string;
  creator?: string | null;
  nav?: string | number | null;
  share_price?: string | number | null;
  holders?: number | null;
  drift_bps?: string | number | null;
  driftBps?: string | number | null;
  source?: string | null;
  asOf?: string | null;
  nav_as_of?: string | null;
}

function numeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Landing — asymmetric editorial hero with ONE primary CTA, a quiet
 * Create → Mint → Redeem explainer, and a featured basket only when the
 * indexer actually returns one. No marquee, no gradient, no faux chrome, no
 * fabricated numbers.
 */
export default function LandingPage() {
  const [featured, setFeatured] = useState<BasketRow | null>(null);
  const [featuredState, setFeaturedState] = useState<"loading" | "ready" | "empty">("loading");
  const [featuredSource, setFeaturedSource] = useState<string | null>(null);
  const [featuredAsOf, setFeaturedAsOf] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/baskets?sort=aum&limit=1`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const payload = (await res.json()) as {
          data?: BasketRow[];
          source?: string | null;
          asOf?: string | null;
        };
        if (cancelled) return;
        const row = payload.data?.[0] ?? null;
        // Only render when the indexer returned a real basket with a pubkey.
        if (row && typeof row.pubkey === "string" && row.pubkey.length > 0) {
          setFeatured(row);
          setFeaturedSource(payload.source ?? row.source ?? null);
          setFeaturedAsOf(payload.asOf ?? row.asOf ?? row.nav_as_of ?? null);
          setFeaturedState("ready");
        } else {
          setFeaturedState("empty");
        }
      } catch {
        if (!cancelled) setFeaturedState("empty");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const nav = numeric(featured?.nav);
  const sharePrice = numeric(featured?.share_price);
  const drift = numeric(featured?.drift_bps ?? featured?.driftBps);

  return (
    <div className="mx-auto w-full">
      {/* Hero — asymmetric editorial: copy left, sourced featured column right */}
      <section className="grid gap-10 pb-12 pt-6 md:grid-cols-[1.15fr_0.85fr] md:pb-16 md:pt-10">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Onchain strategy baskets · xStocks
          </p>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.04] tracking-tight md:text-6xl">
            Create an index.
            <br />
            Own your thesis.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
            Pick 2-20 whitelisted xStocks, fix the weights in basis points, cap
            your fees, and seed the vault atomically. One share token, pro-rata
            redemption, no oracle — and nothing changes after deploy.
          </p>
          <div className="mt-8">
            <Link
              href="/create"
              className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Create an index
            </Link>
            <span className="ml-4 text-xs text-muted-foreground">
              or{" "}
              <Link
                href="/explore"
                className="text-foreground underline underline-offset-4 hover:text-muted-foreground"
              >
                explore existing baskets
              </Link>
            </span>
          </div>
          <p className="mt-10 max-w-xl text-xs leading-5 text-muted-foreground">
            Not investment advice. xStocks are Backed structured instruments,
            not direct equity. Baskets are immutable; redeem is permissionless
            and oracle-free. LEGAL_REVIEW_REQUIRED applies across this site.
          </p>
        </div>

        {/* Featured basket — only real indexer data; otherwise a quiet empty */}
        <div className="min-w-0 self-start rounded-xl border border-border bg-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">Featured basket</h2>
            {featuredSource && featuredState === "ready" && (
              <FreshnessBadge source={featuredSource} asOf={featuredAsOf ?? undefined} />
            )}
          </div>

          {featuredState === "loading" && (
            <div className="mt-4" role="status" aria-label="Loading featured basket">
              <span className="sr-only">Loading featured basket</span>
              <div className="flex flex-col gap-2">
                <TableRowSkeleton rows={3} columns={1} label="Loading featured basket" />
              </div>
            </div>
          )}

          {featuredState === "ready" && featured && (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-xs text-muted-foreground">Basket</dt>
              <dd className="text-right">
                <Link
                  href={`/basket/${featured.pubkey}`}
                  className="font-mono text-xs underline-offset-2 hover:underline"
                >
                  {truncateAddress(featured.pubkey, 8, 6)}
                </Link>
              </dd>
              <dt className="text-xs text-muted-foreground">NAV</dt>
              <dd className="text-right font-mono text-sm tabular-nums">
                {nav === null ? "—" : formatUsd(nav)}
              </dd>
              <dt className="text-xs text-muted-foreground">Share price</dt>
              <dd className="text-right font-mono text-sm tabular-nums">
                {sharePrice === null ? "—" : formatUsd(sharePrice)}
              </dd>
              <dt className="text-xs text-muted-foreground">Holders</dt>
              <dd className="text-right font-mono text-sm tabular-nums">
                {featured.holders === null || featured.holders === undefined
                  ? "—"
                  : formatTokenAmount(featured.holders, { maximumFractionDigits: 0 })}
              </dd>
              <dt className="text-xs text-muted-foreground">Drift vs target</dt>
              <dd
                className={cn(
                  "text-right font-mono text-sm tabular-nums",
                  drift !== null && drift > 0 && "text-[hsl(var(--status-positive))]",
                  drift !== null && drift < 0 && "text-destructive",
                )}
              >
                {drift === null
                  ? "—"
                  : `${drift > 0 ? "+" : ""}${drift.toLocaleString()} bps`}
              </dd>
            </dl>
          )}

          {featuredState === "empty" && (
            <EmptyState
              className="mt-3 border-border/60"
              title="No baskets indexed yet"
              description="The indexer has no baskets to feature. Numbers appear here only once a real basket is deployed and tracked — never before."
              action={
                <Link
                  href="/create"
                  className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  Be the first creator
                </Link>
              }
            />
          )}
        </div>
      </section>

      {/* Quiet 3-step explainer: Create → Mint → Redeem */}
      <section className="border-t border-border/60 py-10" aria-label="How FolioX works">
        <h2 className="text-xl font-semibold tracking-tight">Create → Mint → Redeem</h2>
        <ol className="mt-6 grid gap-6 md:grid-cols-3">
          <li>
            <p className="font-mono text-xs text-muted-foreground">01</p>
            <h3 className="mt-2 text-base font-medium">Create</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Weights must sum to exactly 10,000 bps; fees are capped at 300 /
              100 / 300 bps and split 90/10 creator-treasury. The seed transfer
              and basket creation are one atomic transaction.
            </p>
          </li>
          <li>
            <p className="font-mono text-xs text-muted-foreground">02</p>
            <h3 className="mt-2 text-base font-medium">Mint</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Deposit the xStocks in-kind, proportionally to the weights. Or zap
              USDC through Jupiter — a convenience path of sequential swaps with
              typical 1-3% slippage exposure, not part of the core program.
            </p>
          </li>
          <li>
            <p className="font-mono text-xs text-muted-foreground">03</p>
            <h3 className="mt-2 text-base font-medium">Redeem</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Burn shares and receive pro-rata vault holdings, floored to the
              raw token unit. Permissionless and oracle-free — the program
              cannot pause it, and no backend needs to be online.
            </p>
          </li>
        </ol>
        <p className="mt-8 max-w-3xl text-xs leading-5 text-muted-foreground">
          Historical NAV is the only performance figure shown anywhere in the
          app. Drift versus target weights is expected between mints — V0 has no
          rebalancing, and baskets never trade. Placeholder legal copy is
          pending counsel review.
        </p>
      </section>
    </div>
  );
}
