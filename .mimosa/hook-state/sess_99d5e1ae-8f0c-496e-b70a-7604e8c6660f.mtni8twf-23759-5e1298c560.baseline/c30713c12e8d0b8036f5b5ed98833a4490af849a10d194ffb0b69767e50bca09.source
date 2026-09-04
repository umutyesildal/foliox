"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { fetchMockXStockCatalog } from "@/lib/xstock-catalog";
import { apiFetch } from "@/lib/api-client";

/**
 * Closing strip — takes over the deleted bento's navigation role with one
 * hairline-divided row of three cells: STOCKS (the dev catalog tickers —
 * GET /api/v1/xstocks/mock, falling back to the xStocks registry),
 * TOKENIZED ETFS (SPYx), BASKETS. Each cell links; its ↗
 * lifts and warms to pompeian red on hover. Nothing renders in the ticker
 * line when the backend is unreachable (no fabricated tickers) — and no
 * endpoint/as-of text is shown.
 */

const CELLS = [
  { label: "Stocks", href: "/stocks", line: (tickers: string | null) => tickers },
  { label: "Tokenized ETFs", href: "/etfs", line: () => "SPYx" },
  { label: "Baskets", href: "/explore", line: () => "Weighted on-chain" },
] as const;

/** How many registry tickers to show before ellipsizing. */
const MAX_TICKERS = 6;

export function ClosingStrip() {
  const [tickers, setTickers] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    // Dev catalog first (the 12 mock xStocks the devnet demo actually lists),
    // then the live xStocks registry as fallback.
    const loadTickers = async () => {
      const catalog = await fetchMockXStockCatalog();
      if (catalog) return catalog.map((entry) => entry.ticker);
      const res = await apiFetch("/api/v1/xstocks", {
        cache: "no-store",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: { ticker: string }[] } | null;
      const rows = json?.data;
      if (!rows?.length) return null;
      return rows.map((r) => r.ticker).filter(Boolean);
    };
    loadTickers()
      .then((names) => {
        if (!names?.length) return;
        const shown =
          names.length > MAX_TICKERS
            ? `${names.slice(0, MAX_TICKERS).join(" ")} …`
            : names.join(" ");
        setTickers(shown);
      })
      .catch(() => null)
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  return (
    <section aria-label="Explore FolioX" className="border-t border-border dark:border-border/60">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {CELLS.map((cell) => (
            <Link
              key={cell.href}
              href={cell.href}
              className="group flex items-center justify-between gap-4 py-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:flex-col sm:items-start sm:justify-start sm:gap-3 sm:px-6 sm:first:pl-0 sm:last:pr-0"
            >
              <span className="section-label">{cell.label}</span>
              <span className="text-sm leading-5 text-foreground">
                {cell.line(tickers) ?? ""}
              </span>
              <span
                aria-hidden="true"
                className="font-mono text-sm text-muted-foreground transition-all duration-200 group-hover:-translate-y-0.5 group-hover:text-[hsl(var(--pompeian))] motion-reduce:transform-none motion-reduce:transition-none"
              >
                ↗
              </span>
            </Link>
          ))}
        </div>
        <div className="pb-8" />
      </div>
    </section>
  );
}
