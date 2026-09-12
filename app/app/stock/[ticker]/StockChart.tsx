"use client";

import { Area, AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import type { TooltipRow } from "@/components/charts/tooltip/tooltip-content";
import { Badge } from "@/components/ui/badge";

interface Candle {
  ts: number;
  close: number;
}

export interface StockChartSeries {
  ticker: string;
  yahooSymbol: string;
}

interface StockChartProps {
  /** Backend /api/v1/prices/chart payload: xStock + real equity + Nasdaq benchmark. */
  data: {
    yahoo?: { symbol?: string; candles?: Candle[] } | null;
    xStock?: { symbol?: string; candles?: Candle[] } | null;
    nasdaq?: { symbol?: string; candles?: Candle[] } | null;
  };
}

function normalize(candles: Candle[] | undefined): { ts: number; v: number }[] {
  if (!candles || candles.length === 0) return [];
  const base = candles[0].close || 1;
  return candles.map((c) => ({ ts: c.ts, v: (c.close / base) * 100 }));
}

/**
 * Chart data colors per the NEON FOUNDRY spec — data palette tokens only
 * (chart-1 yellow = xStock token simulated in V0, chart-2 cyan = real
 * equity), Nasdaq benchmark = muted gray (dashed, never a chart hue).
 * Legend order matches the Area render order below.
 */
const SERIES = [
  { key: "xStock", label: "xStock (simulated)", color: "hsl(var(--chart-1))" },
  { key: "real", label: "Real equity", color: "hsl(var(--chart-2))" },
  { key: "nasdaq", label: "Nasdaq QQQ", color: "hsl(var(--muted-foreground))" },
] as const;

/** Tooltip rows: date comes from the tooltip title; values 2dp index points. */
function tooltipRows(point: Record<string, unknown>): TooltipRow[] {
  return SERIES.map((s) => {
    const value = point[s.key];
    return {
      color: s.color,
      label: s.label,
      value: typeof value === "number" ? value.toFixed(2) : "—",
    };
  });
}

/**
 * Three-series normalized-to-100 comparison: xStock token, the real equity,
 * and the Nasdaq benchmark (gray, dashed). One clean full-range chart — no
 * brush, no volume strip; y-scale fits the whole window via fitYDomain.
 */
export default function StockChart({ data }: StockChartProps) {
  const yahooNorm = normalize(data.yahoo?.candles);
  const xStockNorm = normalize(data.xStock?.candles);
  const nasdaqNorm = normalize(data.nasdaq?.candles);

  const len = Math.max(yahooNorm.length, xStockNorm.length, nasdaqNorm.length);
  const rows = Array.from({ length: len }, (_, i) => ({
    date: new Date(
      yahooNorm[i]?.ts ?? xStockNorm[i]?.ts ?? nasdaqNorm[i]?.ts ?? Date.now() + i * 86_400_000,
    ),
    xStock: xStockNorm[i]?.v ?? null,
    real: yahooNorm[i]?.v ?? null,
    nasdaq: nasdaqNorm[i]?.v ?? null,
  })).filter((r) => r.xStock !== null || r.real !== null || r.nasdaq !== null);

  if (rows.length < 2) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No chart data for this ticker and range.
      </div>
    );
  }

  const rowsForChart = rows as unknown as Record<string, unknown>[];

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {SERIES.map((s) => (
          <Badge
            key={s.key}
            variant="outline"
            className="inline-flex items-center gap-1.5 bg-card px-2 py-0 font-mono text-[11px] font-medium"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                background: s.color,
                border: s.key === "nasdaq" ? `1px dashed ${s.color}` : undefined,
              }}
            />
            {s.label}
            {s.key === "nasdaq" ? (
              <span className="text-[10px] font-sans text-muted-foreground">dashed</span>
            ) : null}
          </Badge>
        ))}
        <span className="text-xs text-muted-foreground">Normalized to 100 at the start of the window.</span>
      </div>

      <div className="min-h-[320px] flex-1">
        <AreaChart
          data={rowsForChart}
          xDataKey="date"
          fitYDomain
          margin={{ top: 12, right: 12, bottom: 24, left: 48 }}
          className="h-full w-full"
        >
          {/* B1: faint solid gridline at the 100 base; primary fill ≤6% alpha
              fading to 0 by ~40% height; secondary/benchmark line-only. Soft
              1.5px strokes for the ethereal look. */}
          <Grid
            horizontal
            highlightRowValues={[100]}
            highlightRowStroke="hsl(var(--chart-grid))"
            highlightRowStrokeDasharray="0"
            highlightRowStrokeWidth={1}
          />
          {SERIES.map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              fill={s.color}
              stroke={s.color}
              fillOpacity={s.key === "xStock" ? 0.06 : 0}
              gradientSpan={s.key === "xStock" ? 0.4 : undefined}
              strokeWidth={1.5}
              dashFromIndex={s.key === "nasdaq" ? 0 : undefined}
              dashArray={s.key === "nasdaq" ? "6 4" : undefined}
            />
          ))}
          <XAxis numTicks={5} />
          <YAxis numTicks={5} formatValue={(value) => value.toFixed(0)} />
          <ChartTooltip rows={tooltipRows} />
        </AreaChart>
      </div>
    </div>
  );
}
