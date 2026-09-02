"use client";

import { useMemo } from "react";

import { CandlestickChart, type OHLCDataPoint } from "@/components/charts/candlestick-chart";
import { Candlestick } from "@/components/charts/candlestick";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { Badge } from "@/components/ui/badge";
import { ChartBrush, ChartBrushLayout, type BrushSelection } from "@/components/charts/chart-brush";
import { formatTokenAmount } from "@/lib/format";

interface OhlcCandle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface OhlcPoint {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Slice `ohlc` down to the candle range selected in the brush (pure, hook-free). */
function sliceToSelection(ohlc: OhlcPoint[], selection: BrushSelection | null): OhlcPoint[] {
  if (!selection || ohlc.length < 2) return ohlc;
  let startIdx = 0;
  let endIdx = ohlc.length - 1;
  let minStart = Number.POSITIVE_INFINITY;
  let minEnd = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ohlc.length; i++) {
    const t = ohlc[i].date.getTime();
    const dStart = Math.abs(t - selection.start.getTime());
    const dEnd = Math.abs(t - selection.end.getTime());
    if (dStart < minStart) {
      minStart = dStart;
      startIdx = i;
    }
    if (dEnd < minEnd) {
      minEnd = dEnd;
      endIdx = i;
    }
  }
  const s = Math.min(startIdx, endIdx);
  const e = Math.max(startIdx, endIdx);
  if (e - s < 1) return ohlc;
  return ohlc.slice(s, e + 1);
}

/**
 * OHLC CandlestickChart + volume BarChart sharing one brush selection via the
 * local Brush adapter (implements the documented Bklit
 * ChartBrush/ChartBrushLayout API — not official registry source).
 */
export default function CandleVolumeChart({ candles }: { candles: OhlcCandle[] }) {
  const ohlc: OhlcPoint[] = useMemo(
    () =>
      candles.map((c) => ({
        date: new Date(c.ts),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
    [candles],
  );

  if (ohlc.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No candle data for this ticker and range.
      </div>
    );
  }

  const ohlcForChart = ohlc as unknown as Record<string, unknown>[];
  const volumeOverview = ohlc.map((d) => ({ date: d.date, volume: d.volume }));
  const peakVolume = ohlc.reduce((max, d) => Math.max(max, d.volume), 0);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className="inline-flex items-center gap-1.5 bg-card px-2 py-0 font-mono text-[11px] font-medium"
        >
          <span className="h-2 w-2 shrink-0 rounded-sm bg-foreground" />
          OHLC
        </Badge>
        <Badge
          variant="outline"
          className="inline-flex items-center gap-1.5 bg-card px-2 py-0 font-mono text-[11px] font-medium"
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "hsl(var(--chart-3))" }} />
          Volume
        </Badge>
        {peakVolume > 0 ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            peak {formatTokenAmount(peakVolume, { maximumFractionDigits: 1 })} shares
          </span>
        ) : null}
      </div>

      <ChartBrushLayout
        data={ohlcForChart}
        xDataKey="date"
        enabled
        height={56}
        brushStrip={(layout) => (
          <BarChart
            data={volumeOverview as unknown as Record<string, unknown>[]}
            xDataKey="date"
            margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
            className="h-full"
          >
            <Bar dataKey="volume" fill="hsl(var(--chart-3))" />
            <ChartBrush
              initialSelection={layout.brushSelection ?? undefined}
              onSelectionChange={layout.onBrushSelectionChange}
            />
          </BarChart>
        )}
      >
        {(layout) => {
          // Hook-free per the rules of hooks — this runs inside the layout render prop.
          const visible = sliceToSelection(ohlc, layout.brushSelection);
          const volumeData = visible.map((d) => ({ date: d.date, volume: d.volume }));

          return (
            <div className="flex h-full flex-col gap-2">
              <div className="min-h-[180px] flex-[7]">
                <CandlestickChart
                  data={visible as OHLCDataPoint[]}
                  xDataKey="date"
                  xDomain={layout.xDomain}
                  xDomainSlotCount={layout.xDomainSlotCount}
                  margin={{ top: 12, right: 12, bottom: 24, left: 56 }}
                  className="h-full"
                >
                  <Grid horizontal />
                  <Candlestick />
                  <XAxis />
                  <ChartTooltip />
                </CandlestickChart>
              </div>

              <div className="min-h-[80px] flex-[3]">
                <BarChart
                  data={volumeData as unknown as Record<string, unknown>[]}
                  xDataKey="date"
                  margin={{ top: 8, right: 12, bottom: 24, left: 56 }}
                  className="h-full"
                >
                  <Grid horizontal />
                  <Bar dataKey="volume" fill="hsl(var(--chart-3))" />
                  <BarXAxis />
                  <ChartTooltip />
                </BarChart>
              </div>
            </div>
          );
        }}
      </ChartBrushLayout>
    </div>
  );
}
