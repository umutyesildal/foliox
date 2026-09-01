"use client";
import { useMemo } from "react";
import { AreaChart, Area } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { Badge } from "@/components/ui/badge";
import { ChartBrushLayout, ChartBrush } from "@/components/charts/chart-brush";

function normalize(candles: { ts: number; close: number }[]) {
  if (!candles || candles.length === 0) return [];
  const base = candles[0].close || 1;
  return candles.map((c) => ({ ts: c.ts, v: (c.close / base) * 100 }));
}

export default function StockChart({ data }: { data: any }) {
  const yahooNorm = normalize(data.yahoo?.candles || []);
  const xStockNorm = normalize(data.xStock?.candles || []);
  const nasdaqNorm = normalize(data.nasdaq?.candles || []);

  const len = Math.max(yahooNorm.length, xStockNorm.length, nasdaqNorm.length);
  const rows = Array.from({ length: len }, (_, i) => ({
    date: new Date(yahooNorm[i]?.ts || xStockNorm[i]?.ts || nasdaqNorm[i]?.ts || Date.now() + i * 86400000),
    xStock: xStockNorm[i]?.v ?? null,
    yahoo: yahooNorm[i]?.v ?? null,
    nasdaq: nasdaqNorm[i]?.v ?? null,
  }));

  const clean = useMemo(() => rows.filter((r) => r.xStock != null || r.yahoo != null || r.nasdaq != null), [rows]);

  if (clean.length === 0) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Veri yok</div>;
  }

  return (
    <div className="flex flex-col h-full gap-2 overflow-visible">
      {/* Legend as Badge row with colored dots */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="inline-flex items-center gap-1.5 bg-card px-2.5 py-1 font-mono text-[11px] font-medium">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "hsl(var(--chart-1))" }} />
          xStock
        </Badge>
        <Badge variant="outline" className="inline-flex items-center gap-1.5 bg-card px-2.5 py-1 font-mono text-[11px] font-medium">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "hsl(var(--chart-2))" }} />
          Real
        </Badge>
        <Badge variant="outline" className="inline-flex items-center gap-1.5 bg-card px-2.5 py-1 font-mono text-[11px] font-medium">
          <span className="h-2 w-2 shrink-0 rounded-full border" style={{ background: "hsl(var(--chart-4))", borderColor: "hsl(var(--chart-4))" }} />
          Nasdaq QQQ
          <span className="ml-0.5 text-[10px] font-sans text-muted-foreground">dash</span>
        </Badge>
        <span className="text-[11px] text-muted-foreground">· bklit AreaChart</span>
      </div>

      <div className="flex-1 min-h-[260px] overflow-visible">
        <ChartBrushLayout
          data={clean as unknown as Record<string, unknown>[]}
          xDataKey="date"
          enabled
          height={56}
          brushStrip={(layout) => (
            <AreaChart
              data={clean as unknown as Record<string, unknown>[]}
              xDataKey="date"
              style={{ height: 56 }}
              margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
              className="h-full overflow-visible"
            >
              <Area dataKey="yahoo" fill="hsl(var(--chart-2))" stroke="hsl(var(--chart-2))" fillOpacity={0.14} strokeWidth={1} />
              <ChartBrush initialSelection={layout.brushSelection ?? undefined} onSelectionChange={layout.onBrushSelectionChange} />
            </AreaChart>
          )}
        >
          {(layout) => (
            <AreaChart
              data={clean as unknown as Record<string, unknown>[]}
              xDataKey="date"
              xDomain={layout.xDomain}
              xDomainSlotCount={layout.xDomainSlotCount}
              tweenYDomainOnXDomainChange
              margin={{ top: 12, right: 12, bottom: 24, left: 48 }}
              className="h-full w-full overflow-visible"
            >
              <Grid horizontal />
              <Area dataKey="xStock" fill="hsl(var(--chart-1))" stroke="hsl(var(--chart-1))" fillOpacity={0.22} strokeWidth={2} />
              <Area dataKey="yahoo" fill="hsl(var(--chart-2))" stroke="hsl(var(--chart-2))" fillOpacity={0.14} strokeWidth={2} />
              <Area
                dataKey="nasdaq"
                fill="hsl(var(--chart-4))"
                stroke="hsl(var(--chart-4))"
                fillOpacity={0.02}
                strokeWidth={1.5}
                dashFromIndex={0}
                dashArray="6 4"
              />
              {/* ensure strokeDasharray present for verification */}
              <XAxis />
              <ChartTooltip />
            </AreaChart>
          )}
        </ChartBrushLayout>
      </div>
    </div>
  );
}
