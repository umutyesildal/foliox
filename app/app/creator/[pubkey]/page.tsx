"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";

import { EmptyState, ErrorState, FreshnessBadge, TableRowSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAsOf, formatUsd, truncateAddress } from "@/lib/format";
import { LegalReviewTag } from "@/components/create";

const API_BASE = process.env.NEXT_PUBLIC_API || "http://localhost:3001";

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
      const res = await fetch(`${API_BASE}/api/v1/creators/${encodeURIComponent(pubkeyParam)}`, {
        cache: "no-store",
      });
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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Creator</h1>
          <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
            {validKey ? pubkeyParam : "invalid address"}
          </p>
        </div>
        {payload?.source && (
          <FreshnessBadge
            source={payload.source}
            asOf={payload.asOf ?? undefined}
          />
        )}
      </div>

      {!validKey && (
        <ErrorState
          className="mt-8"
          title="Invalid creator address"
          message={`"${truncateAddress(pubkeyParam || "—", 8, 6)}" is not a valid Solana public key. Creator profiles are keyed by the wallet that signed create_basket.`}
        />
      )}

      {status === "loading" && (
        <div className="mt-8" role="status" aria-label="Loading creator profile">
          <span className="sr-only">Loading creator profile</span>
          <TableRowSkeleton rows={4} columns={3} label="Loading creator profile" />
        </div>
      )}

      {status === "not-indexed" && (
        <EmptyState
          className="mt-8"
          title="Creator stats appear once the indexer tracks activity"
          description={`No baskets and no fee history are indexed for ${truncateAddress(pubkeyParam, 6, 6)} yet. This page only renders indexer data — it never estimates or fabricates stats. Deploy a basket with this wallet and the profile fills in from BasketCreated events.`}
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
          <dl className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <dt className="text-xs text-muted-foreground">Baskets created</dt>
              <dd className="mt-1 font-mono text-xl tabular-nums">
                {basketCount ?? baskets.length}
              </dd>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <dt className="text-xs text-muted-foreground">Total AUM (indexed)</dt>
              <dd className="mt-1 font-mono text-xl tabular-nums">
                {stats ? (() => {
                  const aum = numeric(stats.total_aum);
                  return aum === null ? "—" : formatUsd(aum);
                })() : "—"}
              </dd>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <dt className="text-xs text-muted-foreground">Fees earned (indexed)</dt>
              <dd className="mt-1 font-mono text-xl tabular-nums">
                {stats ? (() => {
                  const fees = numeric(stats.total_fees_earned);
                  return fees === null ? "—" : formatUsd(fees);
                })() : "—"}
              </dd>
            </div>
          </dl>

          <h2 className="mt-8 text-xl font-semibold tracking-tight">Baskets</h2>
          {baskets.length === 0 ? (
            <EmptyState
              className="mt-3"
              title="No indexed baskets"
              description="The stats row exists but no baskets are linked to this creator yet."
            />
          ) : (
            <div className="mt-3 overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">Basket</TableHead>
                    <TableHead className="text-xs">Share mint</TableHead>
                    <TableHead className="text-right text-xs">NAV</TableHead>
                    <TableHead className="text-xs">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baskets.map((row) => {
                    const nav = numeric(row.nav);
                    return (
                      <TableRow key={row.pubkey}>
                        <TableCell>
                          <Link
                            href={`/basket/${row.pubkey}`}
                            className="font-mono text-xs underline-offset-2 hover:underline"
                          >
                            {truncateAddress(row.pubkey, 6, 6)}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                          {row.share_mint
                            ? truncateAddress(row.share_mint, 6, 6)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {nav === null ? "—" : formatUsd(nav)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.created_at ? (
                            <span className="font-mono tabular-nums">
                              {formatAsOf(row.created_at)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="mt-6 flex flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground">
            <span>
              Creator stats describe baskets this wallet deployed. They are not
              an endorsement of any basket, and creators are not licensed
              advisers unless separately verified.
            </span>
            <LegalReviewTag />
          </p>
        </>
      )}
    </div>
  );
}
