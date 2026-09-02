import Link from "next/link";

import { formatUsd } from "@/lib/format";
import { ChangeValue } from "@/components/stocks/change-value";

/**
 * One tokenized stock in the /stocks grid — Ondo-market-style compact card:
 * ticker + provider, last token price (Jupiter), 24h change colored via the
 * chart data tokens (green up / red down — per user decision; the rest of the
 * card stays monochrome), and a mute sparkline of underlying equity closes.
 */
export function StockCard({
  ticker,
  provider,
  price,
  changePct,
  sparkline,
}: {
  ticker: string;
  provider: string;
  /** Last token price (Jupiter) — null renders an em dash, never a guess. */
  price: number | null;
  /** 24h change in percent from underlying equity closes — null renders em dash. */
  changePct: number | null;
  /** Underlying equity daily closes, oldest → newest (may be empty). */
  sparkline: number[];
}) {
  return (
    <Link
      href={`/stock/${encodeURIComponent(ticker)}`}
      className="group flex flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold tracking-tight text-foreground">{ticker}</span>
        <ChangeValue changePct={changePct} />
      </div>
      <span className="mt-0.5 text-xs text-muted-foreground">{provider}</span>
      <span className="mt-4 font-mono text-2xl tabular-nums text-foreground">
        {price !== null ? formatUsd(price) : "—"}
      </span>
      <MiniSparkline points={sparkline} />
    </Link>
  );
}

/** Mute inline SVG sparkline — currentColor at low emphasis, no gradient, no axes. */
function MiniSparkline({ points }: { points: number[] }) {
  if (points.length < 2) {
    return <div aria-hidden="true" className="mt-3 h-8 border-b border-border/40" />;
  }
  const width = 120;
  const height = 32;
  const pad = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = (width - pad * 2) / (points.length - 1);
  const path = points
    .map((value, i) => {
      const x = pad + i * step;
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="mt-3 h-8 w-full text-muted-foreground/50"
    >
      <polyline
        points={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
