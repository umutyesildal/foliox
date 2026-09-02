"use client";

import { Area, AreaChart } from "@/components/charts/area-chart";
import { ChartBrush, ChartBrushLayout } from "@/components/charts/chart-brush";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
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
 * Three-series normalized-to-100 comparison: xStock (blue, simulated in V0),
 * the real equity (green), and the Nasdaq benchmark (gray, dashed). xDomain
 * zoom uses the local Brush adapter implementing the documented Bklit
 * ChartBrush/ChartBrushLayout API (not official registry source).
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
        <Badge
          variant="outline"
          className="inline-flex items-center gap-1.5 bg-card px-2 py-0 font-mono text-[11px] font-medium"
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "hsl(var(--chart-1))" }} />
          xStock (simulated)
        </Badge>
        <Badge
          variant="outline"
          className="inline-flex items-center gap-1.5 bg-card px-2 py-0 font-mono text-[11px] font-medium"
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "hsl(var(--chart-2))" }} />
          Real equity
        </Badge>
        <Badge
          variant="outline"
          className="inline-flex items-center gap-1.5 bg-card px-2 py-0 font-mono text-[11px] font-medium"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: "hsl(var(--chart-3))", border: "1px dashed hsl(var(--chart-3))" }}
          />
          Nasdaq QQQ
          <span className="text-[10px] font-sans text-muted-foreground">dashed</span>
        </Badge>
        <span className="text-xs text-muted-foreground">Normalized to 100 at the start of the window.</span>
      </div>

      <div className="min-h-[260px] flex-1">
        <ChartBrushLayout
          data={rowsForChart}
          xDataKey="date"
          enabled
          height={56}
          brushStrip={(layout) => (
            <AreaChart
              data={rowsForChart}
              xDataKey="date"
              style={{ height: 56 }}
              margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
              className="h-full"
            >
              <Area
                dataKey="real"
                fill="hsl(var(--chart-2))"
                stroke="hsl(var(--chart-2))"
                fillOpacity={0}
                strokeWidth={1}
              />
              <ChartBrush
                initialSelection={layout.brushSelection ?? undefined}
                onSelectionChange={layout.onBrushSelectionChange}
              />
            </AreaChart>
          )}
        >
          {(layout) => (
            <AreaChart
              data={rowsForChart}
              xDataKey="date"
              xDomain={layout.xDomain}
              xDomainSlotCount={layout.xDomainSlotCount}
              tweenYDomainOnXDomainChange
              margin={{ top: 12, right: 12, bottom: 24, left: 48 }}
              className="h-full w-full"
            >
              {/* B1: faint solid gridline at the 100 base; primary fill ≤6% alpha
                  fading to 0 by ~40% height; secondary/benchmark line-only. */}
              <Grid
                horizontal
                highlightRowValues={[100]}
                highlightRowStroke="hsl(var(--chart-grid))"
                highlightRowStrokeDasharray="0"
                highlightRowStrokeWidth={1}
              />
              <Area
                dataKey="xStock"
                fill="hsl(var(--chart-1))"
                stroke="hsl(var(--chart-1))"
                fillOpacity={0.06}
                gradientSpan={0.4}
                strokeWidth={2}
              />
              <Area
                dataKey="real"
                fill="hsl(var(--chart-2))"
                stroke="hsl(var(--chart-2))"
                fillOpacity={0}
                strokeWidth={2}
              />
              <Area
                dataKey="nasdaq"
                fill="hsl(var(--chart-3))"
                stroke="hsl(var(--chart-3))"
                fillOpacity={0}
                strokeWidth={1.5}
                dashFromIndex={0}
                dashArray="6 4"
              />
              <XAxis />
              <YAxis numTicks={5} />
              <ChartTooltip />
            </AreaChart>
          )}
        </ChartBrushLayout>
      </div>
    </div>
  );
}
