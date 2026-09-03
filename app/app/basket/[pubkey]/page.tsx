"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";

import {
  EmptyState,
  ErrorState,
  FreshnessBadge,
  ChartBlockSkeleton,
  Skeleton,
  TableRowSkeleton,
} from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccrueCrankButton } from "@/components/basket/accrue-crank";
import { NavHistoryChart } from "@/components/basket/nav-history-chart";
import {
  ApiError,
  fetchBasketDetail,
  fetchBasketPerformance,
  fetchMintTickers,
  fetchNavHistory,
  fetchSpy24h,
  numericToNumber,
  type BasketDetail,
  type NavInterval,
  type NavHistoryRow,
} from "@/components/basket/basket-api";
import { ChangeValue } from "@/components/stocks/change-value";
import { formatAsOf, formatTokenAmount, formatUsd, truncateAddress } from "@/lib/format";
import { formatRawShares6 } from "@/components/basket/basket-math";

/** Chart range windows mapped onto /nav/history from+interval params. */
const NAV_RANGES = [
  { key: "1D", fromHours: 24, interval: "5m" as NavInterval },
  { key: "7D", fromHours: 24 * 7, interval: "1h" as NavInterval },
  { key: "30D", fromHours: 24 * 30, interval: "1d" as NavInterval },
  { key: "All", fromHours: null, interval: null },
] as const;
type NavRangeKey = (typeof NAV_RANGES)[number]["key"];

const MAX_COMPOSITION_PARTS = 4;

/** metadata_json may arrive as object or JSON text — parse defensively. */
function metaObj(mj: unknown): Record<string, unknown> | null {
  if (!mj) return null;
  let obj: unknown = mj;
  if (typeof mj === "string") {
    try {
      obj = JSON.parse(mj);
    } catch {
      return null;
    }
  }
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
}

/**
 * Basket detail — name-first header (same hierarchy as the /explore cards),
 * metric strip, one dominant NAV AreaChart with text range buttons, compact
 * holdings table, one fees/parameters section, action rail. All figures are
 * API-driven; missing data renders as an em dash, never a fabricated value.
 */
export default function BasketDetailPage({
  params,
}: {
  params: Promise<{ pubkey: string }>;
}) {
  const { pubkey: rawPubkey } = use(params);
  const pubkey = decodeURIComponent(rawPubkey);

  const [detail, setDetail] = useState<BasketDetail | null>(null);
  const [navRows, setNavRows] = useState<NavHistoryRow[] | null>(null);
  const [navSource, setNavSource] = useState<string | null>(null);
  const [navFailed, setNavFailed] = useState(false);
  const [change24h, setChange24h] = useState<number | null>(null);
  const [spy24h, setSpy24h] = useState<number | null>(null);
  const [mintTickers, setMintTickers] = useState<Map<string, string>>(new Map());
  const [range, setRange] = useState<NavRangeKey>("All");
  const [status, setStatus] = useState<"loading" | "ready" | "not-found" | "error">("loading");
  const [errorInfo, setErrorInfo] = useState<{ message: string; code?: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Detail is load-bearing — it alone decides page status.
  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setErrorInfo(null);

    async function load() {
      try {
        const loaded = await fetchBasketDetail(pubkey, controller.signal);
        setDetail(loaded);
        setStatus("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof ApiError && err.status === 404) {
          setStatus("not-found");
          return;
        }
        setErrorInfo({
          message: err instanceof Error ? err.message : "Could not reach the basket API.",
          code: err instanceof ApiError ? err.code : undefined,
        });
        setStatus("error");
      }
    }

    void load();
    return () => controller.abort();
  }, [pubkey, reloadKey]);

  // NAV series for the selected range (raw snapshots, date_bin bucketing only).
  useEffect(() => {
    const controller = new AbortController();
    setNavRows(null);
    setNavFailed(false);

    async function load() {
      const selected = NAV_RANGES.find((r) => r.key === range) ?? NAV_RANGES[NAV_RANGES.length - 1];
      try {
        const res = await fetchNavHistory(pubkey, controller.signal, {
          from: selected.fromHours !== null ? new Date(Date.now() - selected.fromHours * 3600_000) : undefined,
          interval: selected.interval ?? undefined,
        });
        setNavRows(res.rows);
        setNavSource(res.source);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setNavRows([]);
        setNavFailed(true);
      }
    }

    void load();
    return () => controller.abort();
  }, [pubkey, range, reloadKey]);

  // Optional context — 24h return, SPY benchmark, whitelist tickers. Any
  // failure degrades its metric to an em dash; never blocks the page.
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      const [perfRes, spyRes, tickersRes] = await Promise.allSettled([
        fetchBasketPerformance(pubkey, controller.signal),
        fetchSpy24h(controller.signal),
        fetchMintTickers(controller.signal),
      ]);
      if (perfRes.status === "fulfilled") setChange24h(perfRes.value.change24hPct);
      if (spyRes.status === "fulfilled") setSpy24h(spyRes.value);
      if (tickersRes.status === "fulfilled") setMintTickers(tickersRes.value);
    }

    void load().catch(() => {
      // Aborts racing unmount — optional panels keep their defaults.
    });
    return () => controller.abort();
  }, [pubkey, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // ---- derived metrics (honest: null renders as an em dash) ----
  const sharePrice = numericToNumber(detail?.nav?.sharePrice ?? null);
  const nav = numericToNumber(detail?.nav?.value ?? null);
  const supply = detail?.nav?.supply ?? null;
  const asOf = detail?.nav?.asOf ?? detail?.asOf ?? null;
  const weights = detail?.weights_bps ?? [];
  const driftActual = detail?.drift?.actualWeightsBps ?? null;
  const lastAccrualSeconds = numericToNumber(detail?.last_fee_accrual_ts ?? null);
  const secondsSinceAccrual =
    lastAccrualSeconds !== null && lastAccrualSeconds > 0
      ? Math.max(0, Math.floor(Date.now() / 1000) - lastAccrualSeconds)
      : null;

  const holdingsByMint = useMemo(() => {
    return new Map((detail?.holdings ?? []).map((h) => [h.mint, h]));
  }, [detail]);

  // Name-first identity, same resolution order as the /explore cards.
  const composition = useMemo(() => {
    if (!detail) return null;
    const parts: string[] = [];
    detail.constituents.forEach((mint, i) => {
      const ticker = mintTickers.get(mint) ?? truncateAddress(mint, 4, 4);
      const bps = weights[i];
      parts.push(bps !== undefined ? `${ticker} ${Math.round(bps / 100)}` : ticker);
    });
    if (parts.length === 0) return null;
    const shown = parts.slice(0, MAX_COMPOSITION_PARTS).join(" · ");
    return parts.length > MAX_COMPOSITION_PARTS
      ? `${shown} · +${parts.length - MAX_COMPOSITION_PARTS}`
      : shown;
  }, [detail, mintTickers, weights]);

  const name = useMemo(() => {
    const n = metaObj(detail?.metadata_json)?.name;
    return typeof n === "string" && n.trim() ? n.trim() : null;
  }, [detail]);

  const headline = name ?? composition ?? truncateAddress(pubkey, 6, 6);
  const vsSpy = change24h !== null && spy24h !== null ? change24h - spy24h : null;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/explore" className="underline underline-offset-4 hover:text-foreground">
          Explore
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="font-mono tabular-nums">{truncateAddress(pubkey, 6, 6)}</span>
      </nav>

      {status === "loading" ? <DetailSkeleton /> : null}

      {status === "not-found" ? (
        <EmptyState
          chip="NOT INDEXED"
          title="This basket is not indexed"
          description={`The backend has no basket ${truncateAddress(pubkey, 6, 6)} — baskets only appear here after a create_basket transaction is indexed. Nothing is fabricated to fill the page.`}
          action={
            <Button render={<Link href="/explore" />} size="sm">
              Back to explore
            </Button>
          }
        />
      ) : null}

      {status === "error" ? (
        <ErrorState
          title="Basket detail unavailable"
          message={
            errorInfo
              ? `${errorInfo.code ? `${errorInfo.code}: ` : ""}${errorInfo.message}`
              : "Could not reach the basket API."
          }
          onRetry={retry}
        />
      ) : null}

      {status === "ready" && detail ? (
        <>
          {/* identity + action rail */}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-1.5">
              <h1 className="text-3xl font-semibold tracking-tight" title={detail.pubkey}>
                {headline}
              </h1>
              {name && composition ? (
                <p className="font-mono text-xs tabular-nums text-muted-foreground">{composition}</p>
              ) : null}
              <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {truncateAddress(detail.pubkey, 6, 6)} · creator{" "}
                {truncateAddress(detail.creator, 4, 4)} · created {formatAsOf(detail.created_at)}
              </p>
            </div>

            <div className="flex w-full shrink-0 flex-col gap-2 lg:w-56">
              <Button render={<Link href={`/basket/${pubkey}/buy`} />}>Buy shares</Button>
              <Button render={<Link href={`/basket/${pubkey}/redeem`} />} variant="outline">
                Redeem shares
              </Button>
              <div className="border-t border-border pt-2">
                <AccrueCrankButton
                  basket={detail.pubkey}
                  factory={detail.factory}
                  creator={detail.creator}
                  treasury={detail.treasury}
                  shareMint={detail.share_mint}
                  constituents={detail.constituents}
                  secondsSinceAccrual={secondsSinceAccrual}
                  variant="ghost"
                />
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Redeem is permissionless and oracle-free — it works over any RPC even if this
                indexer is offline.
              </p>
            </div>
          </div>

          {/* metric strip */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardDescription>Share price</CardDescription>
                <CardTitle className="font-mono text-2xl tabular-nums">
                  {sharePrice !== null ? formatUsd(sharePrice) : "—"}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardDescription>AUM</CardDescription>
                <CardTitle className="font-mono text-2xl tabular-nums">
                  {nav !== null ? formatUsd(nav, { maximumFractionDigits: 0 }) : "—"}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardDescription>24h</CardDescription>
                <CardTitle className="font-mono text-2xl tabular-nums">
                  <ChangeValue changePct={change24h} className="text-2xl" />
                </CardTitle>
              </CardHeader>
            </Card>
            {vsSpy !== null ? (
              <Card className="h-full">
                <CardHeader className="pb-2">
                  <CardDescription>vs SPY 24h</CardDescription>
                  <CardTitle className="font-mono text-2xl tabular-nums">
                    {vsSpy >= 0 ? "+" : ""}
                    {vsSpy.toFixed(2)}%
                  </CardTitle>
                </CardHeader>
              </Card>
            ) : (
              <Card className="h-full">
                <CardHeader className="pb-2">
                  <CardDescription>Share supply</CardDescription>
                  <CardTitle className="font-mono text-2xl tabular-nums">
                    {supply !== null && /^\d+$/.test(supply.trim())
                      ? formatTokenAmount(Number(formatRawShares6(BigInt(supply.trim()))), {
                          maximumFractionDigits: 0,
                        })
                      : "—"}
                  </CardTitle>
                </CardHeader>
              </Card>
            )}
          </div>

          {/* dominant NAV chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">NAV history</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-3 text-xs">
                <nav aria-label="Chart range" className="flex items-center gap-3">
                  {NAV_RANGES.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      aria-current={r.key === range ? "true" : undefined}
                      onClick={() => setRange(r.key)}
                      className={`transition-colors ${
                        r.key === range
                          ? "font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {r.key}
                    </button>
                  ))}
                </nav>
                <FreshnessBadge source={navSource ?? "onchain-indexed"} asOf={asOf ?? undefined} />
              </CardDescription>
            </CardHeader>
            <CardContent>
              {navRows === null ? (
                <ChartBlockSkeleton label="Loading NAV history" />
              ) : navFailed ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  NAV history is unavailable right now — the indexer could not be reached. Switching
                  ranges or reloading retries.
                </p>
              ) : (
                <NavHistoryChart rows={navRows} fitYDomain />
              )}
            </CardContent>
          </Card>

          {/* holdings */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Holdings</CardTitle>
              <CardDescription className="text-xs">
                Target vs actual weights from indexed vault holdings — V0 has no auto-rebalance.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="h-11 hover:bg-transparent">
                    <TableHead className="pl-4">Asset</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Raw</TableHead>
                    <TableHead className="pr-4 text-right">Scaled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.constituents.map((mint, i) => {
                    const holding = holdingsByMint.get(mint);
                    const target = weights[i];
                    const actual =
                      driftActual && driftActual[i] !== undefined ? driftActual[i] : null;
                    const scaledNumber = numericToNumber(holding?.scaled_amount ?? null);
                    const multiplier = numericToNumber(holding?.multiplier ?? null);
                    const ticker = mintTickers.get(mint) ?? truncateAddress(mint, 4, 4);
                    return (
                      <TableRow key={mint} className="h-11">
                        <TableCell className="pl-4 py-0 font-mono text-xs tabular-nums" title={mint}>
                          {ticker}
                        </TableCell>
                        <TableCell className="py-0 text-right font-mono text-xs tabular-nums">
                          {target !== undefined ? `${(target / 100).toFixed(2)}%` : "—"}
                        </TableCell>
                        <TableCell className="py-0 text-right font-mono text-xs tabular-nums">
                          {actual !== null ? `${(actual / 100).toFixed(2)}%` : "—"}
                        </TableCell>
                        <TableCell className="py-0 text-right font-mono text-xs tabular-nums">
                          {/* raw = onchain truth — printed as text, never through Number */}
                          {holding?.raw_amount ?? "—"}
                        </TableCell>
                        <TableCell className="py-0 pr-4 text-right font-mono text-xs tabular-nums">
                          {scaledNumber !== null ? (
                            <span
                              title={
                                multiplier !== null
                                  ? `raw × multiplier ${multiplier} / 10^${holding?.decimals ?? "?"}`
                                  : undefined
                              }
                            >
                              {formatTokenAmount(scaledNumber)}
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
            </CardContent>
          </Card>

          {/* fees + parameters */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Fees &amp; parameters</CardTitle>
              <CardDescription className="text-xs">
                Entry / exit / management, paid in shares — never in underlying.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="h-11 hover:bg-transparent">
                    <TableHead className="pl-4">Parameter</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="pr-4 text-right">Cap</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <FeeRow label="Entry (mint)" rate={detail.entry_fee_bps} cap={300} />
                  <FeeRow label="Exit (redeem)" rate={detail.exit_fee_bps} cap={100} />
                  <FeeRow label="Management (per year)" rate={detail.management_fee_bps} cap={300} />
                </TableBody>
              </Table>
              <p className="border-t border-border p-4 text-xs leading-relaxed text-muted-foreground">
                Every fee splits 90/10 creator/treasury; management accrues via the permissionless
                crank or inside the next mint/redeem. Weights and fees are immutable on-chain.
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}

    </div>
  );
}

function FeeRow({ label, rate, cap }: { label: string; rate: number; cap: number }) {
  return (
    <TableRow className="h-11">
      <TableCell className="py-0 pl-4 text-xs">{label}</TableCell>
      <TableCell className="py-0 text-right font-mono text-xs tabular-nums">
        {(rate / 100).toFixed(2)}%
      </TableCell>
      <TableCell className="py-0 pr-4 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {(cap / 100).toFixed(2)}%
      </TableCell>
    </TableRow>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {["Share price", "AUM", "24h", "Supply"].map((label) => (
          <div key={label} className="rounded-lg border border-border bg-card p-5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <ChartBlockSkeleton label="Loading NAV history" />
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <TableRowSkeleton rows={4} columns={5} label="Loading holdings" />
      </div>
    </div>
  );
}
