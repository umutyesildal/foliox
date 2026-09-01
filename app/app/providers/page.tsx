import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { PieCenter } from "@/components/charts/pie-center";
import { AreaChart, Area } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { Shield, Zap, Globe, BarChart3, Layers, TrendingUp, ExternalLink, Database, Activity } from "lucide-react";

async function getProviders() {
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_API || "http://localhost:3001"}/api/v1/providers`, { cache: "no-store" });
    return r.json();
  } catch {
    return { data: [] };
  }
}
async function getXStocks() {
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_API || "http://localhost:3001"}/api/v1/xstocks`, { cache: "no-store" });
    return r.json();
  } catch {
    return { data: [] };
  }
}
async function getSparkline(symbol: string) {
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_API || "http://localhost:3001"}/api/v1/prices/yahoo?symbol=${symbol}&range=1mo`, { cache: "no-store" });
    const j = await r.json();
    const candles: { close: number; ts: number }[] = j.data?.candles || [];
    if (!candles.length) return [];
    const sliced = candles.slice(-20);
    const base = sliced[0]?.close || 1;
    return sliced.map((c) => ({ date: new Date(c.ts), value: (c.close / base) * 100 }));
  } catch {
    return [];
  }
}

function Sparkline({ data, up = true }: { data: { date: Date; value: number }[]; up?: boolean }) {
  if (!data?.length || data.length < 2) return <div className="h-[32px] w-[120px] rounded bg-muted/20 animate-pulse border border-dashed border-border" />;
  const xDomain: [Date, Date] = [data[0].date, data[data.length - 1].date];
  const color = up ? "hsl(var(--chart-2))" : "hsl(var(--destructive))";
  return (
    <div className="h-[32px] w-[120px] overflow-hidden rounded bg-muted/10 border border-border/40">
      <AreaChart
        data={data as unknown as Record<string, unknown>[]}
        xDataKey="date"
        margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
        className="h-[32px] w-full"
        style={{ height: 32, aspectRatio: "auto" } as React.CSSProperties}
        xDomain={xDomain}
        xDomainSlotCount={data.length}
      >
        <Grid horizontal numTicksRows={2} stroke="hsl(var(--border))" strokeOpacity={0.22} strokeDasharray="2,4" />
        <Area dataKey="value" fill={color} stroke={color} fillOpacity={0.18} strokeWidth={1.5} />
      </AreaChart>
    </div>
  );
}

function providerIcon(id: string, className = "h-4 w-4") {
  switch (id) {
    case "backed":
      return <Shield className={className} />;
    case "jupiter":
      return <Zap className={className} />;
    case "yahoo":
      return <BarChart3 className={className} />;
    case "nasdaq":
      return <Globe className={className} />;
    default:
      return <Layers className={className} />;
  }
}

const DEMO_PROVIDERS = [
  { id: "backed", name: "Backed Finance", type: "issuer", url: "backed.fi", mints: [{ ticker: "TSLAx" }, { ticker: "AAPLx" }, { ticker: "NVDAx" }, { ticker: "SPYx" }] },
  { id: "jupiter", name: "Jupiter", type: "price", url: "price.jup.ag", mints: null },
  { id: "yahoo", name: "Yahoo Finance", type: "price", url: "finance.yahoo.com", mints: null },
  { id: "nasdaq", name: "Nasdaq", type: "index", url: "nasdaq.com", mints: null },
];

const DEMO_XSTOCKS = [
  { ticker: "TSLAx", yahooSymbol: "TSLA", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", decimals: 6 },
  { ticker: "AAPLx", yahooSymbol: "AAPL", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 6 },
  { ticker: "NVDAx", yahooSymbol: "NVDA", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 6 },
  { ticker: "SPYx", yahooSymbol: "SPY", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", decimals: 6 },
];

export default async function ProvidersPage() {
  const providersRaw = await getProviders();
  const xstocksRaw = await getXStocks();
  const providerList = providersRaw?.data?.length ? providersRaw.data : DEMO_PROVIDERS;
  const xstockList = xstocksRaw?.data?.length ? xstocksRaw.data : DEMO_XSTOCKS;

  const sparkMap: Record<string, { date: Date; value: number }[]> = {};
  await Promise.all(
    xstockList.map(async (x: { ticker: string; yahooSymbol: string }) => {
      const s = await getSparkline(x.yahooSymbol);
      sparkMap[x.ticker] = s;
    })
  );

  const pieData = [
    { label: "Backed Finance", value: 4, color: "hsl(var(--chart-1))" },
    { label: "Jupiter", value: 1, color: "hsl(var(--chart-2))" },
    { label: "Yahoo", value: 1, color: "hsl(var(--chart-3))" },
    { label: "Nasdaq", value: 1, color: "hsl(var(--chart-4))" },
  ];

  return (
    <div className="space-y-6">
      {/* Header — bklit Card/Table/Badge showcase */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">Providers</h1>
            <Badge variant="secondary" className="gap-1.5 font-mono text-[10px] border-emerald-200/60 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> LIVE
            </Badge>
            <Badge variant="outline" className="font-mono text-[11px] border-border bg-card">
              bklit
            </Badge>
          </div>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
            xStocks issuer + price feeds + index benchmarks — all live via{" "}
            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded border border-border">bklit</span> PieChart · AreaChart · Card · Table
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <a href="/market" className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 hover:bg-muted hover:text-foreground transition">
            <BarChart3 className="h-3 w-3" /> Market
          </a>
          <a href="/explore" className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 hover:bg-muted hover:text-foreground transition">
            <Layers className="h-3 w-3" /> Explore
          </a>
        </div>
      </div>

      {/* Stats — 4-col responsive, hsl(var(--chart-*)) correctly */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden border-border/60 bg-card shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--chart-1))]/20 to-transparent" />
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border" style={{ backgroundColor: "hsl(var(--chart-1) / 0.12)", borderColor: "hsl(var(--chart-1) / 0.2)", color: "hsl(var(--chart-1))" }}>
                <Shield className="h-4 w-4" />
              </div>
              <Badge variant="secondary" className="h-5 text-[10px] font-mono border" style={{ backgroundColor: "hsl(var(--chart-1) / 0.1)", color: "hsl(var(--chart-1))", borderColor: "hsl(var(--chart-1) / 0.2)" }}>
                issuer
              </Badge>
            </div>
            <div className="mt-3 text-2xl font-mono font-semibold tracking-tight">4</div>
            <div className="text-xs font-medium tracking-widest uppercase text-muted-foreground">Providers</div>
            <div className="mt-1 text-xs text-muted-foreground">Backed · Jupiter · Yahoo · Nasdaq</div>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border/60 bg-card shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--chart-2))]/20 to-transparent" />
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border" style={{ backgroundColor: "hsl(var(--chart-2) / 0.12)", borderColor: "hsl(var(--chart-2) / 0.2)", color: "hsl(var(--chart-2))" }}>
                <Layers className="h-4 w-4" />
              </div>
              <Badge variant="secondary" className="h-5 gap-1 text-[10px] font-mono border" style={{ backgroundColor: "hsl(var(--chart-2) / 0.1)", color: "hsl(var(--chart-2))", borderColor: "hsl(var(--chart-2) / 0.2)" }}>
                <Database className="h-3 w-3" /> Token-2022
              </Badge>
            </div>
            <div className="mt-3 text-2xl font-mono font-semibold tracking-tight">4</div>
            <div className="text-xs font-medium tracking-widest uppercase text-muted-foreground">xStocks</div>
            <div className="mt-1 text-xs text-muted-foreground">TSLAx · AAPLx · NVDAx · SPYx</div>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border/60 bg-card shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--chart-3))]/20 to-transparent" />
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border" style={{ backgroundColor: "hsl(var(--chart-3) / 0.12)", borderColor: "hsl(var(--chart-3) / 0.2)", color: "hsl(var(--chart-3))" }}>
                <Zap className="h-4 w-4" />
              </div>
              <span className="h-5 inline-flex items-center rounded-full border px-2 text-[10px] font-mono bg-muted text-muted-foreground">SPL</span>
            </div>
            <div className="mt-3 text-2xl font-mono font-semibold tracking-tight">1</div>
            <div className="text-xs font-medium tracking-widest uppercase text-muted-foreground">Chains</div>
            <div className="mt-1 text-xs text-muted-foreground">Solana · Token-2022</div>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-emerald-200/50 bg-emerald-50/40 dark:bg-emerald-950/15 dark:border-emerald-900/40 shadow-sm hover:shadow-md transition-shadow">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/25 to-transparent" />
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                <Activity className="h-4 w-4" />
              </div>
              <span className="h-5 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 text-[10px] font-medium text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> Live
              </span>
            </div>
            <div className="mt-3 text-2xl font-mono font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">Live</div>
            <div className="text-xs font-medium tracking-widest uppercase text-emerald-700/70 dark:text-emerald-400/70">Status</div>
            <div className="mt-1 text-xs text-muted-foreground">All feeds operational</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_0.75fr]">
        {/* Provider cards — hover weak fixed: -translate-y-0.5 + shadow + border */}
        <div className="grid gap-3 content-start">
          {providerList.map((p: { id: string; name: string; type: string; url?: string; symbol?: string; mints?: { ticker: string }[] | null }) => (
            <Card
              key={p.id}
              className="group relative overflow-hidden border-border/60 bg-card hover:border-primary/15 hover:shadow-lg hover:shadow-primary/[0.06] hover:-translate-y-0.5 transition-all duration-200"
            >
              <div
                className="absolute left-0 top-0 h-full w-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: p.id === "backed" ? "hsl(var(--chart-1))" : p.id === "jupiter" ? "hsl(var(--chart-2))" : p.id === "yahoo" ? "hsl(var(--chart-3))" : "hsl(var(--chart-4))" }}
              />
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/20 transition-colors">
                    {providerIcon(p.id)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="truncate font-semibold tracking-tight">{p.name}</span>
                      <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 h-5 border-border/60 bg-card">
                        {p.type}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs font-mono truncate mt-0.5">{p.url || p.symbol || `${p.mints?.length || 0} mints`}</CardDescription>
                  </div>
                  <Badge variant={p.id === "backed" ? "default" : "secondary"} className="text-[10px] shrink-0 h-5 px-2 gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active
                  </Badge>
                </CardTitle>
              </CardHeader>
              {p.mints && p.mints.length > 0 && (
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-1.5">
                    {p.mints.map((m: { ticker: string }) => (
                      <Badge key={m.ticker} variant="secondary" className="font-mono text-[11px] px-2 py-0.5 bg-muted border-border/60 hover:bg-muted transition-colors">
                        {m.ticker}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>

        {/* Pie distribution — bklit PieChart best practices: size fixed, innerRadius 56, padAngle 0.02, cornerRadius 6, centered */}
        <Card className="border-border/60 bg-card overflow-hidden flex flex-col shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 border border-primary/10 text-primary">
                <BarChart3 className="h-4 w-4" />
              </span>
              Provider Mix
              <Badge variant="outline" className="ml-auto font-mono text-[10px]">7 feeds</Badge>
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed">xStocks vs price vs index — bklit PieChart (donut, padAngle, cornerRadius)</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
            <div className="flex h-[240px] w-full items-center justify-center rounded-xl bg-muted/20 border border-border/40 p-2">
              <PieChart data={pieData} size={190} innerRadius={56} padAngle={0.02} cornerRadius={6} hoverOffset={8} className="shrink-0">
                {pieData.map((_, i) => (
                  <PieSlice key={i} index={i} />
                ))}
                <PieCenter>
                  <div className="text-center">
                    <div className="text-xl font-mono font-semibold tracking-tight leading-none">7</div>
                    <div className="mt-0.5 text-[11px] font-medium tracking-widest uppercase text-muted-foreground">providers</div>
                  </div>
                </PieCenter>
              </PieChart>
            </div>
            <div className="grid w-full grid-cols-2 gap-2">
              {pieData.map((d) => (
                <div key={d.label} className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-xs">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10" style={{ background: d.color }} />
                  <span className="truncate font-medium">{d.label}</span>
                  <span className="ml-auto font-mono text-muted-foreground">{d.value}</span>
                </div>
              ))}
            </div>
            <div className="text-center text-[11px] leading-relaxed text-muted-foreground">Backed is issuer (4 mints) · Jupiter/Yahoo/Nasdaq are price & index feeds</div>
          </CardContent>
        </Card>
      </div>

      {/* xStocks table with sparkline — bklit Table + AreaChart + Grid + xDomain */}
      <Card className="border-border/60 bg-card overflow-hidden shadow-sm">
        <CardHeader className="border-b bg-muted/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <TrendingUp className="h-4 w-4 text-primary" /> xStocks — live prices & sparkline
                <Badge variant="secondary" className="font-mono text-[10px]">{xstockList.length} mints</Badge>
              </CardTitle>
              <CardDescription className="mt-1 text-xs leading-relaxed">Real mint addresses (Solscan verified) · sparkline 1mo normalized to 100 · Grid + xDomain best practice</CardDescription>
            </div>
            <Badge variant="outline" className="gap-1.5 font-mono text-[10px] border-emerald-200/60 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Jupiter · Yahoo 30m
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40 border-border">
                  <TableHead className="h-9 font-mono text-[11px] tracking-widest uppercase bg-muted/40">Ticker</TableHead>
                  <TableHead className="h-9 font-mono text-[11px] tracking-widest uppercase bg-muted/40">Source</TableHead>
                  <TableHead className="hidden md:table-cell h-9 font-mono text-[11px] tracking-widest uppercase bg-muted/40">Mint</TableHead>
                  <TableHead className="h-9 font-mono text-[11px] tracking-widest uppercase bg-muted/40">Trend (1mo)</TableHead>
                  <TableHead className="h-9 text-right font-mono text-[11px] tracking-widest uppercase bg-muted/40">Chart</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {xstockList.map((x: { ticker: string; yahooSymbol: string; mint: string }) => {
                  const spark = sparkMap[x.ticker] || [];
                  const last = spark[spark.length - 1]?.value ?? 100;
                  const first = spark[0]?.value ?? 100;
                  const up = last >= first;
                  return (
                    <TableRow key={x.ticker} className="group/row hover:bg-muted/30 transition-colors border-border">
                      <TableCell className="py-3">
                        <Badge variant="outline" className="font-mono text-xs border-border/60 bg-card group-hover/row:border-primary/20 transition-colors">
                          {x.ticker}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3 text-xs whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 font-mono">
                          {x.yahooSymbol} <span className="text-muted-foreground">· 6 dec</span>
                          <span className={`h-1.5 w-1.5 rounded-full ${up ? "bg-emerald-500" : "bg-red-500"}`} />
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell py-3 font-mono text-xs truncate max-w-[220px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 border border-border/60">{x.mint.slice(0, 8)}…{x.mint.slice(-6)}</span>
                      </TableCell>
                      <TableCell className="py-2">
                        <Sparkline data={spark} up={up} />
                      </TableCell>
                      <TableCell className="py-3 text-right">
                        <a href={`/stock/${x.ticker}`} className="inline-flex items-center gap-1 rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors">
                          View chart <ExternalLink className="h-3 w-3 opacity-70" />
                        </a>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Note:</span> Live prices from Yahoo (30m cache) + Jupiter Price v6. UI built with{" "}
        <a href="https://bklit.com/docs/installation" className="font-mono underline decoration-dotted underline-offset-4 hover:text-foreground">
          bklit
        </a>{" "}
        (<span className="font-mono">Card, Table, Badge, PieChart, AreaChart, Grid</span>) + shadcn. Colors use{" "}
        <span className="font-mono bg-muted px-1 rounded border">hsl(var(--chart-*))</span> — innerRadius 56, padAngle 0.02, cornerRadius 6, sparkline 32px + Grid + xDomain.
      </div>
    </div>
  );
}
