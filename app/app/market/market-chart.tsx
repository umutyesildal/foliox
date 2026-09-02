"use client";

import { useMemo } from "react";

import { Area, AreaChart } from "@/components/charts/area-chart";
import { ChartBrush, ChartBrushLayout } from "@/components/charts/chart-brush";
import { Grid } from "@/components/charts/grid";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { Badge } from "@/components/ui/badge";
import { formatTokenAmount } from "@/lib/format";

export interface MarketSeriesMeta {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
}

export interface MarketChartProps {
  /** Rows normalized to 100 at the start of the window. */
  rows: Record<string, unknown>[];
  /** Series metadata (subset actually present in `rows`). */
  series: MarketSeriesMeta[];
  /** Last 30 daily candles for the benchmark series. */
  volume: { date: Date; volume: number }[];
  volumeLabel: string;
}

/**
 * Normalized-to-100 four-series AreaChart with the documented local Brush
 * adapter (implements the Bklit ChartBrush/ChartBrushLayout API — not official
 * registry source) plus a 30-candle volume BarChart.
 */
export default function MarketChart({ rows, series, volume, volumeLabel }: MarketChartProps) {
  const benchmarkKey = series[series.length - 1]?.key ?? series[0]?.key;
  const peakVolume = useMemo(
    () => volume.reduce((max, d) => Math.max(max, d.volume), 0),
    [volume],
  );

  if (rows.length < 2 || series.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Not enough data points to draw a comparison.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div data-slot="market-normalized-chart" className="min-h-[300px]">
        <ChartBrushLayout
          data={rows}
          xDataKey="date"
          enabled
          height={48}
          brushStrip={(layout) => (
            <AreaChart
              data={rows}
              xDataKey="date"
              style={{ height: 48 }}
              margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
              className="h-full"
            >
              <Area
                dataKey={benchmarkKey}
                fill="hsl(var(--chart-3))"
                stroke="hsl(var(--chart-3))"
                fillOpacity={0.12}
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
              data={rows}
              xDataKey="date"
              xDomain={layout.xDomain}
              xDomainSlotCount={layout.xDomainSlotCount}
              tweenYDomainOnXDomainChange
              margin={{ top: 12, right: 16, bottom: 28, left: 48 }}
              className="h-full w-full"
            >
              <Grid horizontal />
              {series.map((s) => (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  fill={s.color}
                  stroke={s.color}
                  fillOpacity={s.dashed ? 0 : 0.14}
                  strokeWidth={s.dashed ? 1.5 : 2}
                  dashFromIndex={s.dashed ? 0 : undefined}
                  dashArray={s.dashed ? "6 4" : undefined}
                />
              ))}
              <XAxis />
              <YAxis numTicks={5} />
              <ChartTooltip />
            </AreaChart>
          )}
        </ChartBrushLayout>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {series.map((s) => (
          <Badge
            key={s.key}
            variant="outline"
            className="inline-flex items-center gap-1.5 bg-card px-2 py-0 font-mono text-[11px] font-medium"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                background: s.color,
                border: s.dashed ? `1px dashed ${s.color}` : undefined,
              }}
            />
            {s.label}
            {s.dashed ? <span className="text-[10px] font-sans text-muted-foreground">dashed</span> : null}
          </Badge>
        ))}
        <span className="text-xs text-muted-foreground">Normalized to 100 at the start of the window.</span>
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-medium">{volumeLabel} — daily volume, last 30 candles</h2>
          {peakVolume > 0 ? (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              peak {formatTokenAmount(peakVolume, { maximumFractionDigits: 1 })} shares
            </span>
          ) : null}
        </div>
        <div className="h-[140px]">
          <BarChart
            data={volume as unknown as Record<string, unknown>[]}
            xDataKey="date"
            margin={{ top: 8, right: 16, bottom: 24, left: 16 }}
            className="h-full w-full"
          >
            <Grid horizontal />
            <Bar dataKey="volume" fill="hsl(var(--chart-3))" />
            <BarXAxis />
            <ChartTooltip />
          </BarChart>
        </div>
      </div>
    </div>
  );
}
