import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EtfGrid, EtfGridSkeleton, type EtfRow } from "@/components/etfs/etf-grid";
import { EmptyState, FreshnessBadge } from "@/components/states";

export const metadata: Metadata = {
  title: "Tokenized ETFs — FolioX",
  description: "The tokenized ETF tickers listed on FolioX today.",
};

const API_BASE = process.env.NEXT_PUBLIC_API || "http://localhost:3001";

/**
 * Display metadata for xStock registry tickers that are tokenized ETFs (fund
 * trackers) rather than single-stock tokens. Configuration, not live data —
 * the backend registry carries no asset-class field yet, so new ETF tickers
 * are added here when they ship. Anything not in this map is filtered out.
 */
const ETF_META: Record<string, { name: string }> = {
  SPYx: { name: "S&P 500 index tracker" },
};

interface XStockRow {
  ticker: string;
  mint?: string;
  yahooSymbol?: string;
  provider?: string;
  status?: string;
}

interface CompareRow {
  ticker: string;
  jupiter: number | null;
}

interface ComparePayload {
  data?: CompareRow[];
  ts?: string;
}

interface ChartPayload {
  data?: {
    yahoo?: { symbol?: string; candles?: { ts: number; close: number }[] } | null;
  } | null;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Listing body: fetch the instrument registry, keep only ETF-type tickers,
 * attach the live token price (Jupiter) and the 24h change (Yahoo daily
 * close-to-close — never the simulated xStock series). Renders its own header
 * so the FreshnessBadge only appears once real metadata exists.
 */
async function EtfListing() {
  const xstocksRes = await getJson<{ data?: XStockRow[] }>("/api/v1/xstocks");

  if (xstocksRes?.data == null) {
    return (
      <EmptyState
        chip="API UNREACHABLE"
        title="Instrument list unavailable"
        description="/api/v1/xstocks could not be reached, so no listing can be shown right now."
        action={
          <Link
            href="/providers"
            className="text-xs underline underline-offset-4 hover:text-foreground"
          >
            Check provider status
          </Link>
        }
      />
    );
  }

  const listed = xstocksRes.data.filter((row) => ETF_META[row.ticker] !== undefined);

  if (listed.length === 0) {
    return (
      <EmptyState
        chip="EMPTY"
        title="No tokenized ETFs listed yet"
        description="The instrument registry currently lists no ETF-type tickers. Single-stock tokens are not shown here."
        action={
          <Link
            href="/providers"
            className="text-xs underline underline-offset-4 hover:text-foreground"
          >
            View instrument registry
          </Link>
        }
      />
    );
  }

  const tickers = listed.map((row) => row.ticker).join(",");
  const [compareRes, ...chartRes] = await Promise.all([
    getJson<ComparePayload>(`/api/v1/prices/compare?tickers=${encodeURIComponent(tickers)}`),
    ...listed.map((row) =>
      getJson<ChartPayload>(
        `/api/v1/prices/chart?ticker=${encodeURIComponent(row.ticker)}&range=1mo`,
      ),
    ),
  ]);

  const priceByTicker = new Map((compareRes?.data ?? []).map((c) => [c.ticker, c.jupiter]));

  const rows: EtfRow[] = listed.map((row, i) => {
    // Yahoo daily closes only — the xStock series is simulated and never quoted.
    const candles = chartRes[i]?.data?.yahoo?.candles ?? [];
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const change24h =
      last && prev && prev.close !== 0 ? ((last.close - prev.close) / prev.close) * 100 : null;
    return {
      ticker: row.ticker,
      name: ETF_META[row.ticker]?.name,
      provider: row.provider,
      price: priceByTicker.get(row.ticker) ?? null,
      change24h,
    };
  });

  const chartAsOf = chartRes
    .map((res) => res?.data?.yahoo?.candles?.[res.data.yahoo.candles.length - 1]?.ts ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);
  const compareTs = compareRes?.ts ? Date.parse(compareRes.ts) : 0;
  const asOf = Math.max(chartAsOf, compareTs) || undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="tokenized-etfs" className="text-sm font-medium tracking-tight">
          Tokenized ETFs on FolioX
        </h2>
        <FreshnessBadge source="Jupiter · Yahoo Finance" asOf={asOf} />
      </div>
      <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
        Token prices are Jupiter quotes for the token; 24h change is the Yahoo daily
        close-to-close for the underlying ETF.
      </p>
      <EtfGrid rows={rows} />
    </div>
  );
}

export default function EtfsPage() {
  return (
    <div>
      <header className="pb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Tokenized ETFs</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          The tokenized ETF tickers FolioX lists today.
        </p>
      </header>

      {/* Live listing, right under the intro; streams after the fetches resolve.
          The Traditional vs tokenized comparison lives on the home landing now. */}
      <section aria-label="Tokenized ETFs on FolioX" className="border-t border-border py-8">
        <Suspense fallback={<EtfGridSkeleton />}>
          <EtfListing />
        </Suspense>
      </section>
    </div>
  );
}
