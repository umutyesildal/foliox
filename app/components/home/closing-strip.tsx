"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { FreshnessBadge } from "@/components/states";

/**
 * Closing strip — takes over the deleted bento's navigation role with one
 * hairline-divided row of three cells: STOCKS (live tickers from the real
 * GET /api/v1/xstocks registry), TOKENIZED ETFS (SPYx), BASKETS. Each cell
 * links; its ↗ lifts and warms to pompeian red on hover. A FreshnessBadge
 * carries the as-of of the registry fetch — nothing renders when the backend
 * is unreachable (no fabricated tickers, no fake timestamps).
 */

const API_BASE = process.env.NEXT_PUBLIC_API || "http://localhost:3001";

const CELLS = [
  { label: "Stocks", href: "/stocks", line: (tickers: string | null) => tickers },
  { label: "Tokenized ETFs", href: "/etfs", line: () => "SPYx" },
  { label: "Baskets", href: "/explore", line: () => "Weighted on-chain" },
] as const;

/** How many registry tickers to show before ellipsizing. */
const MAX_TICKERS = 6;

export function ClosingStrip() {
  const [tickers, setTickers] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<Date | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    fetch(`${API_BASE}/api/v1/xstocks`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data?: { ticker: string }[] } | null) => {
        const rows = json?.data;
        if (!rows?.length) return;
        const names = rows.map((r) => r.ticker).filter(Boolean);
        if (!names.length) return;
        const shown =
          names.length > MAX_TICKERS
            ? `${names.slice(0, MAX_TICKERS).join(" ")} …`
            : names.join(" ");
        setTickers(shown);
        setAsOf(new Date());
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
              <span className="font-[family-name:var(--font-display)] text-xs font-medium tracking-[0.18em] text-muted-foreground">
                {cell.label}
              </span>
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
        {/* as-of of the registry fetch — only when it actually succeeded. */}
        <div className="flex justify-center pb-8 sm:justify-end">
          {tickers && asOf ? (
            <FreshnessBadge source="GET /api/v1/xstocks" asOf={asOf} />
          ) : null}
        </div>
      </div>
    </section>
  );
}
