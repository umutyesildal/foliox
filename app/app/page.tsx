"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { FreshnessBadge } from "@/components/states";
import { HowItWorks } from "@/components/landing/how-it-works";
import { SessionCard } from "@/components/landing/session-card";
import { TerminalStrip } from "@/components/landing/terminal-strip";
import { LegalReviewTag } from "@/components/create";
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

/** A2 — mono stat strip under the hero copy: program facts only. */
const HERO_STATS: { value: string; label: string }[] = [
  { value: "2-20", label: "assets" },
  { value: "10,000", label: "bps exact" },
  { value: "≤300/100/300", label: "fee caps" },
  { value: "1", label: "atomic tx" },
];

/**
 * Landing — "premium terminal" hero: status strip, split copy/session layout
 * on a hero-only 1px grid texture, mono stat strip, a Create → Mint → Redeem
 * explainer, and a slim "Latest basket" row only when the indexer actually
 * returns one. No marquee, no gradient, no faux chrome, no fabricated numbers.
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
      {/* A4 — hero-only 1px grid texture (≤4% foreground lines), nothing elsewhere */}
      <div className="foliox-hero-grid">
        <TerminalStrip />

        {/* A2 — split hero: copy left, simulated session right */}
        <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-10 sm:px-6 md:grid-cols-[1.1fr_0.9fr] md:items-start md:pt-14">
          <div className="min-w-0">
            <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Onchain strategy baskets · xStocks
            </p>
            <h1 className="mt-4 text-6xl font-semibold leading-[1.02] tracking-tight md:text-7xl">
              Create an index.
              <br />
              Own your thesis.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-foreground/80">
              Pick 2-20 whitelisted xStocks, fix the weights in basis points,
              cap your fees, and seed the vault atomically. One share token,
              pro-rata redemption, no oracle — and nothing changes after deploy.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/create"
                className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Create an index
              </Link>
              <Link
                href="/explore"
                className="inline-flex h-10 items-center rounded-lg px-4 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                explore baskets →
              </Link>
            </div>

            <dl className="mt-10 grid max-w-xl grid-cols-2 gap-x-10 gap-y-6 border-t border-[hsl(var(--border-strong))] pt-6">
              {HERO_STATS.map((stat) => (
                <div key={stat.label} className="min-w-0">
                  <dd className="font-mono text-2xl tabular-nums tracking-tight text-foreground">
                    {stat.value}
                  </dd>
                  <dt className="mt-1 text-xs text-muted-foreground">{stat.label}</dt>
                </div>
              ))}
            </dl>

            <p className="mt-8 flex max-w-xl flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground">
              <span>
                Not investment advice. xStocks are Backed structured
                instruments, not direct equity.
              </span>
              <LegalReviewTag />
            </p>
          </div>

          <SessionCard className="min-w-0 self-start md:mt-9" />
        </section>
      </div>

      {/* A6 — slim real "Latest basket" row, only when the indexer returned one */}
      {featuredState === "ready" && featured && (
        <section
          aria-label="Latest indexed basket"
          className="mx-auto max-w-6xl px-4 sm:px-6"
        >
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[hsl(var(--border-strong))] py-3 text-sm">
            <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Latest basket
            </span>
            <Link
              href={`/basket/${featured.pubkey}`}
              className="font-mono text-xs underline-offset-2 hover:underline"
            >
              {truncateAddress(featured.pubkey, 8, 6)}
            </Link>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              NAV {nav === null ? "—" : formatUsd(nav)}
            </span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              share {sharePrice === null ? "—" : formatUsd(sharePrice)}
            </span>
            {featured.holders !== null && featured.holders !== undefined && (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatTokenAmount(featured.holders, { maximumFractionDigits: 0 })} holders
              </span>
            )}
            <span
              className={cn(
                "font-mono text-xs tabular-nums",
                drift !== null && drift > 0 && "text-[hsl(var(--status-positive))]",
                drift !== null && drift < 0 && "text-destructive",
              )}
            >
              {drift === null ? "drift —" : `drift ${drift > 0 ? "+" : ""}${drift.toLocaleString()} bps`}
            </span>
            <span className="ml-auto">
              <FreshnessBadge source={featuredSource ?? ""} asOf={featuredAsOf ?? undefined} />
            </span>
          </div>
        </section>
      )}
      {featuredState === "loading" && (
        <div className="mx-auto max-w-6xl px-4 sm:px-6" role="status" aria-label="Loading latest basket">
          <span className="sr-only">Loading latest basket</span>
        </div>
      )}

      {/* A5/B8 — 3-column mechanics explainer, rhythmic section break */}
      <section
        className="border-t border-border/60 py-16"
        aria-label="How FolioX works"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-xl font-semibold tracking-tight">
            Create → Mint → Redeem
          </h2>
          <div className="mt-8">
            <HowItWorks />
          </div>
          <p className="mt-10 max-w-3xl text-xs leading-5 text-muted-foreground">
            Historical NAV is the only performance figure shown anywhere in the
            app; drift versus target weights is expected between mints.{" "}
            <LegalReviewTag />
          </p>
        </div>
      </section>
    </div>
  );
}
