import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AreaChart, Area } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";

async function getOverview(range="1mo") {
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_API || "http://localhost:3001"}/api/v1/market/overview?range=${range}`, { cache: "no-store" });
    return r.json();
  } catch { return { data: [] }; }
}

const RANGES = ["1mo","3mo","6mo","1y"] as const;

const LEGEND = [
  { key: "QQQ", label: "QQQ", color: "hsl(var(--chart-1))" },
  { key: "SPY", label: "SPY", color: "hsl(var(--chart-2))" },
  { key: "DIA", label: "DIA", color: "hsl(var(--chart-3))" },
  { key: "IXIC", label: "IXIC", color: "hsl(var(--chart-4))", dashed: true },
] as const;

export default async function MarketPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const sp = await searchParams;
  const range = sp?.range || "1mo";
  const data = await getOverview(range);
  const combined = (() => {
    const len = Math.max(...(data.data||[]).map((o:any)=>o.candles?.length||0),0);
    if (!len) return [];
    const rows:any[] = [];
    for (let i=0;i<len;i++) {
      const row:any = {};
      let date:any = null;
      for (const o of data.data||[]) {
        const c = o.candles?.[i];
        if (!c) continue;
        const first = o.candles?.[0]?.close || 1;
        if (!date) date = new Date(c.ts);
        const key = o.symbol === "^IXIC" ? "IXIC" : o.symbol;
        row[key] = Number(((c.close / first) * 100).toFixed(2));
      }
      if (date) { row.date = date; rows.push(row); }
    }
    return rows;
  })();

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Market Overview</h1>
        <p className="text-sm text-muted-foreground">
          Nasdaq benchmark — QQQ / SPY / DIA / IXIC last {range} performance. Base for comparing xStock baskets. Charts with <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">bklit</span>
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {RANGES.map((r)=>(
          <a
            key={r}
            href={`/market?range=${r}`}
            className={`inline-flex items-center justify-center rounded-full px-3.5 py-1.5 border text-xs font-medium transition-colors ${
              r===range
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {r}
          </a>
        ))}
      </div>

      {combined.length > 1 ? (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3 space-y-1.5">
            <CardTitle className="text-sm tracking-tight">Normalized Comparison — 100 base</CardTitle>
            <CardDescription className="text-xs leading-relaxed">All indices normalized to 100 at start — co-movement (bklit AreaChart)</CardDescription>
            <div className="flex flex-wrap items-center gap-2 pt-1.5">
              {LEGEND.map((item)=>(
                <Badge
                  key={item.key}
                  variant="outline"
                  className="inline-flex items-center gap-1.5 bg-card px-2.5 py-1 font-mono text-[11px] font-medium"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: item.color,
                      // for IXIC muted gray dash: show as dashed border circle to hint style
                      border: item.dashed ? `1px dashed ${item.color}` : undefined,
                    }}
                  />
                  {item.label}
                  {item.dashed && <span className="ml-0.5 text-[10px] font-sans text-muted-foreground">dash</span>}
                </Badge>
              ))}
              <span className="text-[11px] text-muted-foreground">· bklit AreaChart</span>
            </div>
          </CardHeader>
          <CardContent className="h-[300px] px-2 pb-2 pt-0">
            <AreaChart
              data={combined}
              xDataKey="date"
              margin={{ top: 12, right: 16, bottom: 28, left: 48 }}
              className="h-full w-full"
            >
              <Grid horizontal />
              {/* QQQ — chart-1 primary, most opaque */}
              <Area dataKey="QQQ" fill="hsl(var(--chart-1))" stroke="hsl(var(--chart-1))" fillOpacity={0.22} strokeWidth={2} />
              {/* SPY — chart-2 emerald */}
              <Area dataKey="SPY" fill="hsl(var(--chart-2))" stroke="hsl(var(--chart-2))" fillOpacity={0.14} strokeWidth={2} />
              {/* DIA — chart-3 amber */}
              <Area dataKey="DIA" fill="hsl(var(--chart-3))" stroke="hsl(var(--chart-3))" fillOpacity={0.10} strokeWidth={1.5} />
              {/* IXIC — chart-4 muted gray dash, no fill to avoid clash */}
              <Area dataKey="IXIC" fill="hsl(var(--chart-4))" stroke="hsl(var(--chart-4))" fillOpacity={0} strokeWidth={1.5} dashFromIndex={0} dashArray="6 4" />
              <XAxis />
              <YAxis />
              <ChartTooltip />
            </AreaChart>
          </CardContent>
        </Card>
      ) : (
        <Card className="p-8 text-center text-sm text-muted-foreground">No market data — backend may be starting, try refresh in 3s</Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {(data.data||[]).map((o:any)=>{
          const first = o.candles?.[0]?.close || 1;
          const chartData = (o.candles||[]).slice(-20).map((c:any)=>({ date: new Date(c.ts), value: Number(((c.close/first)*100).toFixed(2)) }));
          const up = o.changePct>=0;
          return (
            <Card key={o.symbol} className="overflow-hidden">
              <CardHeader className="pb-2 space-y-1">
                <CardTitle className="flex items-center justify-between font-mono text-sm tracking-tight">
                  <span>{o.symbol}</span>
                  <Badge variant={up?"default":"destructive"} className="text-xs tabular-nums">{up?"+":""}{o.changePct?.toFixed(2)}%</Badge>
                </CardTitle>
                <CardDescription className="font-mono text-xs tabular-nums">{o.first?.toFixed(2)} → {o.last?.toFixed(2)} · {o.count} candles</CardDescription>
              </CardHeader>
              <CardContent className="h-[120px] px-2 pb-2 pt-0">
                {chartData.length > 1 ? (
                  <AreaChart
                    data={chartData}
                    xDataKey="date"
                    margin={{ top: 8, right: 12, bottom: 20, left: 36 }}
                    className="h-full w-full"
                  >
                    <Area dataKey="value" fill={up ? "hsl(var(--chart-2))" : "hsl(var(--destructive))"} stroke={up ? "hsl(var(--chart-2))" : "hsl(var(--destructive))"} fillOpacity={0.18} strokeWidth={1.5} />
                    <XAxis />
                    <ChartTooltip />
                  </AreaChart>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No data</div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <div className="text-xs text-muted-foreground">Source: Yahoo Finance — 30 min cache. Real Nasdaq; xStock price from Jupiter, diff = depeg.</div>
    </div>
  );
}
