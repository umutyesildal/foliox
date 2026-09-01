"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Shield, Zap, TrendingUp, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AreaChart, Area } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";

// Mock SP500 / QQQ rising data for hero dashboard
function genRising(n = 40, start = 100) {
  let v = start;
  return Array.from({ length: n }, (_, i) => {
    v += (Math.random() - 0.42) * 1.8;
    if (i % 7 === 0) v += 0.9;
    return { date: new Date(Date.now() - (n - i) * 3600000 * 6), value: Number(v.toFixed(2)), spy: Number((v * 0.96 + Math.random() * 2).toFixed(2)) };
  });
}

export default function Page() {
  const [data, setData] = useState<{ date: Date; value: number; spy: number }[]>([]);
  const [livePrice, setLivePrice] = useState(582.14);
  const [spStatus, setSpStatus] = useState<"loading" | "ready">("loading");
  useEffect(() => {
    // client-only initial data to avoid hydration mismatch
    setData(genRising(36, 100));
    const t = setTimeout(() => setSpStatus("ready"), 600);
    const id = setInterval(() => {
      setData((d) => {
        if (!d.length) return d;
        const last = d[d.length - 1].value;
        const next = last + (Math.random() - 0.44) * 1.2;
        return [...d.slice(1), { date: new Date(), value: Number(next.toFixed(2)), spy: Number((next * 0.97 + Math.random()).toFixed(2)) }];
      });
      setLivePrice((p) => Number((p + (Math.random() - 0.48) * 0.9).toFixed(2)));
    }, 1800);
    return () => { clearTimeout(t); clearInterval(id); };
  }, []);

  const change = ((livePrice - 575.3) / 575.3) * 100;

  return (
    <div className="bg-background">
      {/* Hero - bklit */}
      <div className="relative bg-background overflow-visible">
        <div className="mx-auto max-w-6xl px-6 pt-14 pb-10 md:pt-20 md:pb-16">
          <div className="grid gap-10 md:grid-cols-[1.1fr_0.9fr] items-center">
            {/* Left copy */}
            <div>
              <Badge variant="outline" className="gap-1.5 rounded-full border-primary/20 bg-primary/5 px-3 py-1 text-xs">
                <Sparkles className="h-3 w-3" /> Onchain strategy baskets · xStocks
              </Badge>
              <h1 className="mt-5 text-4xl font-bold tracking-tight md:text-6xl md:leading-[0.95]">
                Create an <span className="bg-gradient-to-r from-primary via-primary/70 to-primary/40 bg-clip-text text-transparent">index.</span>
                <br />
                Own your thesis.
              </h1>
              <p className="mt-4 max-w-xl text-[15px] leading-6 text-muted-foreground">
                Pick 2–20 xStocks, set weights, seed once, deploy an <span className="text-foreground">immutable vault</span>. One token, pro-rata redeem, no oracle.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild size="lg" className="rounded-full px-6 gap-2">
                  <Link href="/create">Create basket <ArrowRight className="h-4 w-4" /></Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="rounded-full px-6">
                  <Link href="/explore">Explore baskets</Link>
                </Button>
                <Button asChild variant="ghost" size="sm" className="rounded-full">
                  <Link href="/providers" className="gap-1.5 flex items-center">Live prices <TrendingUp className="h-3.5 w-3.5" /></Link>
                </Button>
              </div>
              <div className="mt-6 flex flex-wrap gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1"><Shield className="h-3 w-3" /> Immutable vault</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1"><Zap className="h-3 w-3" /> 300/100/300 bps caps</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1">90/10 creator split</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 font-mono">6 dec · 1M genesis</span>
              </div>
            </div>

            {/* Right dashboard preview */}
            <div className="relative">
              <div className="pointer-events-none absolute -inset-4 -z-10 blur-2xl opacity-20 bg-gradient-to-br from-primary/10 via-chart-2/10 to-transparent rounded-[32px]" />
              <Card className="overflow-visible rounded-[20px] border-border/50 shadow-2xl backdrop-blur">
                <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500/80" /><span className="h-2.5 w-2.5 rounded-full bg-yellow-500/80" /><span className="h-2.5 w-2.5 rounded-full bg-green-500/80" /></div>
                    <span className="ml-2 text-xs font-mono text-muted-foreground">SPY · S&P 500 xStock basket</span>
                  </div>
                  <Badge variant="secondary" className="font-mono text-xs">LIVE</Badge>
                </div>
                <div className="px-4 pt-4">
                  <div className="flex items-baseline gap-3">
                    <span className="text-2xl font-semibold tracking-tight font-mono">${livePrice.toFixed(2)}</span>
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${change >= 0 ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"}`}>{change >= 0 ? "+" : ""}{change.toFixed(2)}% today</span>
                    <span className="ml-auto text-xs text-muted-foreground">1M · normalized 100</span>
                  </div>
                  <div className="mt-3 w-full overflow-visible">
                    <AreaChart
                      data={data}
                      xDataKey="date"
                      margin={{ top: 20, right: 12, bottom: 24, left: 12 }}
                      className="w-full overflow-visible"
                      style={{ height: 180 }}
                      yDomainTween
                      status={spStatus}
                      loadingLabel="Loading SPY..."
                    >
                      <Grid horizontal shimmer={spStatus === "loading"} shimmerSync />
                      <Area dataKey="value" fill="hsl(var(--primary))" stroke="hsl(var(--primary))" fillOpacity={0.22} strokeWidth={2} />
                      <Area dataKey="spy" fill="hsl(var(--chart-2))" stroke="hsl(var(--chart-2))" fillOpacity={0.08} strokeWidth={1.5} />
                      <ChartTooltip />
                    </AreaChart>
                  </div>
                  <div className="grid grid-cols-3 gap-2 py-3 text-xs">
                    <div className="rounded-lg bg-muted/50 p-2.5"><div className="text-muted-foreground">NAV</div><div className="font-mono font-medium">$2.48M</div><div className="text-[11px] text-emerald-500">↗ +3.2% 24h</div></div>
                    <div className="rounded-lg bg-muted/50 p-2.5"><div className="text-muted-foreground">Holders</div><div className="font-mono font-medium">1,284</div><div className="text-[11px] text-muted-foreground">+18 today</div></div>
                    <div className="rounded-lg bg-muted/50 p-2.5"><div className="text-muted-foreground">Drift</div><div className="font-mono font-medium">+0.4%</div><div className="text-[11px] text-muted-foreground">target 50/30/20</div></div>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t bg-muted/20 px-4 py-2.5 text-xs">
                  <span className="text-muted-foreground">Backed Finance · <span className="font-mono">TSLAx/AAPLx/NVDAx</span></span>
                  <Link href="/stock/TSLAx" className="text-primary hover:underline font-medium">View TSLAx →</Link>
                </div>
              </Card>
              {/* floating mini */}
              <div className="hidden md:block absolute -bottom-4 -left-6 rotate-[-1.5deg]">
                <Card className="p-3 shadow-xl border-primary/20 w-[220px]">
                  <div className="text-xs text-muted-foreground">Basket share</div>
                  <div className="font-mono text-sm font-medium">FOLIO-7A3… · 6 dec</div>
                  <div className="mt-1 text-xs text-emerald-500">Redeem: pro-rata, oracle-free</div>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>

      <TickerStrip />

      {/* Live SP500 Pulse — full width */}
      <div className="mx-auto max-w-6xl px-6 py-8">
        <Card className="overflow-hidden border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm"><TrendingUp className="h-4 w-4 text-emerald-500" /> S&P 500 Pulse — live rising</CardTitle>
              <CardDescription className="text-xs">SPY · Yahoo Finance 1mo normalized to 100 — new candle every 1.8s, bklit AreaChart</CardDescription>
            </div>
            <Badge variant="outline" className="font-mono text-xs gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> LIVE</Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="w-full overflow-visible p-4">
              <AreaChart
                data={data}
                xDataKey="date"
                margin={{ top: 20, right: 12, bottom: 24, left: 12 }}
                className="w-full overflow-visible"
                style={{ height: 260 }}
                yDomainTween
                status={spStatus}
                loadingLabel="Syncing S&P 500..."
              >
                <Grid horizontal shimmer={spStatus === "loading"} shimmerSync />
                <Area dataKey="value" fill="hsl(var(--primary))" stroke="hsl(var(--primary))" fillOpacity={0.18} strokeWidth={2} />
                <ChartTooltip />
              </AreaChart>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* How it works — minimal, all English, no big white cards */}
      <div className="mx-auto max-w-6xl px-6 pb-8">
        <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground border-y border-border/40 py-4">
          <span className="inline-flex items-center gap-1.5"><Shield className="h-3 w-3" /> Permissionless redeem — `V·burn/S` pro-rata, never pausable</span>
          <span className="text-border">·</span>
          <span className="inline-flex items-center gap-1.5"><Zap className="h-3 w-3" /> Immutable — weights/fees/mints never change</span>
          <span className="text-border">·</span>
          <span>Self-custodial · Program <span className="font-mono text-foreground">37VPGt…gbb1</span> · Not investment advice</span>
        </div>
      </div>
    </div>
  );
}

function TickerStrip() {
  const items = [
    { s: "TSLAx", v: "+2.31%", up: true },
    { s: "NVDAx", v: "+1.84%", up: true },
    { s: "AAPLx", v: "-0.42%", up: false },
    { s: "SPYx", v: "+0.88%", up: true },
    { s: "QQQ", v: "+1.12%", up: true },
    { s: "DIA", v: "+0.64%", up: true },
  ];
  return (
    <div className="overflow-hidden border-y border-border/40 bg-muted/20 py-2">
      <div className="flex animate-[marquee_22s_linear_infinite] gap-8 whitespace-nowrap will-change-transform">
        {[...items, ...items].map((it, i) => (
          <span key={i} className="flex items-center gap-2 text-xs font-mono">
            <span className="text-foreground">{it.s}</span>
            <span className={it.up ? "text-emerald-500" : "text-red-500"}>{it.v}</span>
            <span className="text-muted-foreground">·</span>
          </span>
        ))}
      </div>
      <style>{`@keyframes marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}`}</style>
    </div>
  );
}
