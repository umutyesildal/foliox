"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ErrorState, EmptyState, FreshnessBadge, Skeleton, TableRowSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatAsOf,
  formatBps,
  formatTokenAmount,
  formatUsd,
  truncateAddress,
} from "@/lib/format";

const API_BASE = process.env.NEXT_PUBLIC_API || "http://localhost:3001";

/** Numeric field as served by the indexer: Postgres numeric serialized as text. */
type Numeric = string | number | null | undefined;

interface BasketRow {
  pubkey: string;
  creator?: string | null;
  share_mint?: string | null;
  nav?: Numeric;
  supply?: Numeric;
  share_price?: Numeric;
  return_24h?: Numeric;
  return_30d?: Numeric;
  holders?: number | null;
  mint_count?: number | null;
  drift_bps?: Numeric;
  driftBps?: Numeric;
  source?: string | null;
  asOf?: string | null;
  nav_as_of?: string | null;
  refreshed_at?: string | null;
}

interface BasketsPayload {
  data?: BasketRow[];
  count?: number;
  source?: string | null;
  asOf?: string | null;
  note?: string;
  error?: { code?: string; message?: string };
}

type SortKey = "aum" | "share_price" | "return_24h" | "holders";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "aum", label: "AUM" },
  { key: "share_price", label: "Share price" },
  { key: "return_24h", label: "24h change" },
  { key: "holders", label: "Holders" },
];

function num(v: Numeric): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asOfOf(b: BasketRow): string | null {
  return b.asOf ?? b.nav_as_of ?? b.refreshed_at ?? null;
}

function driftOf(b: BasketRow): number | null {
  return num(b.driftBps) ?? num(b.drift_bps);
}

function ChangeCell({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const positive = value >= 0;
  return (
    <span
      className={`font-mono text-xs tabular-nums ${
        positive ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      {positive ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

function DriftCell({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="text-muted-foreground" title="Drift is computed per basket from vault holdings — see the basket detail page. The list feed does not carry it.">
        —
      </span>
    );
  }
  return <span className="font-mono text-xs tabular-nums">{formatBps(value, { signed: true })}</span>;
}

export default function ExploreClient() {
  const [baskets, setBaskets] = useState<BasketRow[]>([]);
  const [payloadMeta, setPayloadMeta] = useState<{ source: string; asOf: string | null; note?: string } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorInfo, setErrorInfo] = useState<{ message: string; code?: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("aum");
  const [positiveOnly, setPositiveOnly] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setErrorInfo(null);

    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/v1/baskets?limit=100`, {
          signal: controller.signal,
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const payload = (await res.json()) as BasketsPayload;
        if (!res.ok) {
          setErrorInfo({
            message: payload?.error?.message ?? `API responded with HTTP ${res.status}`,
            code: payload?.error?.code,
          });
          setStatus("error");
          return;
        }
        setBaskets(payload.data ?? []);
        setPayloadMeta({
          source: payload.source ?? "onchain-indexed",
          asOf: payload.asOf ?? null,
          note: payload.note,
        });
        setStatus("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setErrorInfo({
          message: err instanceof Error ? err.message : "Could not reach the basket API.",
        });
        setStatus("error");
      }
    }

    void load();
    return () => controller.abort();
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = baskets.filter((b) => {
      if (positiveOnly) {
        const change = num(b.return_24h);
        if (change === null || change < 0) return false;
      }
      if (!q) return true;
      return (
        b.pubkey.toLowerCase().includes(q) ||
        (b.creator ?? "").toLowerCase().includes(q) ||
        (b.share_mint ?? "").toLowerCase().includes(q)
      );
    });
    const sortValue = (b: BasketRow): number => {
      switch (sortKey) {
        case "share_price":
          return num(b.share_price) ?? -1;
        case "return_24h":
          return num(b.return_24h) ?? -Infinity;
        case "holders":
          return b.holders ?? -1;
        case "aum":
        default:
          return num(b.nav) ?? -1;
      }
    };
    rows = [...rows].sort((a, b) => sortValue(b) - sortValue(a));
    return rows;
  }, [baskets, query, sortKey, positiveOnly]);

  const hasBaskets = baskets.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">Explore baskets</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Ranked onchain equity baskets backed by xStocks. Indexer view is convenience only — the
            on-chain program state is the source of truth.
          </p>
        </div>
        <Button render={<Link href="/create" />}>Create basket</Button>
      </div>

      {status === "loading" ? (
        <Card>
          <CardContent className="space-y-4 p-4">
            <TableRowSkeleton rows={8} columns={6} label="Loading basket rankings" />
          </CardContent>
        </Card>
      ) : status === "error" ? (
        <ErrorState
          title="Basket rankings unavailable"
          message={
            errorInfo
              ? `${errorInfo.code ? `${errorInfo.code}: ` : ""}${errorInfo.message}`
              : "Could not reach the basket API."
          }
          onRetry={retry}
        />
      ) : !hasBaskets ? (
        <EmptyState
          chip="NOT INDEXED"
          title="No baskets indexed yet"
          description="The backend returns an empty list until baskets are created and indexed — nothing here is fabricated."
          action={
            <Button render={<Link href="/create" />} size="sm">
              Create the first basket
            </Button>
          }
          previewLabel="Layout preview — basket ranking table"
          preview={
            <div className="overflow-hidden rounded-md border border-border/60">
              {/* Real column headers of the populated table */}
              <div className="grid grid-cols-[2rem_minmax(0,2fr)_1fr_1fr_1fr_1fr] gap-3 border-b border-border/60 bg-muted/40 px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                <span>#</span>
                <span>Basket</span>
                <span className="text-right">AUM</span>
                <span className="text-right">Share price</span>
                <span className="text-right">24h</span>
                <span className="text-right">Holders</span>
              </div>
              <div className="flex flex-col gap-2.5 px-3 py-3">
                {Array.from({ length: 4 }, (_, row) => (
                  <div
                    key={row}
                    className="grid grid-cols-[2rem_minmax(0,2fr)_1fr_1fr_1fr_1fr] items-center gap-3"
                  >
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="ml-auto h-4 w-4/5" />
                    <Skeleton className="ml-auto h-4 w-4/5" />
                    <Skeleton className="ml-auto h-4 w-4/5" />
                    <Skeleton className="ml-auto h-4 w-4/5" />
                  </div>
                ))}
              </div>
            </div>
          }
        />
      ) : (
        <>
          {/* Controls — search / sort / filter, client-side over the fetched list */}
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="explore-search" className="text-xs font-medium text-muted-foreground">
                Search by basket, creator, or share mint
              </label>
              <input
                id="explore-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. TSLAx or pubkey prefix"
                className="h-9 w-full max-w-sm rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="explore-sort" className="text-xs font-medium text-muted-foreground">
                  Sort by
                </label>
                <select
                  id="explore-sort"
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="h-9 rounded-md border border-border bg-card px-2 text-sm text-foreground outline-none focus:border-ring"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                variant={positiveOnly ? "default" : "outline"}
                size="sm"
                aria-pressed={positiveOnly}
                onClick={() => setPositiveOnly((v) => !v)}
              >
                24h positive only
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              {/* Comparison-first ranking table (desktop) */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-10 pl-4">#</TableHead>
                      <TableHead>Basket</TableHead>
                      <TableHead className="text-right">AUM</TableHead>
                      <TableHead className="text-right">Share price</TableHead>
                      <TableHead className="text-right">24h</TableHead>
                      <TableHead className="text-right">Holders</TableHead>
                      <TableHead className="text-right">Drift</TableHead>
                      <TableHead>Source / freshness</TableHead>
                      <TableHead className="pr-4 text-right">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="p-6">
                          <p className="text-sm text-muted-foreground">
                            No basket matches the current search or filter.
                          </p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      visible.map((b, i) => {
                        const nav = num(b.nav);
                        const sharePrice = num(b.share_price);
                        const change = num(b.return_24h);
                        const drift = driftOf(b);
                        const asOf = asOfOf(b);
                        return (
                          <TableRow key={b.pubkey}>
                            <TableCell className="pl-4 font-mono text-xs tabular-nums text-muted-foreground">
                              {i + 1}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-mono text-xs font-medium">
                                  {truncateAddress(b.pubkey, 6, 4)}
                                </span>
                                <span className="font-mono text-[11px] text-muted-foreground">
                                  creator {b.creator ? truncateAddress(b.creator, 4, 4) : "—"}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs tabular-nums">
                              {nav !== null ? formatUsd(nav, { maximumFractionDigits: 0 }) : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs tabular-nums">
                              {sharePrice !== null ? formatUsd(sharePrice) : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <ChangeCell value={change} />
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs tabular-nums">
                              {b.holders !== null && b.holders !== undefined
                                ? formatTokenAmount(b.holders, { maximumFractionDigits: 0 })
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <DriftCell value={drift} />
                            </TableCell>
                            <TableCell>
                              <FreshnessBadge source={b.source ?? payloadMeta?.source ?? ""} asOf={asOf ?? undefined} />
                            </TableCell>
                            <TableCell className="pr-4 text-right">
                              <Button render={<Link href={`/basket/${b.pubkey}`} />} variant="outline" size="xs">
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile representation — same rows, compact cards */}
              <div className="space-y-3 p-4 md:hidden">
                {visible.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No basket matches the current search or filter.</p>
                ) : (
                  visible.map((b, i) => (
                    <div key={b.pubkey} className="rounded-md border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-medium">
                          #{i + 1} {truncateAddress(b.pubkey, 4, 4)}
                        </span>
                        <ChangeCell value={num(b.return_24h)} />
                      </div>
                      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <dt className="text-muted-foreground">AUM</dt>
                          <dd className="font-mono tabular-nums">
                            {num(b.nav) !== null ? formatUsd(num(b.nav) as number, { maximumFractionDigits: 0 }) : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Price</dt>
                          <dd className="font-mono tabular-nums">
                            {num(b.share_price) !== null ? formatUsd(num(b.share_price) as number) : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Holders</dt>
                          <dd className="font-mono tabular-nums">
                            {b.holders !== null && b.holders !== undefined
                              ? formatTokenAmount(b.holders, { maximumFractionDigits: 0 })
                              : "—"}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <FreshnessBadge source={b.source ?? payloadMeta?.source ?? ""} asOf={asOfOf(b) ?? undefined} />
                        <Button render={<Link href={`/basket/${b.pubkey}`} />} variant="outline" size="xs">
                          View
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {visible.length} of {baskets.length} baskets shown
            </span>
            {payloadMeta ? (
              <FreshnessBadge source={`feed: ${payloadMeta.source}`} asOf={payloadMeta.asOf ?? undefined} />
            ) : null}
            {payloadMeta?.asOf ? (
              <span className="font-mono tabular-nums">last update {formatAsOf(payloadMeta.asOf)}</span>
            ) : null}
            <span>Drift is per-basket (detail page); the list feed does not carry it.</span>
          </div>
        </>
      )}
    </div>
  );
}
