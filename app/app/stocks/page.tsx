import type { Metadata } from "next";

import { StocksGrid } from "@/components/stocks/stocks-grid";

export const metadata: Metadata = {
  title: "Stocks — FolioX",
  description:
    "Tokenized stocks across providers — last token price, 24h change and the underlying equity series, grouped by provider.",
};

export default function StocksPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-3xl font-semibold tracking-tight">Stocks</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Tokenized stocks across providers — the building blocks for custom baskets.
        </p>
      </header>

      <StocksGrid />

      <p className="border-t border-border/60 pt-3 text-xs leading-5 text-muted-foreground">
        Token price: Jupiter · 24h change and sparkline: underlying equity daily closes (Yahoo).
        Cards open the per-token comparison.
      </p>

    </div>
  );
}
