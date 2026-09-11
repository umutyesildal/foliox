"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ThesisComposerModal } from "@/components/social/thesis-composer";

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
import { RangeLinks } from "@/components/ui/range-links";
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
 * metric strip, then hairline-divided sections: NAV history (hero chart on an
 * elevated card, mono section header + range buttons), a compact mono
 * holdings table with a scaled-total footer, and one quiet inline fees card.
 * All figures are API-driven; missing data renders as an em dash or a quiet
 * centered note, never a fabricated value.
 */
export default function BasketDetailPage({
  params,
}: {
  params: Promise<{ pubkey: string }>;
}) {
  const { pubkey: rawPubkey } = use(params);
  const pubkey = decodeURIComponent(rawPubkey);
  const router = useRouter();

  const [detail, setDetail] = useState<BasketDetail | null>(null);
  const [thesisOpen, setThesisOpen] = useState(false);
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

  // Footer total for the holdings table — sum of scaled amounts that exist;
  // null when the indexer returned no scaled figures (total row is skipped).
  const scaledTotal = useMemo(() => {
    let sum = 0;
    let any = false;
    for (const holding of detail?.holdings ?? []) {
      const scaled = numericToNumber(holding.scaled_amount ?? null);
      if (scaled !== null) {
        sum += scaled;
        any = true;
      }
    }
    return any ? sum : null;
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
    <div className="space-y-8">
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
              <Button variant="ghost" onClick={() => setThesisOpen(true)}>
                Write thesis
              </Button>
              <Button
                variant="ghost"
                onClick={() => router.push(`/create?clone=${encodeURIComponent(pubkey)}`)}
                title="Start the create wizard pre-filled with this basket's constituents, weights and fees"
              >
                Clone this basket
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
                Redeem is permissionless and oracle-free — works over any RPC.
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

          {/* dominant NAV chart — hero visual on an elevated card */}
          <div className="divide-y divide-border">
          <section aria-label="NAV history" className="pb-10 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  NAV history
                </h2>
                <FreshnessBadge source={navSource ?? "onchain-indexed"} asOf={asOf ?? undefined} />
              </div>
              <RangeLinks
                options={NAV_RANGES.map((r) => r.key)}
                value={range}
                onChange={setRange}
              />
            </div>
            <div className="rounded-xl bg-card shadow-sm ring-1 ring-border dark:shadow-xl dark:shadow-black/20">
              <div className="p-5">
                {navRows === null ? (
                  <ChartBlockSkeleton label="Loading NAV history" />
                ) : navFailed ? (
                  <div className="flex h-[320px] items-center justify-center px-6">
                    <p className="text-center font-mono text-xs text-muted-foreground">
                      NAV history unavailable — switching ranges or reloading retries
                    </p>
                  </div>
                ) : (
                  <NavHistoryChart rows={navRows} fitYDomain />
                )}
              </div>
            </div>
          </section>

          {/* holdings — compact mono table */}
          <section aria-label="Holdings" className="py-10">
            <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4">
              <h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Holdings
              </h2>
              <p className="font-mono text-[11px] text-muted-foreground">
                target vs actual · no auto-rebalance in V0
              </p>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="h-11 hover:bg-transparent">
                      <TableHead className="pl-5 font-mono text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                        Asset
                      </TableHead>
                      <TableHead className="text-right font-mono text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                        Target
                      </TableHead>
                      <TableHead className="text-right font-mono text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                        Actual
                      </TableHead>
                      <TableHead className="text-right font-mono text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                        Raw
                      </TableHead>
                      <TableHead className="pr-5 text-right font-mono text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                        Scaled
                      </TableHead>
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
                          <TableCell className="pl-5 py-0 font-mono text-xs tabular-nums" title={mint}>
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
                          <TableCell className="py-0 pr-5 text-right font-mono text-xs tabular-nums">
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
                    {scaledTotal !== null ? (
                      <TableRow className="h-11 border-t border-border hover:bg-transparent">
                        <TableCell className="py-0 pl-5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                          Total scaled
                        </TableCell>
                        <TableCell colSpan={3} />
                        <TableCell className="py-0 pr-5 text-right font-mono text-xs tabular-nums">
                          {formatTokenAmount(scaledTotal)}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>

          {/* fees + parameters — one visually quiet card */}
          <section aria-label="Fees and parameters" className="pt-10">
            <h2 className="pb-4 font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Fees &amp; parameters
            </h2>
            <Card>
              <CardContent className="flex flex-col gap-2.5 p-5 first:pt-5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-sm tabular-nums">
                  <span className="text-muted-foreground">Entry</span>
                  <span title="Protocol cap 3.00%">
                    {(detail.entry_fee_bps / 100).toFixed(2)}%
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">Exit</span>
                  <span title="Protocol cap 1.00%">
                    {(detail.exit_fee_bps / 100).toFixed(2)}%
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">Management</span>
                  <span title="Protocol cap 3.00%/yr">
                    {(detail.management_fee_bps / 100).toFixed(2)}%/yr
                  </span>
                </div>
                <p className="font-mono text-[11px] leading-5 text-muted-foreground">
                  Paid in shares · 90/10 creator/treasury split · weights and fees are immutable
                  on-chain
                </p>
              </CardContent>
            </Card>
          </section>
          </div>
        </>
      ) : null}

      <ThesisComposerModal
        open={thesisOpen}
        onClose={() => setThesisOpen(false)}
        basket={detail?.pubkey ?? null}
        basketLabel={name ?? undefined}
      />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true">
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
      <div className="divide-y divide-border">
        <section className="pb-10 pt-2">
          <div className="flex items-center justify-between pb-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="rounded-xl bg-card p-5 shadow-sm ring-1 ring-border dark:shadow-xl dark:shadow-black/20">
            <ChartBlockSkeleton label="Loading NAV history" />
          </div>
        </section>
        <section className="py-10">
          <div className="flex items-center justify-between pb-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-48" />
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <TableRowSkeleton rows={4} columns={5} label="Loading holdings" />
          </div>
        </section>
      </div>
    </div>
  );
}
