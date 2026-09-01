"use client";
import { useMemo } from "react";
import { CandlestickChart } from "@/components/charts/candlestick-chart";
import { Candlestick } from "@/components/charts/candlestick";
import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { Badge } from "@/components/ui/badge";
import { ChartBrushLayout, ChartBrush } from "@/components/charts/chart-brush";

export default function CandleVolumeChart({
  candles,
}: {
  candles: { ts: number; open: number; high: number; low: number; close: number; volume: number }[];
}) {
  const ohlc = useMemo(
    () =>
      candles.map((c) => ({
        date: new Date(c.ts),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
    [candles]
  );

  if (!ohlc.length) return <div className="text-xs text-muted-foreground p-4">Mum verisi yok</div>;

  // For brush strip, volume overview
  const volumeOverview = useMemo(() => ohlc.map((d) => ({ date: d.date, volume: d.volume })), [ohlc]);

  return (
    <div className="flex flex-col h-full gap-2 overflow-visible">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Badge variant="outline" className="inline-flex items-center gap-1.5 bg-card px-2.5 py-1 font-mono text-[11px] font-medium">
          <span className="h-2 w-2 shrink-0 rounded-sm bg-emerald-500" />
          OHLC
        </Badge>
        <Badge variant="outline" className="inline-flex items-center gap-1.5 bg-card px-2.5 py-1 font-mono text-[11px] font-medium">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "hsl(var(--chart-2))" }} />
          Volume
        </Badge>
        <span className="text-[11px] text-muted-foreground">· bklit Candlestick + BarChart</span>
      </div>

      <ChartBrushLayout
        data={ohlc as unknown as Record<string, unknown>[]}
        xDataKey="date"
        enabled
        height={56}
        brushStrip={(layout) => (
          <BarChart
            data={volumeOverview as unknown as Record<string, unknown>[]}
            xDataKey="date"
            style={{ height: 56 }}
            margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
            className="h-full overflow-visible"
          >
            <Bar dataKey="volume" fill="hsl(var(--chart-3))" />
            <ChartBrush initialSelection={layout.brushSelection ?? undefined} onSelectionChange={layout.onBrushSelectionChange} />
          </BarChart>
        )}
      >
        {(layout) => {
          // Derive visible window from brushSelection / xDomain
          const visible = useMemo(() => {
            if (!layout.xDomain || !layout.brushSelection) return ohlc;
            const start = layout.brushSelection.start.getTime();
            const end = layout.brushSelection.end.getTime();
            // find nearest indices
            let sIdx = 0;
            let eIdx = ohlc.length - 1;
            let minS = Number.POSITIVE_INFINITY;
            let minE = Number.POSITIVE_INFINITY;
            for (let i = 0; i < ohlc.length; i++) {
              const t = ohlc[i].date.getTime();
              const ds = Math.abs(t - start);
              const de = Math.abs(t - end);
              if (ds < minS) {
                minS = ds;
                sIdx = i;
              }
              if (de < minE) {
                minE = de;
                eIdx = i;
              }
            }
            const s = Math.min(sIdx, eIdx);
            const e = Math.max(sIdx, eIdx);
            if (e - s < 1) return ohlc;
            return ohlc.slice(s, e + 1);
          }, [ohlc, layout.xDomain, layout.brushSelection]);

          const volumeData = useMemo(() => visible.map((d) => ({ date: d.date, volume: d.volume })), [visible]);
          const xDomain = layout.xDomain;
          const xDomainSlotCount = layout.xDomainSlotCount;

          return (
            <div className="flex flex-col gap-1 h-full overflow-visible">
              {/* top 70% candles */}
              <div className="flex-[0.7] min-h-[180px] overflow-visible" style={{ flexBasis: "70%" }}>
                <CandlestickChart
                  data={visible as unknown as Record<string, unknown>[]}
                  xDataKey="date"
                  xDomain={xDomain}
                  xDomainSlotCount={xDomainSlotCount}
                  margin={{ top: 12, right: 12, bottom: 24, left: 48 }}
                  className="h-full overflow-visible"
                >
                  <Grid horizontal />
                  <Candlestick />
                  <XAxis />
                  <ChartTooltip />
                </CandlestickChart>
              </div>

              {/* bottom 30% volume BarChart */}
              <div className="flex-[0.3] min-h-[80px] overflow-visible" style={{ flexBasis: "30%" }}>
                <BarChart
                  data={volumeData as unknown as Record<string, unknown>[]}
                  xDataKey="date"
                  margin={{ top: 12, right: 12, bottom: 24, left: 48 }}
                  className="h-full overflow-visible"
                >
                  <Grid horizontal />
                  <Bar dataKey="volume" fill="hsl(var(--chart-2))" />
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
