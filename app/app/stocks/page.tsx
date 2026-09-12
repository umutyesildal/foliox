import type { Metadata } from "next";

import { StocksGrid } from "@/components/stocks/stocks-grid";

export const metadata: Metadata = {
  title: "Stocks — Basalt",
  description:
    "The mock xStock dev catalog — 12 tokenized stocks with dev-catalog prices, the building blocks for custom baskets.",
};

export default function StocksPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-semibold">Stocks</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          The mock xStock dev catalog — the building blocks for custom baskets.
        </p>
      </header>

      <StocksGrid />

      <p className="border-t border-border/60 pt-3 text-xs leading-5 text-muted-foreground">
        Devnet showcase: prices come from the backend dev catalog (mock — not live market
        data). When the API is unreachable the grid falls back to a static ticker list
        without prices. Cards open the per-token page.
      </p>

    </div>
  );
}
