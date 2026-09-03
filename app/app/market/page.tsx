import type { Metadata } from "next";
import Link from "next/link";

import MarketChart, { type MarketSeriesMeta } from "./market-chart";
import { FreshnessBadge } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Market overview — FolioX",
  description:
    "QQQ, SPY, DIA and the Nasdaq Composite normalized to 100, with a 30-candle benchmark volume view.",
};

const API_BASE = process.env.NEXT_PUBLIC_API || "http://localhost:3001";

const RANGES = ["1mo", "3mo", "6mo", "1y"] as const;

interface YahooCandle {
  ts: number;
  close: number;
  volume: number;
}

interface OverviewSeries {
  symbol: string;
  first: number;
  last: number;
  changePct: number;
  candles: YahooCandle[];
  count: number;
}

interface OverviewPayload {
  data?: OverviewSeries[];
  range?: string;
}

// Chart data colors per user decision — distinct hues per index; the
// benchmark (^IXIC) stays gray (muted-foreground) and is rendered dashed.
const SERIES_COLORS: Record<string, string> = {
  QQQ: "hsl(var(--chart-1))",
  SPY: "hsl(var(--chart-2))",
  DIA: "hsl(var(--chart-4))",
  IXIC: "hsl(var(--muted-foreground))",
};

const SERIES_LABELS: Record<string, string> = {
  QQQ: "QQQ (Invesco Nasdaq 100)",
  SPY: "SPY (SPDR S&P 500)",
  DIA: "DIA (SPDR Dow Jones)",
  IXIC: "^IXIC (Nasdaq Composite, benchmark)",
};

async function getOverview(range: string): Promise<OverviewPayload | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/market/overview?range=${encodeURIComponent(range)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as OverviewPayload;
  } catch {
    return null;
  }
}

/** Deterministic stand-in used only when the API is unreachable — always labeled demo. */
function fixtureRows(): Record<string, unknown>[] {
  const shape: Record<string, { slope: number; amp: number; phase: number }> = {
    QQQ: { slope: 6, amp: 1.2, phase: 0 },
    SPY: { slope: 4.5, amp: 1.0, phase: 1 },
    DIA: { slope: 2.2, amp: 0.6, phase: 2 },
    IXIC: { slope: 8.5, amp: 1.6, phase: 0.5 },
  };
  return Array.from({ length: 30 }, (_, i) => {
    const row: Record<string, unknown> = {
      date: new Date(Date.UTC(2026, 6, 30) + i * 86_400_000),
    };
    for (const [key, s] of Object.entries(shape)) {
      const t = i / 29;
      row[key] = Number((100 + s.slope * t + s.amp * Math.sin(i / 3 + s.phase)).toFixed(2));
    }
    return row;
  });
}

function fixtureVolume(): { date: Date; volume: number }[] {
  return Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 6, 30) + i * 86_400_000),
    volume: Math.round((6_200_000 + 1_800_000 * Math.sin(i / 2.6) + 900_000 * Math.cos(i / 1.3)) / 10_000) * 10_000,
  }));
}

function buildNormalizedRows(data: OverviewSeries[]): {
  rows: Record<string, unknown>[];
  series: MarketSeriesMeta[];
} {
  const usable = data
    .map((o) => {
      const key = o.symbol === "^IXIC" ? "IXIC" : o.symbol;
      return { ...o, key };
    })
    .filter((o) => SERIES_COLORS[o.key] !== undefined && (o.candles?.length ?? 0) >= 2);

  const len = Math.min(...usable.map((o) => o.candles.length));
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < len; i++) {
    const row: Record<string, unknown> = { date: new Date(usable[0].candles[i].ts) };
    for (const o of usable) {
      const base = o.candles[0].close || 1;
      row[o.key] = Number(((o.candles[i].close / base) * 100).toFixed(2));
    }
    rows.push(row);
  }

  // Benchmark (^IXIC) last, so it maps to the dashed gray series.
  usable.sort((a, b) => (a.key === "IXIC" ? 1 : b.key === "IXIC" ? -1 : 0));
  const series: MarketSeriesMeta[] = usable.map((o) => ({
    key: o.key,
    label: SERIES_LABELS[o.key] ?? o.key,
    color: SERIES_COLORS[o.key],
    dashed: o.key === "IXIC",
    // Ochre never appears as an area fill (B1) — DIA stays line-only.
    lineOnly: o.key === "DIA",
  }));

  return { rows, series };
}

function StatChip({ label, change }: { label: string; change: number }) {
  const positive = change >= 0;
  return (
    <span className="inline-flex items-baseline gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-mono tabular-nums ${
          positive ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {positive ? "+" : ""}
        {change.toFixed(2)}%
      </span>
    </span>
  );
}

export default async function MarketPage({
  searchParams,
}: {
  searchParams?: Promise<{ range?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const range = RANGES.includes(sp.range as (typeof RANGES)[number]) ? (sp.range as string) : "1mo";
  const payload = await getOverview(range);

  const liveSeries = payload?.data ?? [];
  const hasLive = liveSeries.some((o) => (o.candles?.length ?? 0) >= 2);

  let rows: Record<string, unknown>[];
  let series: MarketSeriesMeta[];
  let volume: { date: Date; volume: number }[];
  let volumeLabel: string;
  let asOf: number | undefined;
  let changes: { label: string; change: number }[];

  if (hasLive) {
    const built = buildNormalizedRows(liveSeries);
    rows = built.rows;
    series = built.series;
    const benchmark =
      liveSeries.find((o) => o.symbol === "^IXIC" && (o.candles?.length ?? 0) >= 2) ??
      liveSeries.find((o) => (o.candles?.length ?? 0) >= 2);
    volume = (benchmark?.candles ?? []).slice(-30).map((c) => ({ date: new Date(c.ts), volume: c.volume }));
    volumeLabel = benchmark ? (benchmark.symbol === "^IXIC" ? "^IXIC" : benchmark.symbol) : "Benchmark";
    asOf = Math.max(...liveSeries.map((o) => o.candles[o.candles.length - 1]?.ts ?? 0));
    changes = liveSeries
      .filter((o) => (o.candles?.length ?? 0) >= 2)
      .map((o) => ({ label: o.symbol === "^IXIC" ? "^IXIC" : o.symbol, change: o.changePct }));
  } else {
    rows = fixtureRows();
    series = ["QQQ", "SPY", "DIA", "IXIC"].map((key) => ({
      key,
      label: SERIES_LABELS[key],
      color: SERIES_COLORS[key],
      dashed: key === "IXIC",
      lineOnly: key === "DIA",
    }));
    volume = fixtureVolume();
    volumeLabel = "^IXIC (fixture)";
    asOf = Date.UTC(2026, 7, 28);
    changes = series.map((s) => {
      const values = rows.map((r) => Number(r[s.key]));
      const change = (values[values.length - 1] ?? 100) - 100;
      return { label: s.key, change };
    });
  }

  const demo = !hasLive;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">Market overview</h1>
          <p className="max-w-2xl text-sm leading-6 text-foreground/80">
            Nasdaq benchmarks normalized to 100 — the base for comparing xStocks-backed strategy
            baskets against the underlying equity indices.
          </p>
        </div>
        <FreshnessBadge
          source={demo ? "fixture" : "Yahoo Finance"}
          asOf={asOf}
          demo={demo}
        />
      </div>

      <nav aria-label="Chart range" className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">Range</span>
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`/market?range=${r}`}
            aria-current={r === range ? "true" : undefined}
            className={`inline-flex min-h-9 items-center rounded-md px-2.5 text-xs transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
              r === range
                ? "font-medium text-foreground underline decoration-foreground/40 underline-offset-4"
                : "text-muted-foreground"
            }`}
          >
            {r}
          </Link>
        ))}
      </nav>

      {demo ? (
        <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          The market API is unreachable, so this view renders a static fixture. It is labeled demo
          and must not be read as live index data.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {changes.map((c) => (
          <StatChip key={c.label} label={c.label} change={c.change} />
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Normalized comparison — 100 base</CardTitle>
        </CardHeader>
        <CardContent>
          <MarketChart rows={rows} series={series} volume={volume} volumeLabel={volumeLabel} />
          <p className="mt-4 border-t border-border/60 pt-3 text-xs leading-5 text-muted-foreground">
            Four index series over {range}; the benchmark is dashed, shown at full range.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Source: Yahoo Finance (30-minute cache on the backend). xStock token prices come from
          Jupiter; the difference to the real equity is the depeg.
        </span>
        <Button render={<Link href="/providers" />} variant="outline" size="xs">
          Data providers
        </Button>
      </div>

    </div>
  );
}
