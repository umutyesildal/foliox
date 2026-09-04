"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { EmptyState, FreshnessBadge } from "@/components/states";
import { Skeleton } from "@/components/states/skeleton";
import { cn } from "@/lib/utils";
import { StockCard } from "@/components/stocks/stock-card";
import {
  MOCK_XSTOCK_FALLBACK,
  fetchMockXStockCatalog,
  type MockCatalogEntry,
} from "@/lib/xstock-catalog";

/**
 * Where the grid's rows came from — shown verbatim in the freshness badge:
 *  - "catalog": the backend dev catalog (/api/v1/xstocks/mock, 12 mock
 *    xStocks with deterministic dev-catalog prices, explicitly not live);
 *  - "static": the built-in ticker list with no prices, used only when the
 *    API is unreachable.
 */
type DataSource = "catalog" | "static";

type GridStatus = "loading" | "error" | "empty" | "ready";

interface StockCardData {
  ticker: string;
  provider: string;
  /** Dev-catalog USD price — null renders an em dash, never a guess. */
  price: number | null;
  /** 24h change: the dev catalog carries no series, so always null today. */
  changePct: number | null;
  /** Dev catalog has no history — empty renders the mute baseline. */
  sparkline: number[];
}

const filterButtonClasses = (active: boolean) =>
  cn(
    // 40px tall on phones (touch), back to the compact 32px from sm up.
    "inline-flex h-8 max-md:h-10 items-center rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
  );

const SOURCE_BADGE: Record<DataSource, string> = {
  catalog: "dev catalog · mock prices (not live)",
  static: "static dev list — API unreachable",
};

/**
 * /stocks grid — renders N tokenized stocks from the backend dev catalog
 * (GET /api/v1/xstocks/mock — the 12-stock mock xStock universe). When the
 * API is unreachable it degrades to the built-in static ticker list with no
 * prices, labeled "static dev list — API unreachable". The grid wraps at any
 * N (1/2/3/4 responsive columns); nothing assumes a fixed count.
 */
export function StocksGrid() {
  const [status, setStatus] = useState<GridStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cards, setCards] = useState<StockCardData[]>([]);
  const [dataSource, setDataSource] = useState<DataSource>("catalog");
  const [providerFilter, setProviderFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);
    setProviderFilter("all");
    try {
      const catalog = await fetchMockXStockCatalog();
      let entries: MockCatalogEntry[];
      if (catalog) {
        entries = catalog;
        setDataSource("catalog");
      } else {
        // Backend unreachable (or empty payload) — static ticker list, no prices.
        entries = [...MOCK_XSTOCK_FALLBACK];
        setDataSource("static");
      }

      if (entries.length === 0) {
        setCards([]);
        setStatus("empty");
        return;
      }

      setCards(
        entries.map((entry) => ({
          ticker: entry.ticker,
          provider:
            entry.priceUsd !== null ? "mock xStock · dev catalog" : "static dev list",
          price: entry.priceUsd,
          changePct: null,
          sparkline: [],
        })),
      );
      setStatus("ready");
    } catch (error) {
      setCards([]);
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "The stock catalog did not respond.",
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
          <div key={i} aria-hidden="true" className="rounded-lg border border-border bg-card p-5">
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
      <EmptyState
        chip="UNAVAILABLE"
        title="Tokenized stocks unavailable"
        description={errorMessage ?? "The dev catalog did not respond."}
      />
    );
  }

  if (status === "empty") {
    return (
      <EmptyState
        chip="EMPTY"
        title="No tokenized stocks listed"
        description="The dev catalog responded but lists no instruments yet."
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
        <FreshnessBadge source={SOURCE_BADGE[dataSource]} />
      </div>

      {/* data-source/data-count make the grid's provenance assertable in DOM checks. */}
      <div
        data-source={dataSource}
        data-count={visible.length}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
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
