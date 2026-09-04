"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Skeleton } from "@/components/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One listing row — the whole card is a link to /stock/[ticker] (same pattern
 * as the /stocks cards: native anchor, keyboard accessible, hover ring on the
 * border). All numeric fields are server-computed from live endpoints
 * (Jupiter price, Yahoo daily closes) — this component never fabricates or
 * derives new figures, it only sorts and renders.
 */
export interface EtfRow {
  ticker: string;
  /** Static display metadata for known tickers; omitted when unmapped. */
  name?: string;
  provider?: string;
  price: number | null;
  change24h: number | null;
}

const SORTS = [
  { key: "az", label: "A-Z" },
  { key: "price", label: "Price" },
  { key: "change", label: "24h" },
] as const;

type SortKey = (typeof SORTS)[number]["key"];

const PROVIDER_LABEL: Record<string, string> = {
  backed: "Backed Finance",
};

/** Price and 24h sort descending; missing values sink to the end. */
function sortRows(rows: EtfRow[], sort: SortKey): EtfRow[] {
  const copy = [...rows];
  if (sort === "az") {
    return copy.sort((a, b) => a.ticker.localeCompare(b.ticker));
  }
  const value = (row: EtfRow) => (sort === "price" ? row.price : row.change24h);
  return copy.sort((a, b) => (value(b) ?? -Infinity) - (value(a) ?? -Infinity));
}

function EtfCard({ row }: { row: EtfRow }) {
  const change = row.change24h;
  return (
    <Link
      href={`/stock/${encodeURIComponent(row.ticker)}`}
      className="group block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Card className="h-full transition-colors group-hover:border-foreground/20">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="font-mono text-lg font-semibold tabular-nums">
                {row.ticker}
              </CardTitle>
              {row.name ? (
                <CardDescription className="truncate text-xs">{row.name}</CardDescription>
              ) : null}
            </div>
            {row.provider ? (
              <span
                title="Tokenized instrument issuer"
                className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
              >
                {PROVIDER_LABEL[row.provider] ?? row.provider}
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex h-full flex-col">
          <div className="grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Token price
              </p>
              <p className="font-mono text-sm tabular-nums">
                {row.price !== null ? formatUsd(row.price) : "—"}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">24h</p>
              <p
                className={cn(
                  "font-mono text-sm tabular-nums",
                  change !== null && change >= 0 ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {change !== null ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function EtfGrid({ rows }: { rows: EtfRow[] }) {
  const [sort, setSort] = useState<SortKey>("az");
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {rows.length} listed
        </span>
        <nav aria-label="Sort listings" className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort</span>
          {SORTS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={sort === option.key}
              onClick={() => setSort(option.key)}
              className={cn(
                // 40px tall on phones (touch), compact 32px from sm up.
                "inline-flex h-8 max-md:h-10 items-center rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                sort === option.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sorted.map((row) => (
          <EtfCard key={row.ticker} row={row} />
        ))}
      </div>
    </div>
  );
}

/** Suspense fallback — card-shaped bars, aria-hidden, no fake data. */
export function EtfGridSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading tokenized ETF listings"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} aria-hidden="true" className="rounded-lg border border-border bg-card p-5">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="mt-2 h-3 w-28" />
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
          <Skeleton className="mt-4 h-6 w-14" />
        </div>
      ))}
    </div>
  );
}
