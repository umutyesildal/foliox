 // @ts-nocheck
import StockChart from "./StockChart";
import CandleVolumeChart from "./CandleVolumeChart";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
async function getChart(ticker: string, range="1mo") {
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_API || "http://localhost:3001"}/api/v1/prices/chart?ticker=${ticker}&range=${range}`, { cache: "no-store" });
    return r.json();
  } catch { return { data: null }; }
}
async function getCompare(ticker: string) {
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_API || "http://localhost:3001"}/api/v1/prices/compare?tickers=${ticker}`, { cache: "no-store" });
    const j = await r.json();
    return j.data?.[0] || null;
  } catch { return null; }
}
export default async function StockPage({ params, searchParams }: { params: { ticker: string }, searchParams: { range?: string } }) {
  const ticker = decodeURIComponent(params.ticker);
  const range = searchParams?.range || "1mo";
  const chart = await getChart(ticker, range);
  const compare = await getCompare(ticker);
  const yahooSym = ticker.replace("x","").replace("X","");
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight font-mono">{ticker} <span className="text-sm text-muted-foreground font-sans">→ {yahooSym} (real) vs Nasdaq QQQ</span></h1>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {["1mo","3mo","6mo","1y"].map(r=>(
          <a key={r} href={`/stock/${ticker}?range=${r}`} className={`rounded px-2 py-1 border ${r===range?"bg-primary text-primary-foreground border-primary":"border-border text-muted-foreground"}`}>{r}</a>
        ))}
        <a href="/providers" className="ml-2 underline text-muted-foreground">Providers</a>
        <a href="/market" className="underline text-muted-foreground">Market</a>
      </div>

      {compare && (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Card><CardHeader className="pb-2"><CardDescription>xStock (Jupiter)</CardDescription><CardTitle className="text-lg font-mono">{compare.jupiter?.toFixed(2) ?? "—"} $</CardTitle><CardDescription className="font-mono text-xs truncate">{compare.mint?.slice(0,12)}…</CardDescription></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Real ({yahooSym} · Yahoo)</CardDescription><CardTitle className="text-lg font-mono">{compare.yahoo?.toFixed(2) ?? "—"} $</CardTitle></CardHeader></Card>
          <Card className={compare.diffBps!=null && Math.abs(compare.diffBps)>200 ? "border-amber-600 bg-amber-950/20" : ""}><CardHeader className="pb-2"><CardDescription>Diff</CardDescription><CardTitle className={`text-lg font-mono ${compare.diffBps!=null && compare.diffBps>=0?"text-green-500":"text-destructive"}`}>{compare.diffBps!=null? (compare.diffBps/100).toFixed(2)+"%":"—"}</CardTitle><CardDescription>{compare.diffBps!=null && Math.abs(compare.diffBps)>200 ? "⚠ Depeg >2%":"✓ Aligned"} <Badge variant="outline" className="ml-1 text-[10px]">bklit</Badge></CardDescription></CardHeader></Card>
        </div>
      )}

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-sm">Price Comparison — {range} (normalized 100)</CardTitle><CardDescription className="text-xs">Blue = xStock, Green = Real, Gray = Nasdaq QQQ — <span className="font-mono bg-muted px-1 rounded">bklit AreaChart + Brush</span> drag to zoom</CardDescription></CardHeader>
        <CardContent className="h-[380px]">
          {chart.data ? <StockChart data={chart.data} /> : <div className="text-sm text-muted-foreground">Loading…</div>}
        </CardContent>
      </Card>

      {chart.data?.yahoo?.candles?.length > 1 && (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-sm">Candlestick + Volume — {yahooSym} (Yahoo OHLCV)</CardTitle><CardDescription className="text-xs">Real equity candles + daily volume — <span className="font-mono bg-muted px-1 rounded">bklit Candlestick + BarChart + Brush</span></CardDescription></CardHeader>
          <CardContent className="h-[480px]">
            <CandleVolumeChart candles={chart.data.yahoo.candles} />
          </CardContent>
        </Card>
      )}

      <div className="mt-3 text-xs text-muted-foreground">Note: xStock line is mocked with 0.5% jitter over Yahoo in V0.1 (will be real Jupiter price_snapshots when live). LEGAL_REVIEW_REQUIRED: xStocks are Backed structured instruments.</div>
    </div>
  );
}
