import type { Metadata } from "next";
import Link from "next/link";

import StockChart from "./StockChart";
import MintCopyButton from "./MintCopyButton";
import { FreshnessBadge } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RangeLinks } from "@/components/ui/range-links";
import { formatUsd } from "@/lib/format";

const API_BASE = process.env.NEXT_PUBLIC_API || "http://localhost:3001";

const RANGES = ["1mo", "3mo", "6mo", "1y"] as const;

interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartPayload {
  data?: {
    ticker?: string;
    mint?: string;
    yahoo?: { symbol?: string; candles?: Candle[] } | null;
    xStock?: { symbol?: string; candles?: Candle[] } | null;
    nasdaq?: { symbol?: string; candles?: Candle[] } | null;
  } | null;
}

interface ComparePayload {
  data?: {
    ticker: string;
    mint: string;
    jupiter: number | null;
    yahoo: number | null;
    diffBps: number | null;
  }[];
}

async function getChart(ticker: string, range: string): Promise<ChartPayload["data"]> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/prices/chart?ticker=${encodeURIComponent(ticker)}&range=${encodeURIComponent(range)}`,
      { cache: "no-store", signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } },
    );
    if (!res.ok) return null;
    const payload = (await res.json()) as ChartPayload;
    return payload.data ?? null;
  } catch {
    return null;
  }
}

async function getCompare(ticker: string) {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/prices/compare?tickers=${encodeURIComponent(ticker)}`,
      { cache: "no-store", signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } },
    );
    if (!res.ok) return null;
    const payload = (await res.json()) as ComparePayload;
    return payload.data?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const { ticker: rawTicker } = await params;
  const ticker = decodeURIComponent(rawTicker);
  return {
    title: `${ticker} — xStock vs real equity — FolioX`,
    description: `Normalized price comparison for ${ticker}: xStock token vs the real equity vs the Nasdaq benchmark, plus volume.`,
  };
}

export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams?: Promise<{ range?: string }>;
}) {
  const { ticker: rawTicker } = await params;
  const sp = (await searchParams) ?? {};
  const ticker = decodeURIComponent(rawTicker);
  const range = RANGES.includes(sp.range as (typeof RANGES)[number])
    ? (sp.range as (typeof RANGES)[number])
    : "1mo";

  const [chart, compare] = await Promise.all([getChart(ticker, range), getCompare(ticker)]);

  const yahooSymbol = chart?.yahoo?.symbol ?? ticker.replace(/^x/i, "");
  const yahooCandles = chart?.yahoo?.candles ?? [];
  const asOf = yahooCandles.length ? yahooCandles[yahooCandles.length - 1].ts : undefined;
  const hasChart = Boolean(
    chart && [chart.yahoo, chart.xStock, chart.nasdaq].some((s) => (s?.candles?.length ?? 0) >= 2),
  );

  const diffBps = compare?.diffBps ?? null;
  const depeg = diffBps !== null && Math.abs(diffBps) > 200;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-mono text-3xl font-semibold tracking-tight">{ticker}</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            xStock token vs the real equity ({yahooSymbol}) vs the Nasdaq benchmark. Chart data:{" "}
            <Link href="/providers" className="underline underline-offset-4 hover:text-foreground">
              Yahoo Finance + Jupiter
            </Link>
            .
          </p>
        </div>
        <FreshnessBadge source="Yahoo Finance" asOf={asOf} />
      </div>

      <RangeLinks
        options={RANGES}
        value={range}
        hrefFor={(r) => `/stock/${ticker}?range=${r}`}
      >
        <Button render={<Link href="/market" />} variant="outline" size="xs" className="ml-2">
          Market overview
        </Button>
      </RangeLinks>

      {compare ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardAction>
                {compare.mint ? <MintCopyButton value={compare.mint} /> : null}
              </CardAction>
              <CardDescription>xStock (Jupiter)</CardDescription>
              <CardTitle className="font-mono text-2xl tabular-nums">
                {compare.jupiter !== null ? formatUsd(compare.jupiter) : "—"}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardDescription>Real ({yahooSymbol} · Yahoo)</CardDescription>
              <CardTitle className="font-mono text-2xl tabular-nums">
                {compare.yahoo !== null ? formatUsd(compare.yahoo) : "—"}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardDescription>Token vs equity</CardDescription>
              <CardTitle
                className={`font-mono text-2xl tabular-nums ${
                  diffBps === null
                    ? ""
                    : depeg
                      ? "text-muted-foreground"
                      : diffBps >= 0
                        ? "text-foreground"
                        : "text-destructive"
                }`}
              >
                {diffBps !== null ? `${(diffBps / 100).toFixed(2)}%` : "—"}
              </CardTitle>
              <CardDescription className="flex items-center gap-2">
                {diffBps === null ? (
                  <span>Difference not computable</span>
                ) : depeg ? (
                  <Badge
                    variant="outline"
                    className="border-border/60 text-muted-foreground"
                  >
                    Depeg &gt; 2%
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-border/60 text-foreground"
                  >
                    Aligned
                  </Badge>
                )}
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Price comparison — {range} (normalized 100)</CardTitle>
          <CardDescription className="text-xs leading-relaxed">
            xStock token (simulated in V0) · real equity · Nasdaq QQQ (dashed).
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-[380px]">
          {hasChart ? (
            <StockChart data={chart as NonNullable<ChartPayload["data"]>} />
          ) : (
            <p className="text-sm text-muted-foreground">
              No chart series available for this ticker and range. The backend may be unreachable or
              Yahoo returned no candles — retry another range.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-1 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
        <p>
          The xStock series is simulated in V0 (jitter around the Yahoo close) and is replaced by
          real Jupiter snapshots once the indexer stores them.
        </p>
        <p>
          LEGAL_REVIEW_REQUIRED: xStocks are Backed Finance structured instruments — holders carry
          issuer and depeg risk, and the token is not the underlying share.
        </p>
      </div>

    </div>
  );
}
