"use client";

import { useMemo } from "react";

import { Area, AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import type { TooltipRow } from "@/components/charts/tooltip/tooltip-content";
import { Badge } from "@/components/ui/badge";
import { formatTokenAmount } from "@/lib/format";

export interface MarketSeriesMeta {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  /** Line-only series (the benchmark) — never rendered as an area fill. */
  lineOnly?: boolean;
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
 * Normalized-to-100 four-series AreaChart (full range, no brush) plus a
 * 30-candle volume BarChart.
 */
export default function MarketChart({ rows, series, volume, volumeLabel }: MarketChartProps) {
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

  /** Tooltip rows: date from the tooltip title; values 2dp index points. */
  const tooltipRows = (point: Record<string, unknown>): TooltipRow[] =>
    series.map((s) => {
      const value = point[s.key];
      return {
        color: s.color,
        label: s.label,
        value: typeof value === "number" ? value.toFixed(2) : "—",
      };
    });

  const volumeTooltipRows = (point: Record<string, unknown>): TooltipRow[] => [
    {
      color: "hsl(var(--chart-3))",
      label: "Volume",
      value:
        typeof point.volume === "number"
          ? `${formatTokenAmount(point.volume, { maximumFractionDigits: 1 })} shares`
          : "—",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div data-slot="market-normalized-chart" className="min-h-[300px]">
        <AreaChart
          data={rows}
          xDataKey="date"
          margin={{ top: 12, right: 16, bottom: 28, left: 48 }}
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
          {series.map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              fill={s.color}
              stroke={s.color}
              fillOpacity={s.dashed || s.lineOnly ? 0 : 0.06}
              gradientSpan={0.4}
              strokeWidth={1.5}
              dashFromIndex={s.dashed ? 0 : undefined}
              dashArray={s.dashed ? "6 4" : undefined}
            />
          ))}
          <XAxis numTicks={5} />
          <YAxis numTicks={5} formatValue={(value) => value.toFixed(0)} />
          <ChartTooltip rows={tooltipRows} />
        </AreaChart>
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
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-medium">{volumeLabel} — daily volume, last 30 candles</h2>
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
            margin={{ top: 8, right: 16, bottom: 24, left: 48 }}
            className="h-full w-full"
          >
            <Grid horizontal />
            <Bar dataKey="volume" fill="hsl(var(--chart-3))" />
            <YAxis
              numTicks={3}
              formatValue={(value) => formatTokenAmount(value, { maximumFractionDigits: 1 })}
            />
            <BarXAxis />
            <ChartTooltip rows={volumeTooltipRows} />
          </BarChart>
        </div>
      </div>
    </div>
  );
}
