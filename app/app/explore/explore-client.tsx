"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ErrorState, EmptyState, FreshnessBadge, Skeleton, TableRowSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
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
  /** Not carried by the list feed today; parsed defensively if the backend adds it. */
  metadata_json?: string | Record<string, unknown> | null;
  num_constituents?: Numeric;
  share_mint?: string | null;
  nav?: Numeric;
  supply?: Numeric;
  share_price?: Numeric;
  return_24h?: Numeric;
  return_7d?: Numeric;
  return_30d?: Numeric;
  holders?: number | null;
  mint_count?: number | null;
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

interface YahooCandle {
  ts: number;
  close: number;
}

interface OverviewSeries {
  symbol: string;
  first: number;
  last: number;
  changePct: number;
  candles: YahooCandle[];
}

interface OverviewPayload {
  data?: OverviewSeries[];
  range?: string;
}

/** Benchmark returns (%) computed from SPY daily closes; null windows mean no comparison. */
interface Bench {
  d24: number | null;
  d30: number | null;
}

type SortKey = "popular" | "return_24h" | "return_30d" | "vs_spy";
type ViewMode = "table" | "grid";

function num(v: Numeric): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asOfOf(b: BasketRow): string | null {
  return b.asOf ?? b.nav_as_of ?? b.refreshed_at ?? null;
}

/** Basket display name from metadata_json when present; the list feed carries no name today. */
function nameOf(b: BasketRow): string | null {
  const mj = b.metadata_json;
  if (!mj) return null;
  let obj: unknown = mj;
  if (typeof mj === "string") {
    try {
      obj = JSON.parse(mj);
    } catch {
      return null;
    }
  }
  if (obj && typeof obj === "object") {
    const name = (obj as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
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

/** Basket return minus SPY return over the same window. Gray +/-, sign always shown. */
function DeltaCell({ value, window: win }: { value: number | null; window: "24h" | "30d" }) {
  if (value === null) {
    return (
      <span
        className="text-muted-foreground"
        title={`No ${win} comparison — needs both the basket ${win} return and the SPY ${win} close.`}
      >
        —
      </span>
    );
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

function ConstituentsCell({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span
        className="text-muted-foreground"
        title="Constituent count is served on the basket detail page; the list feed does not carry it."
      >
        —
      </span>
    );
  }
  return <span className="font-mono text-xs tabular-nums">{value}</span>;
}

function CreatorChip({ creator }: { creator: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Link
        href={`/creator/${creator}`}
        title={`Created by ${creator} — open creator page`}
        className="inline-flex items-center rounded-[4px] border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {truncateAddress(creator, 4, 4)}
      </Link>
      <CopyButton value={creator} label="Copy creator pubkey" />
    </span>
  );
}

interface BasketCardProps {
  b: BasketRow;
  rank: number;
  feedSource: string;
  bench: Bench | null;
}

function BasketCard({ b, rank, feedSource, bench }: BasketCardProps) {
  const name = nameOf(b);
  const change = num(b.return_24h);
  const r30 = num(b.return_30d);
  const d24 = change !== null && bench?.d24 != null ? change - bench.d24 : null;
  const d30 = r30 !== null && bench?.d30 != null ? r30 - bench.d30 : null;
  const constituents = num(b.num_constituents);
  const creator = b.creator ?? null;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="mr-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">#{rank}</span>
          <span
            className="break-all font-mono text-xs font-medium"
            title={name ? b.pubkey : undefined}
          >
            {name ?? truncateAddress(b.pubkey, 6, 4)}
          </span>
        </div>
        <ChangeCell value={change} />
      </div>

      {creator ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Creator</span>
          <CreatorChip creator={creator} />
        </div>
      ) : (
        <span className="text-[11px] text-muted-foreground">Creator not indexed</span>
      )}

      <dl className="grid grid-cols-3 gap-2 text-xs">
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
          <dt className="text-muted-foreground">Constituents</dt>
          <dd>
            <ConstituentsCell value={constituents} />
          </dd>
        </div>
      </dl>

      {bench ? (
        <dl className="grid grid-cols-2 gap-2 border-t border-border/60 pt-2 text-xs">
          <div>
            <dt className="text-muted-foreground">vs SPY 24h</dt>
            <dd>
              <DeltaCell value={d24} window="24h" />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">vs SPY 30d</dt>
            <dd>
              <DeltaCell value={d30} window="30d" />
            </dd>
          </div>
        </dl>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2">
        <FreshnessBadge source={b.source ?? feedSource} asOf={asOfOf(b) ?? undefined} />
        <Button render={<Link href={`/basket/${b.pubkey}`} />} variant="outline" size="xs">
          Open
        </Button>
      </div>
    </div>
  );
}

export default function ExploreClient() {
  const [baskets, setBaskets] = useState<BasketRow[]>([]);
  const [payloadMeta, setPayloadMeta] = useState<{ source: string; asOf: string | null; note?: string } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorInfo, setErrorInfo] = useState<{ message: string; code?: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [bench, setBench] = useState<Bench | null>(null);

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("popular");
  const [positiveOnly, setPositiveOnly] = useState(false);
  const [view, setView] = useState<ViewMode>("table");

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

  // Benchmark series (SPY daily closes via the market overview feed) — fetched once.
  // When unavailable, every vs-SPY affordance is hidden; no fabricated zeros.
  useEffect(() => {
    const controller = new AbortController();

    async function loadBench() {
      try {
        const res = await fetch(`${API_BASE}/api/v1/market/overview?range=1mo`, {
          signal: controller.signal,
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          setBench(null);
          return;
        }
        const payload = (await res.json()) as OverviewPayload;
        const spy = payload.data?.find((s) => s.symbol === "SPY");
        const candles = spy?.candles ?? [];
        if (candles.length < 2) {
          setBench(null);
          return;
        }
        const last = candles[candles.length - 1]?.close;
        const prev = candles[candles.length - 2]?.close;
        const first = candles[0]?.close;
        const d24 = prev ? ((last - prev) / prev) * 100 : null;
        const d30 = first ? ((last - first) / first) * 100 : null;
        setBench(d24 === null && d30 === null ? null : { d24, d30 });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setBench(null);
      }
    }

    void loadBench();
    return () => controller.abort();
  }, []);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const showVs24 = bench?.d24 != null;
  const showVs30 = bench?.d30 != null;

  const SORT_OPTIONS: { key: SortKey; label: string }[] = useMemo(() => {
    const base: { key: SortKey; label: string }[] = [
      { key: "popular", label: "Most popular" },
      { key: "return_24h", label: "Best 24h" },
      { key: "return_30d", label: "Best 30d" },
    ];
    if (showVs24 || showVs30) base.push({ key: "vs_spy", label: "vs SPY" });
    return base;
  }, [showVs24, showVs30]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = baskets.filter((b) => {
      if (positiveOnly) {
        const change = num(b.return_24h);
        if (change === null || change < 0) return false;
      }
      if (!q) return true;
      const name = nameOf(b)?.toLowerCase() ?? "";
      return (
        b.pubkey.toLowerCase().includes(q) ||
        name.includes(q) ||
        (b.creator ?? "").toLowerCase().includes(q) ||
        (b.share_mint ?? "").toLowerCase().includes(q)
      );
    });

    const delta30 = (b: BasketRow): number | null => {
      const r = num(b.return_30d);
      return r !== null && bench?.d30 != null ? r - bench.d30 : null;
    };
    const delta24 = (b: BasketRow): number | null => {
      const r = num(b.return_24h);
      return r !== null && bench?.d24 != null ? r - bench.d24 : null;
    };
    const bestDelta = (b: BasketRow): number | null => delta30(b) ?? delta24(b);

    rows = [...rows].sort((a, b) => {
      switch (sortKey) {
        case "return_24h":
          return (num(b.return_24h) ?? -Infinity) - (num(a.return_24h) ?? -Infinity);
        case "return_30d":
          return (num(b.return_30d) ?? -Infinity) - (num(a.return_30d) ?? -Infinity);
        case "vs_spy":
          return (bestDelta(b) ?? -Infinity) - (bestDelta(a) ?? -Infinity);
        case "popular":
        default:
          // Most popular: holders first, AUM as tiebreaker.
          return (
            (b.holders ?? -1) - (a.holders ?? -1) ||
            (num(b.nav) ?? -1) - (num(a.nav) ?? -1)
          );
      }
    });
    return rows;
  }, [baskets, query, sortKey, positiveOnly, bench]);

  const hasBaskets = baskets.length > 0;
  const tableColSpan = 8 + (showVs24 ? 1 : 0) + (showVs30 ? 1 : 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">Baskets</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Community-made strategy baskets — every creator and every return is on-chain.
          </p>
        </div>
        <Button render={<Link href="/create" />}>Create basket</Button>
      </div>

      {status === "loading" ? (
        <Card>
          <CardContent className="space-y-4 p-4">
            <TableRowSkeleton rows={8} columns={7} label="Loading baskets" />
          </CardContent>
        </Card>
      ) : status === "error" ? (
        <ErrorState
          title="Baskets unavailable"
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
          previewLabel="Layout preview — baskets table"
          preview={
            <div className="overflow-hidden rounded-md border border-border/60">
              {/* Real column headers of the populated table */}
              <div className="grid grid-cols-[2rem_minmax(0,2fr)_1fr_1fr_1fr_1fr] gap-3 border-b border-border/60 bg-muted/40 px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                <span>#</span>
                <span>Basket</span>
                <span>Creator</span>
                <span className="text-right">AUM</span>
                <span className="text-right">24h</span>
                <span className="text-right">vs SPY</span>
              </div>
              <div className="flex flex-col gap-2.5 px-3 py-3">
                {Array.from({ length: 4 }, (_, row) => (
                  <div
                    key={row}
                    className="grid grid-cols-[2rem_minmax(0,2fr)_1fr_1fr_1fr_1fr] items-center gap-3"
                  >
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-3/5" />
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
          {/* Controls — view toggle / search / sort / filter, client-side over the fetched list */}
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
                placeholder="e.g. pubkey prefix or creator"
                className="h-9 w-full max-w-sm rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div
                role="group"
                aria-label="View mode"
                className="inline-flex h-9 items-center gap-0.5 rounded-md border border-border p-0.5"
              >
                {(["table", "grid"] as ViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={view === mode}
                    onClick={() => setView(mode)}
                    className={`h-8 rounded-[4px] px-3 font-mono text-[11px] uppercase tracking-wide transition-colors ${
                      view === mode
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
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

          {view === "table" ? (
            <Card>
              <CardContent className="p-0">
                {/* Comparison-first ranking table (desktop) */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-10 pl-4">#</TableHead>
                        <TableHead>Basket</TableHead>
                        <TableHead>Creator</TableHead>
                        <TableHead className="text-right">AUM</TableHead>
                        <TableHead className="text-right">Share price</TableHead>
                        <TableHead className="text-right">24h</TableHead>
                        {showVs24 ? <TableHead className="text-right">vs SPY 24h</TableHead> : null}
                        {showVs30 ? <TableHead className="text-right">vs SPY 30d</TableHead> : null}
                        <TableHead>Source / freshness</TableHead>
                        <TableHead className="pr-4 text-right">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={tableColSpan} className="p-6">
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
                          const r30 = num(b.return_30d);
                          const asOf = asOfOf(b);
                          const d24 = change !== null && bench?.d24 != null ? change - bench.d24 : null;
                          const d30 = r30 !== null && bench?.d30 != null ? r30 - bench.d30 : null;
                          return (
                            <TableRow key={b.pubkey}>
                              <TableCell className="pl-4 font-mono text-xs tabular-nums text-muted-foreground">
                                {i + 1}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span
                                    className="font-mono text-xs font-medium"
                                    title={nameOf(b) ? b.pubkey : undefined}
                                  >
                                    {nameOf(b) ?? truncateAddress(b.pubkey, 6, 4)}
                                  </span>
                                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                    constituents <ConstituentsCell value={num(b.num_constituents)} />
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                {b.creator ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <Link
                                      href={`/creator/${b.creator}`}
                                      className="font-mono text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                                      title={`Created by ${b.creator} — open creator page`}
                                    >
                                      {truncateAddress(b.creator, 6, 4)}
                                    </Link>
                                    <CopyButton value={b.creator} label="Copy creator pubkey" />
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
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
                              {showVs24 ? (
                                <TableCell className="text-right">
                                  <DeltaCell value={d24} window="24h" />
                                </TableCell>
                              ) : null}
                              {showVs30 ? (
                                <TableCell className="text-right">
                                  <DeltaCell value={d30} window="30d" />
                                </TableCell>
                              ) : null}
                              <TableCell>
                                <FreshnessBadge source={b.source ?? payloadMeta?.source ?? ""} asOf={asOf ?? undefined} />
                              </TableCell>
                              <TableCell className="pr-4 text-right">
                                <Button render={<Link href={`/basket/${b.pubkey}`} />} variant="outline" size="xs">
                                  Open
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile representation — same rows as cards */}
                <div className="space-y-3 p-4 md:hidden">
                  {visible.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No basket matches the current search or filter.</p>
                  ) : (
                    visible.map((b, i) => (
                      <BasketCard key={b.pubkey} b={b} rank={i + 1} feedSource={payloadMeta?.source ?? ""} bench={bench} />
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            /* Grid view — creator-first cards */
            <div>
              {visible.length === 0 ? (
                <Card>
                  <CardContent className="p-6">
                    <p className="text-sm text-muted-foreground">
                      No basket matches the current search or filter.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {visible.map((b, i) => (
                    <BasketCard key={b.pubkey} b={b} rank={i + 1} feedSource={payloadMeta?.source ?? ""} bench={bench} />
                  ))}
                </div>
              )}
            </div>
          )}

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
            {bench ? (
              <span>vs SPY = basket return − SPY return (Yahoo Finance daily closes) over the matching window.</span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
