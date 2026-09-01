"use client";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { PieCenter } from "@/components/charts/pie-center";
import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { Shield, Zap, PieChart as PieIcon, Sliders, Coins, Check, AlertCircle, Equal, RefreshCw } from "lucide-react";

const STEPS = ["Select", "Weights", "Fees", "Seed", "Legal", "Deploy"] as const;
const AVAILABLE = [
  { ticker: "TSLAx", name: "Tesla", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", price: 358.97, color: "hsl(var(--chart-1))" },
  { ticker: "AAPLx", name: "Apple", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", price: 324.97, color: "hsl(var(--chart-2))" },
  { ticker: "NVDAx", name: "Nvidia", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", price: 218.01, color: "hsl(var(--chart-3))" },
  { ticker: "SPYx", name: "S&P 500", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", price: 763.90, color: "hsl(var(--chart-4))" },
];

export default function Create() {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>(["TSLAx", "NVDAx", "SPYx"]);
  const [weights, setWeights] = useState<Record<string, number>>({ TSLAx: 5000, NVDAx: 3000, SPYx: 2000 });
  const [entry, setEntry] = useState(100);
  const [exit, setExit] = useState(50);
  const [mgmt, setMgmt] = useState(200);
  const [legal, setLegal] = useState(false);

  const toggle = (t: string) => {
    setSelected((s) => {
      if (s.includes(t)) {
        const ns = s.filter((x) => x !== t);
        const { [t]: _, ...rest } = weights;
        setWeights(rest);
        return ns;
      } else {
        if (s.length >= 20) return s;
        const ns = [...s, t];
        // distribute equally when adding
        const eq = Math.floor(10000 / ns.length);
        const rem = 10000 - eq * ns.length;
        const nw: Record<string, number> = {};
        ns.forEach((k, i) => (nw[k] = eq + (i === 0 ? rem : 0)));
        setWeights(nw);
        return ns;
      }
    });
  };

  const sum = useMemo(() => Object.values(weights).reduce((a, b) => a + b, 0), [weights]);
  const sumPct = (sum / 100).toFixed(2);
  const validSelect = selected.length >= 2 && selected.length <= 20;
  const validWeights = sum === 10000 && validSelect;
  const canNext = step === 0 ? validSelect : step === 1 ? validWeights : step === 4 ? legal : true;

  const pieData = selected.map((t) => {
    const av = AVAILABLE.find((a) => a.ticker === t)!;
    return { label: t, value: weights[t] || 0, color: av.color };
  });
  const barData = selected.map((t) => ({ ticker: t, weight: weights[t] || 0 }));

  const equalize = () => {
    if (selected.length === 0) return;
    const eq = Math.floor(10000 / selected.length);
    const rem = 10000 - eq * selected.length;
    const nw: Record<string, number> = {};
    selected.forEach((k, i) => (nw[k] = eq + (i === 0 ? rem : 0)));
    setWeights(nw);
  };
  const normalize = () => {
    if (sum === 0) return;
    const nw: Record<string, number> = {};
    let acc = 0;
    selected.forEach((k, i) => {
      if (i === selected.length - 1) nw[k] = 10000 - acc;
      else {
        const v = Math.round((weights[k] / sum) * 10000);
        nw[k] = v;
        acc += v;
      }
    });
    setWeights(nw);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Create strategy basket</h1>
        <Badge variant="outline" className="font-mono text-xs">Step {step + 1} / {STEPS.length}</Badge>
      </div>
      <div className="mt-3 flex gap-1">
        {STEPS.map((s, i) => (
          <div key={s} className="flex-1">
            <div className={`h-1.5 rounded-full transition ${i <= step ? "bg-primary" : "bg-muted"}`} />
            <div className={`mt-1 text-[11px] ${i === step ? "text-foreground font-medium" : "text-muted-foreground"}`}>{i + 1}. {s}</div>
          </div>
        ))}
      </div>
      <Progress value={((step + 1) / STEPS.length) * 100} className="mt-3 [&_[data-slot=progress-track]]:h-1 overflow-visible" />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {step === 0 && <><Layers className="h-4 w-4" /> Select xStocks (2–20)</>}
            {step === 1 && <><PieIcon className="h-4 w-4" /> Target weights — must sum 10,000 bps</>}
            {step === 2 && <><Sliders className="h-4 w-4" /> Fees — capped, split 90/10</>}
            {step === 3 && <><Coins className="h-4 w-4" /> Seed preview</>}
            {step === 4 && <><Shield className="h-4 w-4" /> Legal & risk</>}
            {step === 5 && <><Check className="h-4 w-4" /> Deploy — immutable</>}
          </CardTitle>
          <CardDescription className="text-xs">
            {step === 0 && "Pick 2–20 whitelisted xStocks. Paused mints block new buys but not redeem."}
            {step === 1 && "Drag sliders. Total is fixed 10,000 bps = 100%. Pie + bars update live. Use Equal or Normalize."}
            {step === 2 && "Entry ≤300, Exit ≤100, Mgmt ≤300 bps/yr. All fees in shares."}
            {step === 3 && "Creator seed is atomic with create_basket — prevents hijack. Example $1,000."}
            {step === 4 && "Confirm you understand: not an ETF, not advice, Backed instrument, jurisdiction."}
            {step === 5 && "Weights, fees, mints, metadata_hash never change after deploy."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {AVAILABLE.map((a) => {
                const sel = selected.includes(a.ticker);
                return (
                  <button key={a.ticker} onClick={() => toggle(a.ticker)} className={`text-left rounded-xl border p-4 transition ${sel ? "border-primary bg-primary/5 shadow" : "border-border hover:bg-muted/50"}`}>
                    <div className="flex justify-between items-start">
                      <div><div className="font-mono font-medium">{a.ticker} <span className="text-muted-foreground text-xs">{a.name}</span></div><div className="font-mono text-xs truncate text-muted-foreground mt-1">{a.mint.slice(0, 16)}…</div></div>
                      <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${sel ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30"}`}>{sel && <Check className="h-3 w-3" />}</div>
                    </div>
                    <div className="mt-2 flex justify-between text-xs"><span className="text-muted-foreground">Price</span><span className="font-mono">${a.price.toFixed(2)}</span></div>
                  </button>
                );
              })}
              <div className={`col-span-full flex items-center gap-2 text-xs p-2.5 rounded-lg border ${validSelect ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-amber-500/10 border-amber-500/20 text-amber-600"}`}>
                {validSelect ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                Selected {selected.length} / 2–20 {validSelect ? "— ready" : "— need 2–20"}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-6 md:grid-cols-[1.4fr_0.8fr]">
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={equalize} className="gap-1.5"><Equal className="h-3.5 w-3.5" /> Equal</Button>
                  <Button size="sm" variant="outline" onClick={normalize} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> Normalize to 10k</Button>
                  <span className={`ml-auto text-xs font-mono px-2.5 py-1 rounded-full border ${sum === 10000 ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" : "bg-red-500/15 text-red-600 border-red-500/20"}`}>{sum.toLocaleString()} / 10,000 bps ({sumPct}%) {sum === 10000 ? "✓" : "≠ 10,000"}</span>
                </div>
                {selected.map((t) => (
                  <div key={t} className="space-y-1.5">
                    <div className="flex justify-between text-xs"><span className="font-mono font-medium">{t}</span><span className="font-mono text-muted-foreground">{weights[t]?.toLocaleString()} bps · {(weights[t] / 100).toFixed(2)}%</span></div>
                    <Slider value={[weights[t] || 0]} min={0} max={10000} step={50} onValueChange={([v]) => setWeights((w) => ({ ...w, [t]: v }))} />
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${((weights[t] || 0) / 10000) * 100}%` }} /></div>
                  </div>
                ))}
                {!validWeights && <div className="flex gap-2 text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-lg"><AlertCircle className="h-4 w-4 shrink-0" /> Sum must be exactly 10,000 bps. Drag sliders or hit Normalize.</div>}
              </div>
              <div className="space-y-3">
                <div className="h-[180px] rounded-xl border bg-muted/20 p-2 overflow-visible flex items-center justify-center">
                  <PieChart data={pieData} innerRadius={42} padAngle={0.02} cornerRadius={4} className="h-full w-full overflow-visible">
                    {pieData.map((_, i) => (
                      <PieSlice key={i} index={i} />
                    ))}
                    <PieCenter />
                  </PieChart>
                </div>
                <div className="h-[120px] rounded-xl border p-2 overflow-visible">
                  <BarChart data={barData} xDataKey="ticker" className="h-full w-full overflow-visible">
                    <Grid horizontal />
                    <Bar dataKey="weight" fill="hsl(var(--primary))" />
                    <BarXAxis />
                    <ChartTooltip />
                  </BarChart>
                </div>
                <div className="text-xs text-muted-foreground">Each share = pro-rata `V·shares/S`. 10k is immutable total, not an editable field.</div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-6">
                {[
                  { label: "Entry", v: entry, set: setEntry, max: 300, desc: "One-time on mint, withheld from gross" },
                  { label: "Exit", v: exit, set: setExit, max: 100, desc: "On redeem, transferred to creator/treasury" },
                  { label: "Management", v: mgmt, set: setMgmt, max: 300, desc: "Per year, streamed via dilution" },
                ].map((f) => (
                  <div key={f.label}>
                    <div className="flex justify-between text-xs"><span className="font-medium">{f.label}</span><span className="font-mono">{f.v} bps · {(f.v / 100).toFixed(2)}%</span></div>
                    <Slider value={[f.v]} min={0} max={f.max} step={5} onValueChange={([v]) => f.set(v)} className="mt-2" />
                    <div className="text-xs text-muted-foreground mt-1">{f.desc} (cap {f.max})</div>
                  </div>
                ))}
              </div>
              <Card className="bg-muted/30">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Preview — 1M shares mint</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between"><span>Entry fee</span><span>{(1000000 * entry / 10000).toLocaleString()} shares</span></div>
                  <div className="flex justify-between"><span>Net to user</span><span>{(1000000 - 1000000 * entry / 10000).toLocaleString()}</span></div>
                  <div className="flex justify-between"><span>Exit on 1M burn</span><span>{(1000000 * exit / 10000).toLocaleString()} fee</span></div>
                  <div className="flex justify-between"><span>Mgmt / year on 10M</span><span>{Math.floor(10000000 * mgmt / 10000).toLocaleString()} shares</span></div>
                  <div className="pt-2 text-muted-foreground">Split 90/10 creator/treasury. Fees in shares, never in underlying.</div>
                </CardContent>
              </Card>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="text-sm">Seed must be proportional to weights. Example <span className="font-mono">$1,000</span> at current prices:</div>
              <div className="rounded-xl border overflow-hidden bg-card">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-9 text-xs">Ticker</TableHead>
                      <TableHead className="h-9 text-xs text-right">Weight</TableHead>
                      <TableHead className="h-9 text-xs text-right">USD</TableHead>
                      <TableHead className="h-9 text-xs text-right">Raw (6 dec)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selected.map((t) => {
                      const av = AVAILABLE.find((a) => a.ticker === t)!;
                      const usd = (1000 * (weights[t] || 0)) / 10000;
                      const raw = Math.floor((usd / av.price) * 1_000_000);
                      return (
                        <TableRow key={t}>
                          <TableCell className="font-mono text-xs">{t}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{weights[t]?.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono text-xs">${usd.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{raw.toLocaleString()}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="text-xs text-muted-foreground">Seed transfer is atomic with <code className="bg-muted px-1 rounded">create_basket</code> — prevents front-run.</div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <label className="flex gap-3 p-3 rounded-xl border hover:bg-muted/30 cursor-pointer">
                <input type="checkbox" checked={legal} onChange={(e) => setLegal(e.target.checked)} className="mt-1" />
                <span className="text-sm">I understand: this is not a registered ETF, not investment advice. xStocks are Backed Finance structured instruments (1 share → 1 token, custodied at Clearstream/InCore), no voting rights, dividends reinvested. Creators are not licensed advisers. Restricted for U.S. persons. <span className="text-amber-600">LEGAL_REVIEW_REQUIRED</span></span>
              </label>
              <div className="text-xs text-muted-foreground">All copy is placeholder for counsel review before mainnet.</div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Basket</CardTitle></CardHeader><CardContent className="text-xs font-mono space-y-1"><div>Constituents: {selected.join(", ")}</div><div>Weights: {selected.map((t) => `${t}:${weights[t]}`).join(" ")}</div><div>Fees: {entry}/{exit}/{mgmt} bps</div></CardContent></Card>
                <div className="h-[140px] overflow-visible flex items-center justify-center rounded-xl border bg-muted/20 p-2">
                  <PieChart data={pieData} innerRadius={36} padAngle={0.02} cornerRadius={4} className="h-full w-full max-w-[160px] overflow-visible">
                    {pieData.map((_, i) => (
                      <PieSlice key={i} index={i} />
                    ))}
                    <PieCenter />
                  </PieChart>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">Immutable after deploy: constituents, weights, fees, creator, metadata_hash never change. No update ix.</div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 flex justify-between">
        <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</Button>
        <Button disabled={!canNext} onClick={() => (step < 5 ? setStep((s) => s + 1) : alert("create_basket: nonce + " + selected.join(",") + " weights " + JSON.stringify(weights) + " fees " + entry + "/" + exit + "/" + mgmt))}>
          {step === 5 ? "Deploy — immutable" : "Next"}
        </Button>
      </div>
      {!canNext && step === 1 && <div className="mt-2 text-xs text-amber-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Fix weights to 10,000 to continue</div>}
    </div>
  );
}

function Layers(props: any) { return <PieIcon {...props} />; }
