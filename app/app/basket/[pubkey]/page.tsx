"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";

import {
  EmptyState,
  ErrorState,
  FreshnessBadge,
  ChartBlockSkeleton,
  MetricCardSkeleton,
  Skeleton,
  TableRowSkeleton,
} from "@/components/states";
import { Badge } from "@/components/ui/badge";
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
  fetchBasketHoldings,
  fetchNavHistory,
  numericToNumber,
  type BasketDetail,
  type NavHistoryRow,
  type VaultHoldingRow,
} from "@/components/basket/basket-api";
import { formatAsOf, formatBps, formatTokenAmount, formatUsd, truncateAddress } from "@/lib/format";
import { formatRawShares6 } from "@/components/basket/basket-math";

/**
 * Basket detail — identity + immutable parameters, metric strip, dominant NAV
 * AreaChart, target/actual/drift weights table, fee schedule, risk/redeem
 * explainer, action rail. All figures carry source + as-of provenance; the
 * indexer is convenience only (redeem works without it).
 */
export default function BasketDetailPage({
  params,
}: {
  params: Promise<{ pubkey: string }>;
}) {
  const { pubkey: rawPubkey } = use(params);
  const pubkey = decodeURIComponent(rawPubkey);

  const [detail, setDetail] = useState<BasketDetail | null>(null);
  const [holdings, setHoldings] = useState<VaultHoldingRow[] | null>(null);
  const [navRows, setNavRows] = useState<NavHistoryRow[] | null>(null);
  const [navSource, setNavSource] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "not-found" | "error">("loading");
  const [errorInfo, setErrorInfo] = useState<{ message: string; code?: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setErrorInfo(null);

    async function load() {
      try {
        // Detail is load-bearing; holdings + NAV history are parallel reads.
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
        return;
      }
      try {
        const [holdingsRes, navRes] = await Promise.allSettled([
          fetchBasketHoldings(pubkey, controller.signal),
          fetchNavHistory(pubkey, controller.signal),
        ]);
        if (holdingsRes.status === "fulfilled") setHoldings(holdingsRes.value);
        if (navRes.status === "fulfilled") {
          setNavRows(navRes.value.rows);
          setNavSource(navRes.value.source);
        }
      } catch {
        // AbortError racing shutdown — leave secondary panels as-is.
      }
    }

    void load();
    return () => controller.abort();
  }, [pubkey, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // ---- derived metrics (honest: null renders as an em dash) ----
  const nav = numericToNumber(detail?.nav?.value ?? null);
  const sharePrice = numericToNumber(detail?.nav?.sharePrice ?? null);
  const supply = detail?.nav?.supply ?? null;
  const asOf = detail?.nav?.asOf ?? detail?.asOf ?? null;
  const weights = detail?.weights_bps ?? [];
  const driftActual = detail?.drift?.actualWeightsBps ?? null;
  const driftBps = detail?.drift?.driftBps ?? null;
  const lastAccrualSeconds = numericToNumber(detail?.last_fee_accrual_ts ?? null);
  const secondsSinceAccrual =
    lastAccrualSeconds !== null && lastAccrualSeconds > 0
      ? Math.max(0, Math.floor(Date.now() / 1000) - lastAccrualSeconds)
      : null;

  const holdingsByMint = useMemo(() => {
    const source = holdings ?? detail?.holdings ?? [];
    return new Map(source.map((h) => [h.mint, h]));
  }, [holdings, detail]);

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
          {/* identity + immutable parameters */}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-semibold tracking-tight">Strategy basket</h1>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {detail.num_constituents} constituents
                </Badge>
                <Badge variant="secondary" className="font-mono text-[11px]">
                  immutable
                </Badge>
              </div>
              <p className="font-mono text-xs tabular-nums break-all text-muted-foreground">
                {detail.pubkey}
              </p>
              <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Creator</dt>
                  <dd className="font-mono tabular-nums">{truncateAddress(detail.creator, 4, 4)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Share mint</dt>
                  <dd className="font-mono tabular-nums">
                    {truncateAddress(detail.share_mint, 4, 4)}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Treasury</dt>
                  <dd className="font-mono tabular-nums">{truncateAddress(detail.treasury, 4, 4)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Created</dt>
                  <dd className="font-mono tabular-nums">{formatAsOf(detail.created_at)}</dd>
                </div>
              </dl>
              {detail.metadata_hash ? (
                <p className="font-mono text-[11px] break-all text-muted-foreground">
                  metadata_hash {detail.metadata_hash}
                </p>
              ) : null}
            </div>

            {/* action rail */}
            <Card className="w-full shrink-0 lg:w-72">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Actions</CardTitle>
                <CardDescription className="text-xs">
                  In-kind mint/redeem is the core path — no oracle, no backend signature.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Button render={<Link href={`/basket/${pubkey}/buy`} />}>Buy shares</Button>
                <Button render={<Link href={`/basket/${pubkey}/redeem`} />} variant="outline">
                  Redeem shares
                </Button>
                <div className="mt-1 border-t border-border pt-2">
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
              </CardContent>
            </Card>
          </div>

          {/* metric strip */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="NAV" value={nav !== null ? formatUsd(nav, { maximumFractionDigits: 0 }) : "—"} sub="Σ(scaled × price)" mono />
            <Metric
              label="Share price"
              value={sharePrice !== null ? formatUsd(sharePrice) : "—"}
              sub="nav / supply"
              mono
            />
            <Metric
              label="Share supply"
              value={
                supply !== null && /^\d+$/.test(supply.trim())
                  ? formatTokenAmount(Number(formatRawShares6(BigInt(supply.trim()))), {
                      maximumFractionDigits: 0,
                    })
                  : "—"
              }
              sub={supply !== null ? `raw ${supply}` : "6 decimals · genesis 1,000,000"}
              mono
            />
            <Metric
              label="AUM"
              value={nav !== null ? formatUsd(nav, { maximumFractionDigits: 0 }) : "—"}
              sub="latest indexed NAV"
              mono
            />
          </div>

          {/* dominant NAV chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">NAV history</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
                <FreshnessBadge source={navSource ?? "onchain-indexed"} asOf={asOf ?? undefined} />
                <span>raw snapshot series — no interpolation</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {navRows === null ? (
                <ChartBlockSkeleton label="Loading NAV history" />
              ) : (
                <NavHistoryChart rows={navRows} />
              )}
            </CardContent>
          </Card>

          {/* weights table — target vs actual vs drift */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Constituents, weights, drift</CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                {detail.drift?.basis ??
                  "Drift = actual − target bps, computed from vault_holdings.scaled_amount. No auto-rebalance exists in V0."}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Constituent mint</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Drift</TableHead>
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
                    const drift =
                      driftBps && driftBps[i] !== undefined
                        ? driftBps[i]
                        : actual !== null && target !== undefined
                          ? actual - target
                          : null;
                    const rawNumber = numericToNumber(holding?.raw_amount ?? null);
                    const scaledNumber = numericToNumber(holding?.scaled_amount ?? null);
                    const multiplier = numericToNumber(holding?.multiplier ?? null);
                    const driftClass =
                      drift === null
                        ? "text-muted-foreground"
                        : drift === 0
                          ? "text-muted-foreground"
                          : drift > 0
                            ? "text-foreground"
                            : "text-muted-foreground";
                    return (
                      <TableRow key={mint}>
                        <TableCell className="pl-4 font-mono text-xs tabular-nums">
                          {truncateAddress(mint, 6, 6)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {target !== undefined ? formatBps(target) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {actual !== null ? formatBps(actual) : "—"}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-xs tabular-nums ${driftClass}`}>
                          {drift !== null ? formatBps(drift, { signed: true }) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {/* raw = onchain truth — printed as text, never through Number */}
                          {holding?.raw_amount ?? "—"}
                        </TableCell>
                        <TableCell className="pr-4 text-right font-mono text-xs tabular-nums">
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

          <div className="grid gap-4 lg:grid-cols-2">
            {/* fee schedule + 90/10 split */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Fee schedule (immutable)</CardTitle>
                <CardDescription className="text-xs">
                  Caps 300 / 100 / 300 bps. Fees are paid in shares, never in underlying.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-4">Fee</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="pr-4 text-right">Cap</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <FeeRow label="Entry (mint_in_kind)" rate={detail.entry_fee_bps} cap={300} />
                    <FeeRow label="Exit (redeem_in_kind)" rate={detail.exit_fee_bps} cap={100} />
                    <FeeRow label="Management (per year, streamed)" rate={detail.management_fee_bps} cap={300} />
                  </TableBody>
                </Table>
                <p className="border-t border-border p-4 text-xs leading-relaxed text-muted-foreground">
                  Every fee splits 90/10: 90% to the creator, 10% to the treasury
                  (remainder to treasury so floor dust is never lost). Management fee ={" "}
                  <span className="font-mono">supply × bps × elapsed / (10000 × 31536000)</span> —
                  accrued by a permissionless crank, or inside the next mint/redeem.
                </p>
              </CardContent>
            </Card>

            {/* risk / redeem explainer */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Redeem mechanics and risk</CardTitle>
                <CardDescription className="font-mono text-[11px]">
                  redeem_in_kind · permissionless · oracle-free
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs leading-relaxed">
                <p>
                  Redeem burns shares and returns underlying pro-rata per constituent:{" "}
                  <span className="font-mono">out = V × (shares − exit fee) / supply</span>, floored
                  to the raw token unit. Rounding dust stays in the vault and favors remaining
                  holders.
                </p>
                <p>
                  No oracle, no whitelist pause and no backend account participate in redeem —
                  it works over any RPC even if this indexer is offline. The whitelist pause
                  blocks <span className="font-mono">mint</span> only, never redeem.
                </p>
                <p className="rounded-md border border-border/60 bg-muted/40 p-2 text-muted-foreground">
                  Redeem is irreversible once confirmed: burned shares cannot be re-minted and the
                  pro-rata output is transferred immediately. LEGAL_REVIEW_REQUIRED — not
                  investment advice; xStocks are Backed Finance structured instruments with issuer
                  and depeg risk, and carry the basket&apos;s Token-2022 multiplier mechanics.
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  mono,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`${mono ? "font-mono tabular-nums" : ""} text-xl font-semibold tracking-tight`}>
          {value}
        </p>
        {sub ? <p className="font-mono text-[11px] text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

function FeeRow({ label, rate, cap }: { label: string; rate: number; cap: number }) {
  return (
    <TableRow>
      <TableCell className="pl-4 text-xs">{label}</TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">{formatBps(rate)}</TableCell>
      <TableCell className="pr-4 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {formatBps(cap)}
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
        {["NAV", "Share price", "Supply", "AUM"].map((label) => (
          <div key={label} className="rounded-lg border border-border bg-card p-5">
            <MetricCardSkeleton label={label} />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <ChartBlockSkeleton label="Loading NAV history" />
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <TableRowSkeleton rows={4} columns={5} label="Loading constituents" />
      </div>
    </div>
  );
}
