"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";

import { EmptyState, ErrorState, FreshnessBadge, Skeleton } from "@/components/states";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAsOf, formatUsd, truncateAddress } from "@/lib/format";
import { apiFetch } from "@/lib/api-client";
import { LegalReviewTag } from "@/components/create";

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

/**
 * Creator profile — GET /api/v1/creators/:pubkey. Renders identity, basket
 * count, AUM and fee totals only when the indexer actually has them; until
 * then the page is an explicit placeholder, never fabricated numbers
 * (plan.md §5 Creator acceptance).
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

  const stats = payload?.stats ?? null;
  const baskets = payload?.baskets ?? [];
  const basketCount = numeric(stats?.basket_count);

  return (
    <div className="mx-auto w-full max-w-4xl">
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

      {!validKey && (
        <ErrorState
          className="mt-8"
          title="Invalid creator address"
          message={`"${truncateAddress(pubkeyParam || "—", 8, 6)}" is not a valid Solana public key. Creator profiles are keyed by the wallet that signed create_basket.`}
        />
      )}

      {status === "loading" && (
        <div className="mt-2" role="status" aria-label="Loading creator profile">
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
        <EmptyState
          className="mt-8"
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
      )}

      {status === "error" && (
        <div className="mt-8">
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
          <div className="grid gap-3 sm:grid-cols-3">
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
                  {stats ? (() => {
                    const aum = numeric(stats.total_aum);
                    return aum === null ? "—" : formatUsd(aum);
                  })() : "—"}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardDescription>Fees earned (indexed)</CardDescription>
                <CardTitle className="font-mono text-2xl tabular-nums">
                  {stats ? (() => {
                    const fees = numeric(stats.total_fees_earned);
                    return fees === null ? "—" : formatUsd(fees);
                  })() : "—"}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <section aria-labelledby="creator-baskets" className="border-t border-border py-8">
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

    </div>
  );
}
