import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AreaChart, Area } from "@/components/charts/area-chart";
import { TrendingUp, Users, Wallet, ArrowRight, Sparkles, BarChart3 } from "lucide-react";

export const dynamic = "force-dynamic";

type SortKey = "aum" | "return_24h" | "holders";
const SORTS: { key: SortKey; label: string; icon: React.ReactNode }[] = [
  { key: "aum", label: "AUM", icon: <Wallet className="h-3 w-3" /> },
  { key: "return_24h", label: "24h", icon: <TrendingUp className="h-3 w-3" /> },
  { key: "holders", label: "Holders", icon: <Users className="h-3 w-3" /> },
];

async function getBaskets(sort: string) {
  try {
    const base = process.env.NEXT_PUBLIC_API || "http://localhost:3001";
    const r = await fetch(`${base}/api/v1/baskets?sort=${sort}`, { cache: "no-store" });
    const j = await r.json();
    return (j.data || []) as any[];
  } catch {
    return [];
  }
}

function sparkline(seed: number) {
  let v = 100 + (seed % 7);
  return Array.from({ length: 14 }, (_, i) => {
    v += (Math.sin(seed + i * 0.9) * 1.2 + (Math.random() - 0.48) * 0.9);
    return { date: new Date(Date.now() - (14 - i) * 86400000), value: Number(v.toFixed(2)) };
  });
}

function formatPubkey(pk: string) {
  if (!pk) return "—";
  return pk.length > 12 ? `${pk.slice(0, 6)}…${pk.slice(-4)}` : pk;
}

export default async function Explore({
  searchParams,
}: {
  searchParams?: Promise<{ sort?: string }>;
}) {
  const sp = searchParams ? await searchParams : undefined;
  const sort = (sp?.sort as SortKey) || "aum";
  const baskets = await getBaskets(sort);

  // enrich with mock metrics when backend has no data
  const enriched = baskets.length
    ? baskets.map((b: any, i: number) => ({
        ...b,
        aum: b.aum ?? b.nav ?? 0,
        return_24h: b.return_24h ?? (i % 2 === 0 ? 2.4 - i * 0.7 : -0.9 + i * 0.3),
        holders: b.holders ?? 84 + i * 37,
        spark: sparkline(i * 13 + b.pubkey.charCodeAt(0)),
      }))
    : [];

  const hasData = enriched.length > 0;

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              Explore baskets
              <Badge variant="outline" className="font-mono text-[11px] gap-1 border-border bg-card">
                <Sparkles className="h-3 w-3" /> bklit
              </Badge>
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">
              Ranked strategy baskets — <span className="text-foreground">xStocks-backed</span>, immutable, pro-rata redeem. Data via{" "}
              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded border border-border">/api/v1/baskets</span> · view is convenience only.
            </p>
          </div>
          <Button asChild className="rounded-full gap-2">
            <Link href="/create">
              Create basket <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        {/* sort pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1 flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" /> Sort:
          </span>
          {SORTS.map((s) => {
            const active = sort === s.key;
            return (
              <Link key={s.key} href={`/explore?sort=${s.key}`}>
                <Badge
                  variant={active ? "default" : "outline"}
                  className={`gap-1.5 px-3 py-1 text-xs font-medium rounded-full transition-colors cursor-pointer border ${
                    active ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {s.icon} {s.label}
                </Badge>
              </Link>
            );
          })}
          <Badge variant="secondary" className="ml-1 font-mono text-[11px] bg-muted border-border">
            {sort}
          </Badge>
        </div>
      </div>

      {!hasData ? (
        <Card className="border-dashed bg-card border-border">
          <CardContent className="p-10 text-center">
            <div className="mx-auto max-w-md space-y-3">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted border border-border">
                <Wallet className="h-5 w-5 text-muted-foreground" />
              </div>
              <CardTitle className="text-base">No baskets yet</CardTitle>
              <CardDescription className="text-sm">
                Be the first to create a strategy basket. Pick 2–20 xStocks, set weights (sum 10,000 bps), set capped fees, seed atomically.
              </CardDescription>
              <div className="flex justify-center gap-2 pt-2">
                <Button asChild size="sm" className="rounded-full">
                  <Link href="/create">Go to /create</Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="rounded-full">
                  <Link href="/market">View Market</Link>
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground font-mono">Genesis 1,000,000 shares · 6 decimals · Program bdEDPr…YMNz</div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Ranking Table */}
          <Card className="overflow-hidden border-border bg-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" /> Rankings
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">Sorted by {sort} · {enriched.length} baskets · bklit Table · Badge</CardDescription>
                </div>
                <Badge variant="outline" className="hidden sm:inline-flex font-mono text-[11px] border-border bg-muted/30">
                  {enriched.length} total
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border bg-muted/30">
                    <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground bg-muted/30 whitespace-nowrap">#</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground bg-muted/30 whitespace-nowrap">Basket</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground bg-muted/30 whitespace-nowrap text-right">AUM / NAV</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground bg-muted/30 whitespace-nowrap text-right">Price</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground bg-muted/30 whitespace-nowrap text-right">24h</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground bg-muted/30 whitespace-nowrap text-right">Holders</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground bg-muted/30 whitespace-nowrap">Trend</TableHead>
                    <TableHead className="h-9 px-3 text-xs font-medium text-muted-foreground bg-muted/30 whitespace-nowrap text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enriched.map((b: any, i: number) => {
                    const up = (b.return_24h ?? 0) >= 0;
                    return (
                      <TableRow key={b.pubkey} className="hover:bg-muted/30 border-border">
                        <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center font-mono text-[10px] font-medium">
                              {b.pubkey.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-mono text-xs font-medium">{formatPubkey(b.pubkey)}</div>
                              <div className="text-[11px] text-muted-foreground font-mono truncate max-w-[140px]">{b.creator ? formatPubkey(b.creator) : "creator —"}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-2.5 text-right font-mono text-xs">
                          {(b.aum ?? b.nav ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                        </TableCell>
                        <TableCell className="px-3 py-2.5 text-right font-mono text-xs">{b.sharePrice != null ? `$${Number(b.sharePrice).toFixed(4)}` : "—"}</TableCell>
                        <TableCell className="px-3 py-2.5 text-right">
                          <Badge variant={up ? "default" : "destructive"} className={`font-mono text-[11px] tabular-nums ${up ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20" : ""}`}>
                            {up ? "+" : ""}
                            {Number(b.return_24h).toFixed(2)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="px-3 py-2.5 text-right font-mono text-xs">{b.holders?.toLocaleString()}</TableCell>
                        <TableCell className="px-3 py-2.5">
                          <div className="h-[28px] w-[90px] overflow-hidden">
                            <AreaChart data={b.spark} xDataKey="date" margin={{ top: 2, right: 0, bottom: 2, left: 0 }} style={{ height: 28 }} className="h-full w-full">
                              <Area dataKey="value" fill={up ? "hsl(var(--chart-2))" : "hsl(var(--destructive))"} stroke={up ? "hsl(var(--chart-2))" : "hsl(var(--destructive))"} fillOpacity={0.18} strokeWidth={1.5} />
                            </AreaChart>
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-2.5 text-right">
                          <Button asChild variant="outline" size="xs" className="rounded-full h-7 px-3 text-xs">
                            <Link href={`/basket/${b.pubkey}`}>View</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Card grid with sparkline */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {enriched.map((b: any, i: number) => {
              const up = (b.return_24h ?? 0) >= 0;
              return (
                <Card key={b.pubkey} className="group overflow-hidden border-border bg-card hover:border-primary/15 hover:shadow-md transition-all duration-200 flex flex-col">
                  <CardHeader className="pb-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <Badge variant="outline" className="font-mono text-[11px] border-border bg-muted/30">
                        #{i + 1} · {formatPubkey(b.pubkey)}
                      </Badge>
                      <Badge variant={up ? "secondary" : "destructive"} className={`font-mono text-[11px] h-5 ${up ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : ""}`}>
                        {up ? "+" : ""}
                        {Number(b.return_24h).toFixed(2)}%
                      </Badge>
                    </div>
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="font-mono truncate">{b.pubkey.slice(0, 10)}…</span>
                      <span className="text-xs font-normal text-muted-foreground flex items-center gap-1">
                        <Users className="h-3 w-3" /> {b.holders}
                      </span>
                    </CardTitle>
                    <CardDescription className="text-xs font-mono truncate">creator {b.creator ? formatPubkey(b.creator) : "—"}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 flex-1 flex flex-col">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-muted/40 border border-border/60 p-2.5">
                        <div className="text-muted-foreground text-[11px]">AUM / NAV</div>
                        <div className="font-mono font-medium tabular-nums">
                          {(b.aum ?? b.nav ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                        </div>
                      </div>
                      <div className="rounded-lg bg-muted/40 border border-border/60 p-2.5">
                        <div className="text-muted-foreground text-[11px]">Share price</div>
                        <div className="font-mono font-medium tabular-nums">{b.sharePrice != null ? `$${Number(b.sharePrice).toFixed(4)}` : "—"}</div>
                      </div>
                    </div>
                    <div className="h-[56px] rounded-lg border bg-muted/20 overflow-hidden p-1">
                      <AreaChart data={b.spark} xDataKey="date" margin={{ top: 4, right: 4, bottom: 4, left: 4 }} style={{ height: 48 }} className="h-full w-full">
                        <Area dataKey="value" fill={up ? "hsl(var(--chart-2))" : "hsl(var(--chart-1))"} stroke={up ? "hsl(var(--chart-2))" : "hsl(var(--chart-1))"} fillOpacity={0.14} strokeWidth={1.6} />
                      </AreaChart>
                    </div>
                    <div className="flex gap-2 pt-1 mt-auto">
                      <Button asChild size="sm" className="flex-1 rounded-full">
                        <Link href={`/basket/${b.pubkey}`}>View basket</Link>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="rounded-full">
                        <Link href={`/basket/${b.pubkey}/buy`}>Buy</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <div className="text-xs text-muted-foreground border-t border-border pt-4">
        Built with{" "}
        <a href="https://bklit.com/docs/installation" className="underline decoration-border underline-offset-4 hover:text-foreground">
          bklit
        </a>{" "}
        (Card · Badge · Table · AreaChart) + shadcn · dark <span className="font-mono bg-muted px-1.5 py-0.5 rounded border border-border">hsl(var(--background))</span> · explorer is convenience only, on-chain redeem is source of truth.
      </div>
    </div>
  );
}
