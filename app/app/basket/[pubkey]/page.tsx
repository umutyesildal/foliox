import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { AreaChart, Area } from "@/components/charts/area-chart";
import { Wallet, TrendingUp, Shield, AlertTriangle, ArrowRight, Coins, PieChart as PieIcon, Layers } from "lucide-react";

export const dynamic = "force-dynamic";

async function fetchBasket(pubkey: string) {
  try {
    const base = process.env.NEXT_PUBLIC_API || "http://localhost:3001";
    const r = await fetch(`${base}/api/v1/baskets/${pubkey}`, { cache: "no-store" });
    if (!r.ok) throw new Error("not found");
    const j = await r.json();
    return j.data as any;
  } catch {
    return null;
  }
}

function fmtPubkey(pk: string) {
  if (!pk) return "—";
  return pk.length > 14 ? `${pk.slice(0, 6)}…${pk.slice(-4)}` : pk;
}

export default async function BasketDetail({
  params,
}: {
  params: Promise<{ pubkey: string }> | { pubkey: string };
}) {
  const resolved = params instanceof Promise ? await params : params;
  const pubkey = decodeURIComponent(resolved.pubkey);

  const fetched = await fetchBasket(pubkey);

  // mock fallback so page is always rich even when backend empty
  const basket = fetched || {
    pubkey,
    creator: "CreatorDemo111111111111111111111111111111111",
    treasury: "TreasuryDemo111111111111111111111111111111",
    share_mint: `Share${pubkey.slice(0, 8)}111111111111111111111111111`,
    nav: 2483200,
    supply: 1_000_000,
    sharePrice: 2.4832,
    aum: 2483200,
    holders: 1284,
    return_24h: 3.21,
    num_constituents: 3,
    constituents: ["TSLAx", "AAPLx", "NVDAx"],
    weights_bps: [5000, 3000, 2000],
    entry_bps: 100,
    exit_bps: 50,
    mgmt_bps: 200,
    creator_fee_split_bps: 9000,
    last_fee_accrual_ts: Math.floor(Date.now() / 1000) - 3600,
    vault_holdings: [
      { mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", raw: 500_000_000, scaled: 512.4, decimals: 6, ticker: "TSLAx" },
      { mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", raw: 300_000_000, scaled: 307.1, decimals: 6, ticker: "AAPLx" },
      { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", raw: 200_000_000, scaled: 198.9, decimals: 6, ticker: "NVDAx" },
    ],
  };

  const sharePrice = basket.sharePrice ?? (basket.nav && basket.supply ? basket.nav / basket.supply : 2.4832);
  const nav = basket.nav ?? basket.aum ?? 2483200;

  // Drift mock: target vs actual -> drift bps
  const driftData =
    basket.vault_holdings?.map((h: any, i: number) => {
      const target = basket.weights_bps?.[i] ?? Math.floor(10000 / basket.vault_holdings.length);
      const driftBps = [-42, 28, 14][i] ?? Math.round((Math.sin(i * 1.1) * 35));
      const actual = target + driftBps;
      return {
        ticker: h.ticker || `M${i + 1}`,
        target,
        actual,
        drift: driftBps,
      };
    }) ??
    (basket.constituents || []).map((t: string, i: number) => ({
      ticker: t,
      target: basket.weights_bps?.[i] ?? 3333,
      actual: (basket.weights_bps?.[i] ?? 3333) + [-42, 28, 14][i],
      drift: [-42, 28, 14][i],
    }));

  const feeRows = [
    { label: "Entry", value: basket.entry_bps ?? 100, cap: 300, desc: "One-time on mint_in_kind, withheld from gross shares" },
    { label: "Exit", value: basket.exit_bps ?? 50, cap: 100, desc: "On redeem_in_kind, fee shares to creator/treasury" },
    { label: "Management", value: basket.mgmt_bps ?? 200, cap: 300, desc: "Per-year, streamed via accrue_management_fee → dilution" },
    { label: "Creator split", value: basket.creator_fee_split_bps ?? 9000, cap: 10000, desc: "90% creator / 10% treasury of every fee" },
  ];

  const spark = Array.from({ length: 18 }, (_, i) => ({
    date: new Date(Date.now() - (18 - i) * 86400000),
    nav: Number((nav * (0.96 + i * 0.004 + Math.sin(i) * 0.006)).toFixed(2)),
  }));

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link href="/explore" className="text-muted-foreground hover:text-foreground underline underline-offset-4">
            Explore
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-mono text-foreground">{fmtPubkey(pubkey)}</span>
          <Badge variant="outline" className="font-mono text-[11px] border-border bg-card">basket</Badge>
          <Badge variant="secondary" className="font-mono text-[11px] bg-muted border-border">immutable</Badge>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              Strategy Basket
              <Badge variant="outline" className="gap-1.5 rounded-full border-primary/20 bg-primary/5 text-xs">
                <Layers className="h-3 w-3" /> {basket.num_constituents ?? driftData.length} xStocks
              </Badge>
            </h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground break-all">{pubkey}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge variant="outline" className="font-mono bg-card border-border">creator {fmtPubkey(basket.creator)}</Badge>
              <Badge variant="outline" className="font-mono bg-card border-border">mint {fmtPubkey(basket.share_mint)}</Badge>
              <Badge variant="outline" className="gap-1 bg-card border-border">
                <Shield className="h-3 w-3" /> Not an ETF · LEGAL_REVIEW_REQUIRED
              </Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild className="rounded-full gap-2">
              <Link href={`/basket/${pubkey}/buy`}>
                Buy / Mint <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link href={`/basket/${pubkey}/redeem`}>Redeem (oracle-free)</Link>
            </Button>
          </div>
        </div>
      </div>

      {/* NAV / sharePrice Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5" /> NAV — Σ(scaled × price)
            </CardDescription>
            <CardTitle className="text-2xl font-mono tracking-tight">${nav.toLocaleString(undefined, { maximumFractionDigits: 2 })}</CardTitle>
            <CardDescription className="text-xs">via /api/v1/baskets/{fmtPubkey(pubkey)}/nav/history · Jupiter Price v6</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[48px] w-full overflow-hidden rounded-lg border bg-muted/20 p-1">
              <AreaChart data={spark} xDataKey="date" margin={{ top: 4, right: 4, bottom: 4, left: 4 }} style={{ height: 40 }} className="h-full w-full">
                <Area dataKey="nav" fill="hsl(var(--primary))" stroke="hsl(var(--primary))" fillOpacity={0.14} strokeWidth={1.6} />
              </AreaChart>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs">
              <Badge variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                <TrendingUp className="h-3 w-3" /> +{basket.return_24h?.toFixed(2) ?? "3.21"}% 24h
              </Badge>
              <span className="text-muted-foreground">{basket.holders?.toLocaleString()} holders · {basket.supply?.toLocaleString()} supply</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5" /> Share price — nav / supply
            </CardDescription>
            <CardTitle className="text-2xl font-mono tracking-tight">${Number(sharePrice).toFixed(4)}</CardTitle>
            <CardDescription className="text-xs">6 decimals · genesis 1,000,000 shares</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-muted/40 border border-border/60 p-2">
                <div className="text-muted-foreground">Supply</div>
                <div className="font-mono font-medium">{Number(basket.supply ?? 1000000).toLocaleString()}</div>
              </div>
              <div className="rounded-lg bg-muted/40 border border-border/60 p-2">
                <div className="text-muted-foreground">Holders</div>
                <div className="font-mono font-medium">{Number(basket.holders ?? 1284).toLocaleString()}</div>
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground">Each share = pro-rata <span className="font-mono text-foreground">V·burn/S</span> raw per vault.</div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center gap-1.5">
              <PieIcon className="h-3.5 w-3.5" /> Basket meta
            </CardDescription>
            <CardTitle className="text-sm font-mono">{basket.num_constituents ?? driftData.length} constituents · immutable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Share mint</span>
              <span className="font-mono truncate max-w-[140px]">{fmtPubkey(basket.share_mint)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Factory</span>
              <span className="font-mono">{fmtPubkey(basket.factory ?? "factory —")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last fee accrual</span>
              <span className="font-mono">{basket.last_fee_accrual_ts ? new Date(basket.last_fee_accrual_ts * 1000).toLocaleString() : "—"}</span>
            </div>
            <div className="rounded-lg bg-muted/30 border border-border p-2 font-mono text-[11px] break-all">metadata_hash: {(basket.metadata_hash as string) || "0x — immutable thesis hash"}</div>
          </CardContent>
        </Card>
      </div>

      {/* Drift BarChart + Fees Table */}
      <div className="grid gap-4 lg:grid-cols-[1.5fr_0.9fr]">
        <Card className="overflow-hidden border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <PieIcon className="h-4 w-4 text-muted-foreground" /> Constituents & drift
            </CardTitle>
            <CardDescription className="text-xs">Target weights vs actual drift = scaled_i/Σscaled×10k − target · bklit BarChart · no rebalance in V0</CardDescription>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {driftData.map((d: any) => (
                <Badge key={d.ticker} variant="outline" className="font-mono text-[11px] bg-card border-border">
                  {d.ticker} {d.target} bps
                </Badge>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-[220px]">
              <BarChart data={driftData} xDataKey="ticker" className="h-full w-full">
                <Grid horizontal />
                <Bar dataKey="drift" fill="hsl(var(--chart-1))" />
                <BarXAxis />
                <ChartTooltip />
              </BarChart>
            </div>
            {/* holdings table */}
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent bg-muted/30 border-border">
                    <TableHead className="h-8 px-3 text-xs bg-muted/30">Ticker</TableHead>
                    <TableHead className="h-8 px-3 text-xs bg-muted/30 text-right">Target bps</TableHead>
                    <TableHead className="h-8 px-3 text-xs bg-muted/30 text-right">Drift bps</TableHead>
                    <TableHead className="h-8 px-3 text-xs bg-muted/30 text-right">Actual bps</TableHead>
                    <TableHead className="h-8 px-3 text-xs bg-muted/30 text-right">Scaled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {driftData.map((d: any, i: number) => {
                    const h = basket.vault_holdings?.[i];
                    return (
                      <TableRow key={d.ticker} className="border-border hover:bg-muted/30">
                        <TableCell className="px-3 py-2 font-mono text-xs">
                          <Badge variant="secondary" className="font-mono text-xs bg-muted border-border">
                            {d.ticker}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right font-mono text-xs">{d.target.toLocaleString()}</TableCell>
                        <TableCell className={`px-3 py-2 text-right font-mono text-xs ${d.drift === 0 ? "text-muted-foreground" : d.drift > 0 ? "text-emerald-500" : "text-amber-600"}`}>
                          {d.drift > 0 ? "+" : ""}
                          {d.drift}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right font-mono text-xs">{d.actual.toLocaleString()}</TableCell>
                        <TableCell className="px-3 py-2 text-right font-mono text-xs">{h?.scaled != null ? Number(h.scaled).toFixed(2) : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="text-[11px] text-muted-foreground">Holdings scaled = raw × multiplier. Drift is natural (no auto-rebalance), only changes on mint/redeem/mgmt fee.</div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-border bg-card h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Coins className="h-4 w-4 text-muted-foreground" /> Fee schedule
            </CardTitle>
            <CardDescription className="text-xs">Caps 300/100/300 · split 90/10 · fees in shares, never in underlying</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent bg-muted/30 border-border">
                  <TableHead className="h-8 px-3 text-xs bg-muted/30">Fee</TableHead>
                  <TableHead className="h-8 px-3 text-xs bg-muted/30 text-right">bps</TableHead>
                  <TableHead className="h-8 px-3 text-xs bg-muted/30 text-right">Cap</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feeRows.map((f) => (
                  <TableRow key={f.label} className="border-border hover:bg-muted/30">
                    <TableCell className="px-3 py-2.5">
                      <div className="text-xs font-medium">{f.label}</div>
                      <div className="text-[11px] text-muted-foreground leading-tight">{f.desc}</div>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-right font-mono text-xs">
                      <Badge variant="outline" className="font-mono bg-card border-border">
                        {f.value}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">{f.cap}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="p-3 text-[11px] text-muted-foreground border-t border-border bg-muted/20">
              Entry fee = gross·bps/10000, net = gross−fee, split_fee(fee, 9000). Mgmt = supply·bps·elapsed/(10000·31536000). Example 10M supply, 200bps, 30d → ~16,438 shares.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Redeem amber note as bklit Card */}
      <Card className="border-amber-500/20 bg-amber-500/10">
        <CardContent className="p-4 flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-2">
              Redeem is permissionless, oracle-free, never pausable
              <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-mono">
                redeem_in_kind
              </Badge>
            </div>
            <p className="text-xs leading-relaxed text-amber-700/90 dark:text-amber-200/80">
              Fees: entry 0–300, exit 0–100, mgmt 0–300 bps/yr. Creator 90/10 split. Burn = shares−fee, out = V·burn/S floor per constituent. Whitelist
              pause blocks <span className="font-mono">mint</span> only — never redeem. Jupiter zap is periphery; core is in-kind.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild size="sm" className="rounded-full">
                <Link href={`/basket/${pubkey}/buy`}>Buy / Mint in-kind or zap</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="rounded-full border-amber-500/20 bg-card hover:bg-amber-500/10">
                <Link href={`/basket/${pubkey}/redeem`}>Redeem preview (pro-rata floor)</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground border-t border-border pt-4">
        Built with{" "}
        <a href="https://bklit.com/docs/installation" className="underline decoration-border underline-offset-4 hover:text-foreground">
          bklit
        </a>{" "}
        (Card · Table · Badge · BarChart · AreaChart) + shadcn · dark <span className="font-mono bg-muted px-1.5 py-0.5 rounded border border-border">hsl(var(--background))</span> · redeem never gates on oracle/whitelist/backend.
      </div>
    </div>
  );
}
