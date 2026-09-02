"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { EmptyState, ErrorState, FreshnessBadge } from "@/components/states";
import { Skeleton } from "@/components/states/skeleton";
import { tickerFromRow, type WhitelistRow } from "@/components/create/types";
import { cn } from "@/lib/utils";
import { StockCard } from "@/components/stocks/stock-card";

const API_BASE = process.env.NEXT_PUBLIC_API || "http://localhost:3001";
const CHART_RANGE = "1mo";

type GridStatus = "loading" | "error" | "empty" | "ready";

interface StockCardData {
  ticker: string;
  provider: string;
  /** Last token price (Jupiter reference) — null when the quote is unavailable. */
  price: number | null;
  /** 24h change in percent, from underlying equity daily closes. */
  changePct: number | null;
  /** Underlying equity daily closes for the mute sparkline (may be empty). */
  sparkline: number[];
}

interface ChartResult {
  closes: number[];
  lastTs?: number;
}

interface ComparePayload {
  data?: { ticker: string; jupiter: number | null }[];
}

interface ChartPayload {
  data?: {
    yahoo?: { candles?: { ts: number; close: number }[] | null } | null;
  } | null;
}

const filterButtonClasses = (active: boolean) =>
  cn(
    "inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
  );

/**
 * /stocks grid — fetches the instrument list (/api/v1/whitelist), the
 * ticker→provider mapping (/api/v1/providers registry), last token prices
 * (/api/v1/prices/compare) and underlying equity closes
 * (/api/v1/prices/chart) with the same endpoints the stock detail and
 * providers pages use. Provider filter is client-side over the fetched list.
 */
export function StocksGrid() {
  const [status, setStatus] = useState<GridStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cards, setCards] = useState<StockCardData[]>([]);
  const [whitelistSource, setWhitelistSource] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [meta, setMeta] = useState<{ hasPrice: boolean; hasChart: boolean; asOf?: number }>({
    hasPrice: false,
    hasChart: false,
  });

  const load = useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);
    setProviderFilter("all");
    try {
      const wlRes = await fetch(`${API_BASE}/api/v1/whitelist`, { cache: "no-store" });
      if (!wlRes.ok) {
        throw new Error(`GET /api/v1/whitelist responded ${wlRes.status}.`);
      }
      const wlPayload = (await wlRes.json()) as { data?: WhitelistRow[]; source?: string | null };
      const rows = Array.isArray(wlPayload.data) ? wlPayload.data : [];
      setWhitelistSource(wlPayload.source ?? "whitelist-api");

      const tickers = Array.from(
        new Set(rows.map(tickerFromRow).filter((t) => !t.includes("…"))),
      );
      if (tickers.length === 0) {
        setCards([]);
        setStatus("empty");
        return;
      }

      // Ticker → provider name from the source registry. Best effort: an
      // unreachable registry leaves the group as "Unmapped" rather than a guess.
      const providerByTicker = new Map<string, string>();
      try {
        const regRes = await fetch(`${API_BASE}/api/v1/providers`, { cache: "no-store" });
        if (regRes.ok) {
          const reg = (await regRes.json()) as {
            data?: { name: string; mints?: { ticker?: string }[] | null }[];
          };
          for (const p of reg.data ?? []) {
            for (const m of p.mints ?? []) {
              if (m.ticker) providerByTicker.set(m.ticker, p.name);
            }
          }
        }
      } catch {
        // Registry is optional metadata — never blocks the grid.
      }

      const [compareRows, charts] = await Promise.all([
        fetchCompare(tickers),
        Promise.all(tickers.map((t) => fetchChart(t))),
      ]);

      const priceByTicker = new Map(compareRows.map((r) => [r.ticker, r.jupiter]));
      let hasPrice = false;
      let hasChart = false;
      let asOf: number | undefined;

      const built: StockCardData[] = tickers.map((ticker, i) => {
        const chart = charts[i];
        const closes = chart.closes;
        if (chart.lastTs !== undefined && (asOf === undefined || chart.lastTs > asOf)) {
          asOf = chart.lastTs;
        }
        if (closes.length >= 2) hasChart = true;
        const price = priceByTicker.get(ticker) ?? null;
        if (price !== null) hasPrice = true;
        let changePct: number | null = null;
        if (closes.length >= 2 && closes[closes.length - 2] !== 0) {
          changePct =
            ((closes[closes.length - 1] - closes[closes.length - 2]) /
              closes[closes.length - 2]) *
            100;
        }
        return {
          ticker,
          provider: providerByTicker.get(ticker) ?? "Unmapped",
          price,
          changePct,
          sparkline: closes.slice(-30),
        };
      });

      built.sort(
        (a, b) => a.provider.localeCompare(b.provider) || a.ticker.localeCompare(b.ticker),
      );
      setCards(built);
      setStatus("ready");
      setMeta({ hasPrice, hasChart, asOf });
    } catch (error) {
      setCards([]);
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "The tokenized-stock endpoints did not respond.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const providers = useMemo(
    () => Array.from(new Set(cards.map((c) => c.provider))).sort((a, b) => a.localeCompare(b)),
    [cards],
  );
  const visible = useMemo(
    () =>
      providerFilter === "all" ? cards : cards.filter((c) => c.provider === providerFilter),
    [cards, providerFilter],
  );

  if (status === "loading") {
    return (
      <div
        role="status"
        aria-label="Loading tokenized stocks"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} aria-hidden="true" className="rounded-lg border border-border bg-card p-4">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-1.5 h-3 w-24" />
            <Skeleton className="mt-4 h-7 w-28" />
            <Skeleton className="mt-3 h-8 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (status === "error") {
    return (
      <ErrorState
        title="Tokenized stocks unavailable"
        message={errorMessage ?? undefined}
        onRetry={() => void load()}
      />
    );
  }

  if (status === "empty") {
    return (
      <EmptyState
        chip="EMPTY"
        title="No tokenized stocks listed"
        description="The whitelist is reachable but lists no priced instruments yet."
        action={
          <Link
            href="/providers"
            className="rounded-sm text-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Check data providers
          </Link>
        }
      />
    );
  }

  const badgeSource =
    [meta.hasPrice ? "Jupiter" : null, meta.hasChart ? "Yahoo Finance" : null]
      .filter(Boolean)
      .join(" · ") || whitelistSource || "whitelist";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {providers.length >= 2 ? (
          <nav aria-label="Filter by provider" className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Provider</span>
            <button
              type="button"
              aria-pressed={providerFilter === "all"}
              className={filterButtonClasses(providerFilter === "all")}
              onClick={() => setProviderFilter("all")}
            >
              All
            </button>
            {providers.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={providerFilter === p}
                className={filterButtonClasses(providerFilter === p)}
                onClick={() => setProviderFilter(p)}
              >
                {p}
              </button>
            ))}
          </nav>
        ) : (
          <span />
        )}
        <FreshnessBadge source={badgeSource} asOf={meta.hasChart ? meta.asOf : undefined} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((card) => (
          <StockCard
            key={card.ticker}
            ticker={card.ticker}
            provider={card.provider}
            price={card.price}
            changePct={card.changePct}
            sparkline={card.sparkline}
          />
        ))}
      </div>
    </div>
  );
}

async function fetchCompare(tickers: string[]): Promise<{ ticker: string; jupiter: number | null }[]> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/prices/compare?tickers=${encodeURIComponent(tickers.join(","))}`,
      { cache: "no-store", signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } },
    );
    if (!res.ok) return [];
    const payload = (await res.json()) as ComparePayload;
    return payload.data ?? [];
  } catch {
    return [];
  }
}

async function fetchChart(ticker: string): Promise<ChartResult> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/prices/chart?ticker=${encodeURIComponent(ticker)}&range=${CHART_RANGE}`,
      { cache: "no-store", signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } },
    );
    if (!res.ok) return { closes: [] };
    const payload = (await res.json()) as ChartPayload;
    const candles = payload.data?.yahoo?.candles ?? [];
    return {
      closes: candles.map((c) => c.close),
      lastTs: candles.length ? candles[candles.length - 1].ts : undefined,
    };
  } catch {
    return { closes: [] };
  }
}
